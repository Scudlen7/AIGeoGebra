import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { forwardModelResponse, json } from '../functions/_lib/llm.js'
import { ProviderError, providerBaseUrl, providerFetch } from './model-upstream.js'
import { superuserToken, verifyUser } from '../functions/_lib/usage.js'

const modelsLimit = 500
const idPattern = /^[a-z0-9]{15}$/
const configLimit = 512 * 1024
const chatLimit = 2 * 1024 * 1024
const routes = { openai: 'chat/completions', anthropic: 'messages' }

function text(value, max) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length <= max ? trimmed : ''
}

function connectionConfig(input) {
  const protocol = input.protocol
  if (protocol !== 'openai' && protocol !== 'anthropic') throw new ProviderError(400, '请选择 API 协议')
  const baseUrl = providerBaseUrl(text(input.baseUrl, 512))
  const url = new URL(baseUrl)
  if (url.pathname === '/') {
    if (url.hostname === 'api.openai.com' || url.hostname === 'api.anthropic.com') return { protocol, baseUrl: baseUrl + '/v1' }
    if (url.hostname === 'generativelanguage.googleapis.com' && protocol === 'openai') return { protocol, baseUrl: baseUrl + '/v1beta/openai' }
  }
  return { protocol, baseUrl }
}

function modelList(items) {
  if (!Array.isArray(items)) return []
  const entries = new Map()
  for (const item of items) {
    const id = text(item?.id, 160)
    if (!id || /[\u0000-\u001f\u007f]/.test(id) || entries.has(id)) continue
    entries.set(id, { id, label: text(item.label ?? item.display_name ?? item.name, 160) || id })
    if (entries.size === modelsLimit) break
  }
  return [...entries.values()]
}

function publicProvider(record) {
  return { id: record.id, name: record.name, baseUrl: record.baseUrl, protocol: record.protocol, models: modelList(record.models) }
}

function binding(record) {
  return Buffer.from(JSON.stringify([record.owner, record.baseUrl, record.protocol]))
}

function seal(key, record, apiKey) {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(binding(record))
  const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()])
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64url')
}

function unseal(key, record) {
  try {
    const data = Buffer.from(record.keyCiphertext, 'base64url')
    const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12))
    decipher.setAAD(binding(record))
    decipher.setAuthTag(data.subarray(12, 28))
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8')
  } catch {
    throw new ProviderError(422, '无法读取已保存的 API Key，请编辑供应商并重新输入')
  }
}

function keyInput(input, config, previous) {
  if (input.apiKey == null || input.apiKey === '') {
    if (previous && previous.baseUrl === config.baseUrl && previous.protocol === config.protocol) return ''
    throw new ProviderError(400, '请填写 API Key，更改地址或协议时需要重新输入')
  }
  const apiKey = text(input.apiKey, 4096)
  if (!/^[\x21-\x7e]{1,4096}$/.test(apiKey)) throw new ProviderError(400, 'API Key 格式不正确')
  return apiKey
}

async function readJson(message, limit, status = 400) {
  const reader = message.body?.getReader()
  if (!reader) throw new ProviderError(status, '未收到 JSON 数据')
  const decoder = new TextDecoder()
  let bytes = 0
  let raw = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > limit) {
        await reader.cancel()
        throw new ProviderError(status, 'JSON 数据过大')
      }
      raw += decoder.decode(value, { stream: true })
    }
    const parsed = JSON.parse(raw + decoder.decode())
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
    return parsed
  } catch (reason) {
    if (reason instanceof ProviderError) throw reason
    throw new ProviderError(status, '无法读取 JSON 数据')
  } finally {
    reader.releaseLock()
  }
}

async function account(request, env) {
  const token = request.headers.get('x-pb-token')
  if (!token) throw new ProviderError(401, '请先登录')
  const base = String(env.PB_URL || '').trim().replace(/\/+$/, '')
  const secret = String(env.MODEL_PROVIDER_ENCRYPTION_KEY || '').trim()
  if (!base || !/^[a-f0-9]{64}$/i.test(secret) || !env.PB_SUPERUSER_EMAIL || !env.PB_SUPERUSER_PASSWORD) {
    throw new ProviderError(503, '个人供应商服务尚未配置，请联系管理员')
  }
  const user = await verifyUser(env, token)
  if (!user) throw new ProviderError(401, '登录已失效，请重新登录')
  const admin = await superuserToken(env)
  if (!admin) throw new ProviderError(503, '个人供应商服务暂不可用')

  async function records(path = '', method = 'GET', data) {
    const response = await fetch(`${base}/api/collections/model_providers/records${path}`, {
      method,
      headers: { authorization: admin, 'content-type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    })
    if (response.status === 404 && /^\/[a-z0-9]+$/.test(path)) throw new ProviderError(404, '供应商不存在')
    if (!response.ok) throw new ProviderError(503, '无法读取或保存供应商，请稍后再试')
    return response.status === 204 ? null : response.json()
  }

  async function owned(id) {
    if (!idPattern.test(id)) throw new ProviderError(404, '供应商不存在')
    const record = await records('/' + id)
    if (record.owner !== user.id) throw new ProviderError(404, '供应商不存在')
    return record
  }

  async function list() {
    const query = new URLSearchParams({
      filter: `owner = ${JSON.stringify(user.id)}`,
      fields: 'id,name,baseUrl,protocol,models',
      sort: 'created,id',
      perPage: '100',
    })
    const providers = []
    let page = 1
    while (true) {
      query.set('page', String(page))
      const result = await records('?' + query)
      providers.push(...result.items.map(publicProvider))
      if (page >= result.totalPages) return providers
      page += 1
    }
  }

  return { user, key: Buffer.from(secret, 'hex'), records, owned, list }
}

async function upstream(send, config, key, path, signal, data) {
  const target = new URL(`${config.baseUrl}/${path}`)
  const headers = { 'accept-encoding': 'identity' }
  if (config.protocol === 'anthropic') {
    headers['x-api-key'] = key
    headers['anthropic-version'] = '2023-06-01'
  } else {
    headers.authorization = `Bearer ${key}`
  }
  const body = data === undefined ? undefined : JSON.stringify(data)
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    headers['content-length'] = String(Buffer.byteLength(body))
  }
  const response = await send(target, { method: body === undefined ? 'GET' : 'POST', headers, body, signal })
  if (response.ok) return response
  await response.body?.cancel()
  if (response.status >= 300 && response.status < 400) throw new ProviderError(422, '供应商要求重定向，请填写最终 API 地址')
  if (response.status === 401 || response.status === 403) throw new ProviderError(422, '供应商拒绝访问，请检查 API Key 和权限')
  if (response.status === 429) throw new ProviderError(429, '供应商请求受限，请检查额度或稍后再试')
  if (path.startsWith('models')) throw new ProviderError(422, '未能获取模型列表，请检查 API 地址或手动添加模型 ID')
  throw new ProviderError(422, '供应商未接受请求，请检查模型 ID、接口协议和工具调用支持')
}

async function discover(send, config, key, signal) {
  const items = []
  let cursor = ''
  for (let page = 0; page < 5; page += 1) {
    const query = new URLSearchParams({ limit: '100' })
    if (cursor) query.set('after_id', cursor)
    const path = config.protocol === 'anthropic' ? 'models?' + query : 'models'
    const response = await upstream(send, config, key, path, signal)
    const result = await readJson(response, chatLimit, 422)
    if (!Array.isArray(result.data)) throw new ProviderError(422, '供应商未返回可读取的模型列表，可手动添加模型 ID')
    items.push(...result.data)
    if (config.protocol !== 'anthropic' || !result.has_more || !result.last_id || result.last_id === cursor) break
    cursor = result.last_id
  }
  return modelList(items).filter((item) => !item.id.includes(key) && !item.label.includes(key))
}

export async function providersRequest(request, env = {}, send = providerFetch) {
  const path = new URL(request.url).pathname.replace(/^\/api\/providers\/?/, '').replace(/\/+$/, '')
  const [id, ...parts] = path.split('/')
  const action = parts.join('/')
  const method = request.method
  const isTurn = method === 'POST' && (action === routes.openai || action === routes.anthropic)
  try {
    const store = await account(request, env)
    if (!id && method === 'GET') return json(await store.list())
    if (id === 'discover' && !action && method === 'POST') {
      const input = await readJson(request, configLimit)
      const previous = input.id ? await store.owned(input.id) : null
      const config = connectionConfig(input)
      const key = keyInput(input, config, previous) || unseal(store.key, previous)
      return json(await discover(send, config, key, AbortSignal.any([request.signal, AbortSignal.timeout(20000)])))
    }
    if (!action && ((!id && method === 'POST') || (id && method === 'PUT'))) {
      const previous = id ? await store.owned(id) : null
      const input = await readJson(request, configLimit)
      const config = connectionConfig(input)
      const name = text(input.name, 80)
      const models = modelList(input.models)
      if (!name || !models.length) throw new ProviderError(400, '请填写供应商名称并至少添加一个模型')
      const key = keyInput(input, config, previous)
      const record = { ...config, name, models, owner: store.user.id }
      record.keyCiphertext = key ? seal(store.key, record, key) : previous.keyCiphertext
      return json(publicProvider(await store.records(id ? '/' + id : '', id ? 'PATCH' : 'POST', record)), id ? 200 : 201)
    }
    if (id && !action && method === 'DELETE') {
      await store.owned(id)
      await store.records('/' + id, 'DELETE')
      return json({ ok: true })
    }
    if (id && (isTurn || (action === 'test' && method === 'POST'))) {
      const record = await store.owned(id)
      const body = await readJson(request, isTurn ? chatLimit : configLimit)
      if (!modelList(record.models).some((item) => item.id === body.model)) throw new ProviderError(404, '该模型未添加到此供应商')
      const config = connectionConfig(record)
      const endpoint = routes[config.protocol]
      if (isTurn && endpoint !== action) throw new ProviderError(400, '请求与供应商协议不匹配')
      const key = unseal(store.key, record)
      if (!isTurn) {
        const started = Date.now()
        const tokenField = new URL(config.baseUrl).hostname === 'api.openai.com' ? 'max_completion_tokens' : 'max_tokens'
        const response = await upstream(send, config, key, endpoint, AbortSignal.any([request.signal, AbortSignal.timeout(20000)]), {
          model: body.model, messages: [{ role: 'user', content: 'Reply with OK.' }], [tokenField]: 32, stream: false,
        })
        const result = await readJson(response, configLimit, 422)
        const answer = config.protocol === 'anthropic' ? result.content : result.choices
        if (!Array.isArray(answer) || !answer.length) throw new ProviderError(422, '供应商未返回有效的模型响应')
        return json({ ok: true, latencyMs: Date.now() - started })
      }
      if (config.protocol === 'openai' && body.stream && new URL(config.baseUrl).hostname === 'api.openai.com') {
        body.stream_options = { include_usage: true }
      }
      const response = await upstream(send, config, key, endpoint, AbortSignal.any([request.signal, AbortSignal.timeout(100000)]), body)
      if (body.stream && !response.headers.get('content-type')?.includes('text/event-stream')) {
        await response.body?.cancel()
        throw new ProviderError(422, '供应商未返回流式响应，请检查接口协议和模型')
      }
      return forwardModelResponse(response, env, { owner: store.user.id, model: body.model, gateway: false })
    }
    throw new ProviderError(404, '供应商接口不存在')
  } catch (reason) {
    const status = reason instanceof ProviderError ? reason.status : 502
    const message = reason instanceof ProviderError ? reason.message : '连接服务失败，请检查地址或稍后重试'
    return json(isTurn ? { type: 'error', error: { type: 'invalid_request_error', message } } : { error: message }, status)
  }
}

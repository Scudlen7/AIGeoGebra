import { gatewayModels, publicModels, resolveModel, statusBody } from './models.js'
import { recordUsage, verifyUser } from './usage.js'

export function envOf(context) {
  if (context?.env && typeof context.env === 'object') return context.env
  if (typeof process !== 'undefined' && process.env) return process.env
  return {}
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' },
  })
}

export function statusResponse(env) {
  return json(statusBody(env))
}

export function configResponse(env) {
  return json({ pbUrl: String(env.PB_URL || '').trim() })
}

export function modelsResponse(env) {
  return json(publicModels(env))
}

export function gatewayResponse(env) {
  return json({ items: gatewayModels(env) })
}

function scrub(text) {
  return String(text || '').replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***')
}

export async function testModel(request, env) {
  let body = {}
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, latencyMs: 0, error: '请求格式不正确' }, 400)
  }
  const model = resolveModel(env, String(body.id || ''))
  if (!model || model.id !== String(body.id || '')) return json({ ok: false, latencyMs: 0, error: '模型不存在' }, 404)
  const started = Date.now()
  try {
    const response = await fetch(`${model.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${model.apiKey}`,
      },
      body: JSON.stringify({
        model: model.id,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false,
      }),
      signal: AbortSignal.timeout(20000),
    })
    const latencyMs = Date.now() - started
    if (!response.ok) {
      const detail = scrub(await response.text()).slice(0, 180)
      return json({ ok: false, latencyMs, error: detail || '连接失败' })
    }
    await response.arrayBuffer()
    return json({ ok: true, latencyMs })
  } catch (reason) {
    return json({ ok: false, latencyMs: Date.now() - started, error: scrub(reason instanceof Error ? reason.message : '连接失败') })
  }
}

function readUsage(line) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return null
  const payload = trimmed.slice(5).trim()
  if (!payload || payload === '[DONE]') return null
  try {
    const jsonBody = JSON.parse(payload)
    const usage = jsonBody.usage
    if (!usage || (usage.prompt_tokens == null && usage.completion_tokens == null)) return null
    return {
      prompt: Number(usage.prompt_tokens) || 0,
      completion: Number(usage.completion_tokens) || 0,
    }
  } catch {
    return null
  }
}

function prepareBody(raw, modelId) {
  try {
    const jsonBody = JSON.parse(raw || '{}')
    jsonBody.model = modelId
    if (jsonBody.stream) {
      jsonBody.stream_options = { ...(jsonBody.stream_options || {}), include_usage: true }
    }
    return JSON.stringify(jsonBody)
  } catch {
    return raw
  }
}

export async function proxyLlm(request, env) {
  const url = new URL(request.url)
  const rawBody = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text()
  let requested = ''
  try {
    requested = String(JSON.parse(rawBody || '{}').model || '')
  } catch {
    requested = ''
  }
  const model = resolveModel(env, requested)
  if (!model) return json({ error: '模型未配置' }, 500)

  let upstream
  try {
    upstream = new URL(model.baseUrl)
  } catch {
    return json({ error: '模型地址不是合法的 URL' }, 500)
  }
  const rest = url.pathname.replace(/^\/llm\/?/, '')
  const target = `${upstream.origin}${upstream.pathname.replace(/\/+$/, '')}/${rest}${url.search}`
  const headers = new Headers()
  request.headers.forEach((value, key) => {
    const name = key.toLowerCase()
    if (name === 'host' || name === 'content-length' || name === 'authorization' || name === 'x-pb-token') return
    headers.set(key, value)
  })
  headers.set('authorization', `Bearer ${model.apiKey}`)
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : prepareBody(rawBody, model.id)
  if (body != null) headers.set('content-type', 'application/json')

  const user = await verifyUser(env, request.headers.get('x-pb-token'))
  const track = Boolean(user) && request.method === 'POST' && rest.includes('chat/completions')

  let upstreamResponse
  try {
    upstreamResponse = await fetch(target, {
      method: request.method,
      headers,
      body,
      signal: request.signal,
    })
  } catch (reason) {
    return json({ error: 'LLM 请求失败', detail: scrub(reason instanceof Error ? reason.message : String(reason)) }, 502)
  }

  const responseHeaders = new Headers(upstreamResponse.headers)
  responseHeaders.set('cache-control', 'no-cache')
  responseHeaders.set('x-accel-buffering', 'no')
  responseHeaders.delete('content-length')
  responseHeaders.delete('content-encoding')

  if (!upstreamResponse.body) {
    if (track && upstreamResponse.ok) {
      await recordUsage(env, {
        owner: user.id,
        model: model.id,
        gateway: model.gateway,
        tokensKnown: false,
        promptTokens: 0,
        completionTokens: 0,
      })
    }
    return new Response(null, { status: upstreamResponse.status, headers: responseHeaders })
  }

  const reader = upstreamResponse.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let usage = null
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          if (pending) {
            const found = readUsage(pending)
            if (found) usage = found
          }
          controller.close()
          if (track && upstreamResponse.ok) {
            await recordUsage(env, {
              owner: user.id,
              model: model.id,
              gateway: model.gateway,
              tokensKnown: Boolean(usage),
              promptTokens: usage?.prompt || 0,
              completionTokens: usage?.completion || 0,
            })
          }
          return
        }
        pending += decoder.decode(value, { stream: true })
        const lines = pending.split('\n')
        pending = lines.pop() || ''
        for (const line of lines) {
          const found = readUsage(line)
          if (found) usage = found
        }
        controller.enqueue(value)
      } catch (reason) {
        controller.error(reason)
      }
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })

  return new Response(stream, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  })
}

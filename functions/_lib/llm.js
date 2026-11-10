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
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
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

function readUsage(line, jsonResponse = false) {
  const trimmed = line.trim()
  if (!jsonResponse && !trimmed.startsWith('data:')) return null
  const payload = jsonResponse ? trimmed : trimmed.slice(5).trim()
  if (!payload || payload === '[DONE]') return null
  try {
    const jsonBody = JSON.parse(payload)
    const usage = jsonBody.usage ?? jsonBody.message?.usage
    if (!usage) return null
    const found = {}
    if (usage.prompt_tokens != null) found.prompt = Number(usage.prompt_tokens) || 0
    else if (usage.input_tokens != null) {
      found.prompt = (Number(usage.input_tokens) || 0)
        + (Number(usage.cache_read_input_tokens) || 0)
        + (Number(usage.cache_creation_input_tokens) || 0)
    }
    const output = usage.completion_tokens ?? usage.output_tokens
    if (output != null) found.completion = Number(output) || 0
    return Object.keys(found).length ? found : null
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
  if (request.method !== 'POST' || url.pathname !== '/llm/chat/completions' || url.search) {
    return json({ error: '模型接口不存在' }, 404)
  }
  if (env.LLM_ENABLE_PLATFORM_MODELS !== 'true') return json({ error: '平台试用模型未启用' }, 503)
  const rawBody = await request.text()
  let requested = ''
  try {
    requested = String(JSON.parse(rawBody || '{}').model || '')
  } catch {
    return json({ error: '请求格式不正确' }, 400)
  }
  const model = resolveModel(env, requested)
  if (!model) return json({ error: '平台模型未配置或不存在' }, requested ? 404 : 503)
  const headers = new Headers({
    'content-type': 'application/json',
    authorization: `Bearer ${model.apiKey}`,
  })
  const user = await verifyUser(env, request.headers.get('x-pb-token'))
  let response
  try {
    response = await fetch(`${model.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: prepareBody(rawBody, model.id),
      signal: request.signal,
      redirect: 'error',
    })
  } catch (reason) {
    return json({ error: 'LLM 请求失败', detail: scrub(reason instanceof Error ? reason.message : String(reason)) }, 502)
  }
  return forwardModelResponse(response, env, user && { owner: user.id, model: model.id, gateway: model.gateway })
}

export async function forwardModelResponse(upstreamResponse, env, event) {
  const track = Boolean(event) && upstreamResponse.ok
  const responseHeaders = new Headers(upstreamResponse.headers)
  responseHeaders.set('cache-control', 'no-store')
  responseHeaders.set('x-accel-buffering', 'no')
  responseHeaders.delete('content-length')
  responseHeaders.delete('content-encoding')

  if (!upstreamResponse.body) {
    if (track) {
      await recordUsage(env, {
        ...event,
        tokensKnown: false,
        promptTokens: 0,
        completionTokens: 0,
      })
    }
    return new Response(null, { status: upstreamResponse.status, headers: responseHeaders })
  }

  const reader = upstreamResponse.body.getReader()
  const decoder = new TextDecoder()
  const jsonResponse = (upstreamResponse.headers.get('content-type') || '').includes('application/json')
  let pending = ''
  let usage = null
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          pending += decoder.decode()
          if (pending) {
            const found = readUsage(pending, jsonResponse)
            if (found) usage = { ...usage, ...found }
          }
          controller.close()
          if (track) {
            await recordUsage(env, {
              ...event,
              tokensKnown: Boolean(usage),
              promptTokens: usage?.prompt || 0,
              completionTokens: usage?.completion || 0,
            })
          }
          return
        }
        pending += decoder.decode(value, { stream: true })
        if (!jsonResponse) {
          const lines = pending.split('\n')
          pending = lines.pop() || ''
          for (const line of lines) {
            const found = readUsage(line)
            if (found) usage = { ...usage, ...found }
          }
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

import assert from 'node:assert/strict'
import test from 'node:test'
import { proxyLlm } from '../functions/_lib/llm.js'
import { setImmediate } from 'node:timers/promises'

const env = { LLM_BASE_URL: 'https://example.invalid/v1', LLM_API_KEY: 'test-key', LLM_MODEL: 'test' }

test('proxy propagates browser cancellation to the upstream request', async () => {
  const originalFetch = globalThis.fetch
  const controller = new AbortController()
  const request = new Request('https://local.invalid/llm/chat/completions', {
    method: 'POST', body: '{}', signal: controller.signal,
  })
  let upstreamSignal
  globalThis.fetch = async (_url, options) => {
    upstreamSignal = options.signal
    return new Response('data: [DONE]\n\n')
  }
  try {
    const response = await proxyLlm(request, env)
    assert.equal(upstreamSignal, request.signal)
    controller.abort()
    assert.equal(upstreamSignal.aborted, true)
    await response.text()
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('canceling the outgoing stream also closes the upstream reader', async () => {
  const originalFetch = globalThis.fetch
  let canceled = false
  globalThis.fetch = async () => new Response(new ReadableStream({
    cancel() { canceled = true },
  }))
  try {
    const response = await proxyLlm(new Request('https://local.invalid/llm/chat/completions', { method: 'POST', body: '{}' }), env)
    await response.body.cancel()
    assert.equal(canceled, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

let sequence = 0
async function tracked(response, check, { valid = true, token = 'user-token' } = {}) {
  const originalFetch = globalThis.fetch
  const events = [], upstream = []
  const configured = { ...env, PB_URL: `http://pb-${++sequence}.invalid`, PB_SUPERUSER_EMAIL: 'admin', PB_SUPERUSER_PASSWORD: 'test' }
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/_superusers/auth-with-password')) return Response.json({ token: 'superuser-token' })
    if (url.endsWith('/api/internal/verify-auth')) return Response.json({ valid, id: valid ? 'user-id' : undefined })
    if (url.endsWith('/usage_events/records')) { events.push(JSON.parse(options.body)); return Response.json({ id: 'event' }) }
    upstream.push(options)
    return response
  }
  try {
    const result = await proxyLlm(new Request('https://local.invalid/llm/chat/completions', {
      method: 'POST', headers: { 'x-pb-token': token, authorization: 'Bearer browser-value' },
      body: JSON.stringify({ model: 'test', stream: true, messages: [] }),
    }), configured)
    await check(result, events, upstream)
  } finally { globalThis.fetch = originalFetch }
}

function chunked(chunks, status = 200) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
      controller.close()
    },
  }), { status, headers: { 'content-type': 'text/event-stream' } })
}

test('authenticated SSE preserves bytes and records split usage once', async () => {
  const chunks = ['data: {"choices":[]}\r\n\r\ndata: {"us', 'age":{"prompt_tokens":12,"completion_', 'tokens":7}}\r\n\r\ndata: [DONE]']
  await tracked(chunked(chunks), async (response, events, upstream) => {
    assert.equal(await response.text(), chunks.join(''))
    await setImmediate()
    assert.deepEqual(events, [{ owner: 'user-id', model: 'test', gateway: false, tokensKnown: true, promptTokens: 12, completionTokens: 7 }])
    assert.equal(upstream[0].headers.get('x-pb-token'), null)
    assert.equal(upstream[0].headers.get('authorization'), 'Bearer test-key')
    assert.equal(JSON.parse(upstream[0].body).stream_options.include_usage, true)
  })
})

test('successful streams without usage record unknown tokens', async () => {
  await tracked(chunked(['data: malformed\n\ndata: [DONE]\n\n']), async (response, events) => {
    await response.text()
    await setImmediate()
    assert.equal(events.length, 1)
    assert.equal(events[0].tokensKnown, false)
    assert.equal(events[0].completionTokens, 0)
  })
})

test('upstream errors and invalid identities do not create usage events', async () => {
  for (const options of [{ status: 429, valid: true }, { status: 200, valid: false }]) {
    await tracked(chunked(['data: [DONE]\n'], options.status), async (response, events) => {
      assert.equal(response.status, options.status)
      await response.text()
      await setImmediate()
      assert.deepEqual(events, [])
    }, options)
  }
})

test('cancelled authenticated streams do not create completed usage events', async () => {
  let cancelled = false
  await tracked(new Response(new ReadableStream({ cancel() { cancelled = true } })), async (response, events) => {
    await response.body.cancel()
    await setImmediate()
    assert.equal(cancelled, true)
    assert.deepEqual(events, [])
  })
})

test('non-streaming JSON responses retain their usage totals', async () => {
  await tracked(Response.json({ choices: [], usage: { prompt_tokens: 4, completion_tokens: 2 } }), async (response, events) => {
    assert.equal((await response.json()).usage.prompt_tokens, 4)
    await setImmediate()
    assert.equal(events.length, 1)
    assert.equal(events[0].tokensKnown, true)
    assert.equal(events[0].promptTokens, 4)
    assert.equal(events[0].completionTokens, 2)
  })
})

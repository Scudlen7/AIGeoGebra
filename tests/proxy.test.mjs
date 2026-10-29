import assert from 'node:assert/strict'
import test from 'node:test'
import { proxyLlm } from '../functions/_lib/llm.js'

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

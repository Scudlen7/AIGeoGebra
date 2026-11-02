import assert from 'node:assert/strict'
import test from 'node:test'
import { verifyUser, recordUsage } from '../functions/_lib/usage.js'

test('PocketBase authentication network failure does not break model requests', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('unreachable') }
  try {
    assert.equal(await verifyUser({ PB_URL: 'http://down.invalid', PB_SUPERUSER_EMAIL: 'test', PB_SUPERUSER_PASSWORD: 'test' }, 'token'), null)
  } finally { globalThis.fetch = original }
})

test('usage write rejects non-success status instead of silently treating it as saved', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async url => url.includes('auth-with-password')
    ? Response.json({ token: 'test-token' }) : Response.json({ message: 'failed' }, { status: 500 })
  try {
    assert.equal(await recordUsage({ PB_URL: 'http://usage.invalid', PB_SUPERUSER_EMAIL: 'test', PB_SUPERUSER_PASSWORD: 'test' }, { owner: 'test' }), false)
  } finally { globalThis.fetch = original }
})

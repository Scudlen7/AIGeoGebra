import assert from 'node:assert/strict'
import test from 'node:test'
import { providerBaseUrl, resolvePublicAddress } from '../server/model-upstream.js'

test('personal providers reject IP literals, credentials, non-HTTPS URLs and nonstandard ports', () => {
  for (const url of [
    'https://127.1/v1', 'https://2130706433/v1', 'https://[::ffff:127.0.0.1]/v1',
    'https://user:password@api.example.com/v1', 'https://api.example.com:8443/v1',
    'https://api.example.com/v1?api_key=secret', 'https://api.example.com/v1#fragment',
    'http://api.example.com/v1', 'https://localhost/v1',
  ]) assert.throws(() => providerBaseUrl(url), { status: 400 })
  assert.equal(providerBaseUrl('https://API.example.com:443/compatible/v1/'), 'https://api.example.com/compatible/v1')
})

test('a public-looking name cannot resolve to loopback, cloud metadata, or a private network', async () => {
  const target = new URL('https://api.example.com/v1/models')
  for (const address of ['127.0.0.1', '10.10.10.1', '100.100.100.200', '169.254.169.254', '192.168.1.1', '168.63.129.16', '::1']) {
    await assert.rejects(resolvePublicAddress(target, async () => ({ address })), { status: 400 })
  }
  assert.equal(await resolvePublicAddress(target, async (host, options) => {
    assert.equal(host, 'api.example.com')
    assert.equal(options.family, 4)
    return { address: '8.8.8.8' }
  }), '8.8.8.8')
})

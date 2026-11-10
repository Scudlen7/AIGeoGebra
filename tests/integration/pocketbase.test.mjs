import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, dirname, basename } from 'node:path'
import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { verifyUser, recordUsage } from '../../functions/_lib/usage.js'
import { providersRequest } from '../../server/model-providers.js'

// This suite always creates its own database and SMTP inbox. It never uses .env.
test('real PocketBase account, email, session and usage integration', { timeout: 90000 }, async t => {
  assert.ok(process.env.PB_BINARY, 'Set PB_BINARY to the PocketBase 0.40.4 executable')
  const folder = await mkdtemp(join(tmpdir(), 'aiggb-integration-'))
  const mail = []
  const sockets = new Set()
  const smtp = createServer(socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    socket.write('220 localhost test SMTP\r\n')
    let buffer = '', data = null
    socket.on('data', chunk => {
      buffer += chunk.toString()
      let end
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        if (data !== null) {
          if (line === '.') { mail.push(data.join('\r\n')); data = null; socket.write('250 queued\r\n') }
          else data.push(line.replace(/^\.\./, '.'))
        } else if (/^(EHLO|HELO)/i.test(line)) socket.write('250 localhost\r\n')
        else if (/^DATA/i.test(line)) { data = []; socket.write('354 send message\r\n') }
        else if (/^QUIT/i.test(line)) socket.end('221 bye\r\n')
        else socket.write('250 OK\r\n')
      }
    })
  })
  smtp.listen(0, '127.0.0.1')
  await once(smtp, 'listening')
  const portProbe = createServer().listen(0, '127.0.0.1')
  await once(portProbe, 'listening')
  const port = portProbe.address().port
  await new Promise(resolve => portProbe.close(resolve))
  const base = `http://127.0.0.1:${port}`
  const password = `Test-${randomUUID()}`
  const flags = ['--dir', folder, '--migrationsDir', resolve('pb_migrations'), '--hooksDir', resolve('pb_hooks')]
  let processHandle
  const stop = async () => {
    if (processHandle && processHandle.exitCode === null) {
      const exited = once(processHandle, 'exit')
      processHandle.kill()
      await exited
    }
  }
  t.after(async () => {
    await stop()
    for (const socket of sockets) socket.destroy()
    await new Promise(resolve => smtp.close(resolve))
    // Only remove the exact isolated folder created by this test.
    assert.equal(dirname(folder), resolve(tmpdir()))
    assert.ok(basename(folder).startsWith('aiggb-integration-'))
    await rm(folder, { recursive: true, force: true })
  })
  const bootstrap = spawn(process.env.PB_BINARY, ['superuser', 'upsert', 'admin@example.test', password, ...flags], { windowsHide: true, stdio: 'ignore' })
  assert.equal((await once(bootstrap, 'exit'))[0], 0, 'PocketBase migrations and superuser setup')
  async function start() {
    processHandle = spawn(process.env.PB_BINARY, ['serve', `--http=127.0.0.1:${port}`, '--hooksWatch=false', ...flags], { windowsHide: true, stdio: 'ignore' })
    for (let attempt = 0; attempt < 100; attempt++) {
      if (processHandle.exitCode !== null) throw new Error('PocketBase exited before becoming ready')
      try { if ((await fetch(`${base}/api/health`)).ok) return } catch {}
      await delay(100)
    }
    throw new Error('PocketBase did not become ready')
  }
  await start()
  async function api(path, { method = 'GET', body, token } = {}) {
    const response = await fetch(`${base}${path}`, {
      method, headers: { 'content-type': 'application/json', ...(token ? { authorization: token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000),
    })
    const text = await response.text()
    return { status: response.status, data: text ? JSON.parse(text) : null }
  }
  const post = (path, body, token) => api(path, { method: 'POST', body, token })
  const admin = (await post('/api/collections/_superusers/auth-with-password', { identity: 'admin@example.test', password })).data.token
  assert.ok(admin)
  const settings = await api('/api/settings', { token: admin })
  const configured = await api('/api/settings', { method: 'PATCH', token: admin, body: {
    meta: { ...settings.data.meta, senderAddress: 'no-reply@example.test', senderName: 'Integration' },
    smtp: { ...settings.data.smtp, enabled: true, host: '127.0.0.1', port: smtp.address().port, username: '', password: '', tls: false, authMethod: '' },
  } })
  assert.equal(configured.status, 200, JSON.stringify(configured.data))
  const email = 'alice@example.test'
  let alice, bob, session
  function lastCode() {
    const message = mail.at(-1)
    assert.ok(message, 'The local SMTP inbox received the actual email')
    const code = message.match(/<b>(\d{4})<\/b>/)?.[1]
    assert.ok(code, 'Email contains a four-digit code')
    return code
  }
  async function register(address, name) {
    assert.equal((await post('/api/auth/request-code', { email: address, purpose: 'register' })).status, 200)
    const result = await post('/api/auth/register', { name, email: address, password, passwordConfirm: password, code: lastCode() })
    assert.equal(result.status, 200, JSON.stringify(result.data))
    return result.data
  }
  await t.test('registration sends mail, enforces resend delay and consumes codes', async () => {
    assert.equal((await post('/api/auth/request-code', { email, purpose: 'register' })).status, 200)
    const code = lastCode()
    assert.equal((await post('/api/auth/request-code', { email, purpose: 'register' })).status, 429)
    const body = { name: '测试甲', email, password, passwordConfirm: password, code }
    const response = await post('/api/auth/register', body)
    assert.equal(response.status, 200, JSON.stringify(response.data))
    alice = response.data
    assert.equal(alice.record.verified, true)
    assert.equal((await post('/api/auth/register', body)).status, 400)
    bob = await register('bob@example.test', '测试乙')
    assert.equal((await post('/api/collections/users/records', { email: 'bypass@example.test', password, passwordConfirm: password })).status, 403)
  })
  await t.test('five wrong attempts invalidate a code', async () => {
    const address = 'attempts@example.test'
    assert.equal((await post('/api/auth/request-code', { email: address, purpose: 'register' })).status, 200)
    const code = lastCode()
    const body = { name: '错误验证', email: address, password, passwordConfirm: password, code: code === '0000' ? '0001' : '0000' }
    for (let i = 0; i < 5; i++) assert.equal((await post('/api/auth/register', body)).status, 400)
    assert.equal((await post('/api/auth/register', { ...body, code })).status, 400)
  })
  await t.test('sessions persist full board snapshots and remain private across users', async () => {
    const boardXml = '<geogebra><construction><element type="point" label="A"><coords x="2" y="3" z="1"/></element></construction></geogebra>'
    const created = await post('/api/collections/sessions/records', {
      owner: alice.record.id, name: '云端构造', mode: 'geometry', messages: [], input: '草稿', report: { boardXml, commands: [] },
    }, alice.token)
    assert.equal(created.status, 200, JSON.stringify(created.data))
    session = created.data
    const path = `/api/collections/sessions/records/${session.id}`
    assert.equal((await api(path, { token: alice.token })).data.report.boardXml, boardXml)
    assert.equal((await api('/api/collections/sessions/records', { token: bob.token })).data.totalItems, 0)
    assert.equal((await api(path, { token: bob.token })).status, 404)
    assert.equal((await api(path, { method: 'PATCH', token: bob.token, body: { name: '越权' } })).status, 404)
    assert.equal((await api(path, { method: 'DELETE', token: bob.token })).status, 404)
    assert.equal((await api(path, { method: 'PATCH', token: alice.token, body: { name: '已重命名', input: '新草稿' } })).status, 200)
    const stolen = await post('/api/collections/sessions/records', { ...session, id: undefined, owner: alice.record.id }, bob.token)
    assert.equal(stolen.status, 400)
    await stop()
    await start()
    assert.equal((await api(path, { token: alice.token })).data.input, '新草稿')
  })
  await t.test('authenticated usage is recorded and summaries are scoped to the user', async () => {
    const env = { PB_URL: base, PB_SUPERUSER_EMAIL: 'admin@example.test', PB_SUPERUSER_PASSWORD: password }
    assert.deepEqual(await verifyUser(env, alice.token), { id: alice.record.id })
    assert.equal(await verifyUser(env, 'invalid'), null)
    assert.equal((await post('/api/internal/verify-auth', { token: alice.token }, bob.token)).status, 401)
    assert.equal(await recordUsage(env, { owner: alice.record.id, model: 'fixture', gateway: true, tokensKnown: true, promptTokens: 10, completionTokens: 5 }), true)
    const summary = (await api('/api/usage/summary', { token: alice.token })).data
    assert.equal(summary.requests, 1)
    assert.equal(summary.tokens, 15)
    assert.equal(summary.sessions, 1)
    assert.equal(summary.gatewayMonth.tokens, 15)
    assert.equal((await api('/api/usage/summary', { token: bob.token })).data.requests, 0)
    assert.equal((await api('/api/usage/summary')).status, 401)
    assert.equal((await post('/api/collections/usage_events/records', { owner: alice.record.id, model: 'fake' }, alice.token)).status, 403)
  })
  let aliceProvider
  await t.test('personal providers keep keys private and stream only for their owner', async () => {
    const env = {
      PB_URL: base, PB_SUPERUSER_EMAIL: 'admin@example.test', PB_SUPERUSER_PASSWORD: password,
      MODEL_PROVIDER_ENCRYPTION_KEY: '45'.repeat(32),
    }
    const path = '/api/providers'
    const key = 'fixture-alice-private-key'
    const upstreamCalls = []
    const fixture = [
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":8,"output_tokens":1}}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":3}}\n\n',
    ].join('')
    async function upstream(url, options) {
      upstreamCalls.push({ url: url.href, headers: options.headers, body: options.body && JSON.parse(options.body) })
      if (url.hostname === 'redirect.example.com') return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/' } })
      if (url.pathname.endsWith('/models')) {
        if (url.searchParams.has('after_id')) return Response.json({ data: [{ id: 'second-model' }], has_more: false })
        return Response.json({ data: [{ id: 'claude-fixture', display_name: 'Claude Fixture' }, { id: key }], has_more: true, last_id: 'claude-fixture' })
      }
      if (!JSON.parse(options.body).stream) return Response.json({ content: [{ type: 'text', text: 'OK' }], choices: [{ message: { content: 'OK' } }] })
      return new Response(fixture, { headers: { 'content-type': 'text/event-stream' } })
    }
    async function request(token, suffix = '', method = 'GET', body) {
      return providersRequest(new Request(`https://app.example.test${path}${suffix}`, {
        method, headers: { 'x-pb-token': token ?? '', cookie: 'app-secret-cookie=1' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }), env, upstream)
    }
    const input = { name: 'Alice Claude', baseUrl: 'https://api.anthropic.com', protocol: 'anthropic', apiKey: key }
    assert.equal((await request('', '/discover', 'POST', input)).status, 401)
    assert.equal(upstreamCalls.length, 0)
    const found = await (await request(alice.token, '/discover', 'POST', input)).json()
    assert.deepEqual(found, [{ id: 'claude-fixture', label: 'Claude Fixture' }, { id: 'second-model', label: 'second-model' }])
    assert.equal(upstreamCalls[0].url, 'https://api.anthropic.com/v1/models?limit=100')
    assert.equal(upstreamCalls[0].headers['x-api-key'], key)
    const created = await request(alice.token, '', 'POST', { ...input, models: found, owner: bob.record.id })
    assert.equal(created.status, 201)
    const raw = await created.text()
    assert.ok(!raw.includes(key) && !raw.includes('keyCiphertext'))
    const saved = JSON.parse(raw)
    aliceProvider = saved.id
    const collection = '/api/collections/model_providers/records'
    assert.equal((await api(`${collection}/${saved.id}`, { token: alice.token })).status, 403)
    const adminRecord = (await api(`${collection}/${saved.id}`, { token: admin })).data
    assert.equal(adminRecord.owner, alice.record.id)
    assert.ok(adminRecord.keyCiphertext && !adminRecord.keyCiphertext.includes(key))
    assert.deepEqual(await (await request(bob.token)).json(), [])
    assert.deepEqual(await (await request(alice.token)).json(), [saved])
    assert.equal((await request(bob.token, '/' + saved.id, 'DELETE')).status, 404)
    assert.equal((await request(bob.token, '/' + saved.id + '/messages', 'POST', { model: 'claude-fixture' })).status, 404)
    assert.equal((await request(bob.token, '/discover', 'POST', { ...input, id: saved.id, apiKey: '' })).status, 404)
    assert.equal((await request(alice.token, '/discover', 'POST', { ...input, id: saved.id, apiKey: '', baseUrl: 'https://different.example.com/v1' })).status, 400)
    assert.equal(upstreamCalls.length, 2)
    assert.equal((await request(alice.token, '/' + saved.id, 'PUT', { ...saved, name: 'Renamed Claude' })).status, 200)
    assert.equal((await request(alice.token, '/' + saved.id + '/messages', 'POST', { model: 'unlisted' })).status, 404)
    const tested = await request(alice.token, '/' + saved.id + '/test', 'POST', { model: 'claude-fixture' })
    assert.equal((await tested.json()).ok, true)
    const turn = await request(alice.token, '/' + saved.id + '/messages', 'POST', { model: 'claude-fixture', stream: true })
    assert.equal(turn.headers.get('cache-control'), 'no-store')
    assert.equal(await turn.text(), fixture)
    const forwarded = upstreamCalls.at(-1)
    assert.equal(forwarded.url, 'https://api.anthropic.com/v1/messages')
    assert.equal(forwarded.headers['x-api-key'], key)
    assert.equal(forwarded.headers['x-pb-token'], undefined)
    assert.equal(forwarded.headers.cookie, undefined)
    let summary
    for (let attempt = 0; attempt < 20; attempt++) {
      summary = (await api('/api/usage/summary', { token: alice.token })).data
      if (summary.requests === 2) break
      await delay(25)
    }
    assert.equal(summary.tokens, 26)
    assert.equal((await api('/api/usage/summary', { token: bob.token })).data.requests, 0)

    const openAiInput = {
      name: 'Bob custom', baseUrl: 'https://public.example.com/custom/', protocol: 'openai',
      apiKey: 'fixture-bob-private-key', models: [{ id: 'manual-model' }],
    }
    const bobProvider = await (await request(bob.token, '', 'POST', openAiInput)).json()
    assert.equal(bobProvider.baseUrl, 'https://public.example.com/custom')
    const compatible = await request(bob.token, '/' + bobProvider.id + '/chat/completions', 'POST', { model: 'manual-model', stream: false })
    assert.equal(compatible.status, 200)
    await compatible.text()
    assert.equal(upstreamCalls.at(-1).url, 'https://public.example.com/custom/chat/completions')
    assert.equal(upstreamCalls.at(-1).headers.authorization, 'Bearer fixture-bob-private-key')
    assert.equal((await request(bob.token, '/' + bobProvider.id, 'DELETE')).status, 200)
    const redirected = await request(bob.token, '/discover', 'POST', { ...openAiInput, baseUrl: 'https://redirect.example.com/v1' })
    assert.equal(redirected.status, 422)
    assert.ok(!(await redirected.text()).includes('127.0.0.1'))
  })
  await t.test('password reset invalidates old credentials and cannot reuse a code', async () => {
    assert.equal((await post('/api/auth/request-code', { email, purpose: 'reset' })).status, 200)
    const body = { email, password: `${password}-reset`, passwordConfirm: `${password}-reset`, code: lastCode() }
    assert.equal((await post('/api/auth/reset-password', body)).status, 200)
    assert.equal((await post('/api/auth/reset-password', body)).status, 400)
    assert.equal((await post('/api/collections/users/auth-with-password', { identity: email, password })).status, 400)
    assert.equal((await post('/api/collections/users/auth-refresh', {}, alice.token)).status, 401)
    const login = await post('/api/collections/users/auth-with-password', { identity: email, password: body.password })
    assert.equal(login.status, 200)
    alice = login.data
  })
  await t.test('email change requires the current account and a new email code', async () => {
    const nextEmail = 'changed@example.test'
    assert.equal((await api(`/api/collections/users/records/${alice.record.id}`, { method: 'PATCH', token: alice.token, body: { email: nextEmail } })).status, 400)
    assert.equal((await post('/api/auth/request-code', { email: nextEmail, purpose: 'email_change' }, alice.token)).status, 200)
    const body = { email: nextEmail, code: lastCode() }
    assert.equal((await post('/api/auth/change-email', body, bob.token)).status, 400)
    assert.equal((await post('/api/auth/change-email', body, alice.token)).status, 200)
    const login = await post('/api/collections/users/auth-with-password', { identity: nextEmail, password: `${password}-reset` })
    assert.equal(login.status, 200)
    alice = login.data
    assert.equal(alice.record.verified, true)
  })
  await t.test('account deletion removes its sessions, providers and usage, preserving other accounts', async () => {
    assert.equal((await api(`/api/collections/users/records/${alice.record.id}`, { method: 'DELETE', token: alice.token })).status, 204)
    assert.equal((await api(`/api/collections/sessions/records/${session.id}`, { token: admin })).status, 404)
    assert.equal((await api(`/api/collections/model_providers/records/${aliceProvider}`, { token: admin })).status, 404)
    const usage = (await api('/api/collections/usage_events/records', { token: admin })).data.items
    assert.deepEqual(usage.map((item) => item.owner), [bob.record.id])
    assert.equal((await post('/api/collections/users/auth-refresh', {}, bob.token)).status, 200)
  })
})

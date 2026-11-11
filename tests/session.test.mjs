import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { loadTs } from './load-ts.mjs'

beforeEach(() => {
  const values = new Map()
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size },
  }
})

test('new sessions require a first message and derive a title while preserving explicit names', async () => {
  const writes = []
  globalThis.__createSession = async payload => { writes.push(payload); return { ...payload, id: 'saved' } }
  const { saveCloudSession, blankCloud, sessionTitle } = await loadTs('src/api.ts', { mocks: {
    './pb': `export const authUser = () => ({ id: 'user-a' }); export const pb = { collection: () => ({ create: globalThis.__createSession }) }`,
  } })
  const slot = blankCloud('geometry')
  await assert.rejects(() => saveCloudSession({ ...slot, input: 'not sent' }, [], null), /第一条消息/)
  assert.equal(writes.length, 0)
  const messages = [{ role: 'user', content: '帮我画一个平行四边形。标出对角线。' }]
  assert.equal((await saveCloudSession(slot, messages, null)).name, '平行四边形')
  assert.equal((await saveCloudSession({ ...slot, name: '我的练习' }, messages, null)).name, '我的练习')
  assert.equal(sessionTitle('请画一个三角形'), '三角形')
})

test('guest normalization preserves a full board snapshot alongside the latest log', async () => {
  const { normalizeSessions } = await loadTs('src/session.ts')
  const boardXml = '<geogebra><construction><element label="A"/><element label="manual"/></construction></geogebra>'
  const report = { results: [], objects: [], hint: '', boardXml }
  const restored = normalizeSessions({ geometry: { messages: [], input: '', report } })
  assert.equal(restored.geometry.report.boardXml, boardXml)
  assert.equal(restored['3d'].report, null)
})

test('unsent cloud changes survive reload and stay isolated by owner and session', async () => {
  const first = await loadTs('src/session.ts')
  const pending = { id: 'session-a', name: 'draft', mode: 'geometry', messages: [{ role: 'user', content: 'private' }], input: '', report: { results: [], objects: [], hint: '', boardXml: '<geogebra/>' } }
  const other = { ...pending, id: 'session-b', input: 'another draft', report: null }
  localStorage.setItem('aiggb.cloud.user-a.geometry', JSON.stringify(pending))
  assert.deepEqual(first.readPendingSession('user-a', pending.id), pending)
  assert.equal(first.readPendingSession('user-a', other.id), null)
  first.writePendingCloud('user-a', 'geometry', pending)
  first.writePendingCloud('user-a', 'geometry', other)
  const reloaded = await loadTs('src/session.ts')
  assert.deepEqual(reloaded.readPendingSession('user-a', pending.id), pending)
  assert.deepEqual(reloaded.readPendingSession('user-a', other.id), other)
  assert.equal(reloaded.readPendingSession('user-b', pending.id), null)
  assert.equal(reloaded.readPendingCloud('user-a', 'geometry'), null)
  assert.equal(reloaded.emptySessions().geometry.messages.length, 0)
  reloaded.writePendingCloud('user-a', 'geometry', null, pending.id)
  assert.equal(reloaded.readPendingSession('user-a', pending.id), null)
  assert.deepEqual(reloaded.readPendingSession('user-a', other.id), other)
})

test('legacy guest data remains readable without a board snapshot', async () => {
  const { migrateLegacyStorage, normalizeSessions } = await loadTs('src/session.ts')
  const report = { results: [{ command: 'A=(0,0)', status: 'ok', labels: ['A'], error: null }], objects: [], hint: '' }
  localStorage.setItem('aiggb.messages', JSON.stringify([{ role: 'user', content: 'draw A' }]))
  localStorage.setItem('aiggb.report', JSON.stringify(report))
  migrateLegacyStorage()
  const migrated = normalizeSessions(JSON.parse(localStorage.getItem('aiggb.sessions')))
  assert.deepEqual(migrated.geometry.report, report)
  assert.equal(migrated.geometry.messages[0].content, 'draw A')
  assert.equal(localStorage.getItem('aiggb.report'), null)
})

test('saving a reopened session waits for its earlier write and preserves its cloud name', async () => {
  const writes = []
  let finishFirst
  const held = new Promise(resolve => { finishFirst = resolve })
  globalThis.__sessionUpdate = (id, payload) => {
    writes.push({ id, payload })
    return writes.length === 1 ? held : Promise.resolve({ name: 'Renamed in the workbench' })
  }
  try {
    const { saveCloudSession } = await loadTs('src/api.ts', { mocks: {
      './pb': `export const authUser = () => ({ id: 'user-a' })
        export const pb = { collection: () => ({ update: globalThis.__sessionUpdate }) }`,
    } })
    const slot = { id: 'session-a', name: 'Old name', mode: 'geometry', input: '', messages: [], report: null }
    const first = saveCloudSession({ ...slot, input: 'first draft' }, [], null)
    const reopened = saveCloudSession({ ...slot, input: 'newer draft' }, [], null)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(writes, [{ id: slot.id, payload: { input: 'first draft', messages: [], report: null } }])
    finishFirst({ name: 'Renamed in the workbench' })
    await first
    assert.deepEqual(await reopened, { id: slot.id, name: 'Renamed in the workbench' })
    assert.deepEqual(writes.at(-1), { id: slot.id, payload: { input: 'newer draft', messages: [], report: null } })
  } finally {
    delete globalThis.__sessionUpdate
  }
})

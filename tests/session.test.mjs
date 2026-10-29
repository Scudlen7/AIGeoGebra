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

test('guest normalization preserves a full board snapshot alongside the latest log', async () => {
  const { normalizeSessions } = await loadTs('src/session.ts')
  const boardXml = '<geogebra><construction><element label="A"/><element label="manual"/></construction></geogebra>'
  const report = { results: [], objects: [], hint: '', boardXml }
  const restored = normalizeSessions({ geometry: { messages: [], input: '', report } })
  assert.equal(restored.geometry.report.boardXml, boardXml)
  assert.equal(restored['3d'].report, null)
})

test('unsent cloud changes survive reload and stay isolated by owner and mode', async () => {
  const first = await loadTs('src/session.ts')
  const pending = { id: 'session-a', name: 'draft', mode: 'geometry', messages: [{ role: 'user', content: 'private' }], input: '', report: { results: [], objects: [], hint: '', boardXml: '<geogebra/>' } }
  first.writePendingCloud('user-a', 'geometry', pending)
  const reloaded = await loadTs('src/session.ts')
  assert.deepEqual(reloaded.readPendingCloud('user-a', 'geometry'), pending)
  assert.equal(reloaded.readPendingCloud('user-b', 'geometry'), null)
  assert.equal(reloaded.readPendingCloud('user-a', '3d'), null)
  assert.equal(reloaded.emptySessions().geometry.messages.length, 0)
  reloaded.writePendingCloud('user-a', 'geometry', null)
  assert.equal(reloaded.readPendingCloud('user-a', 'geometry'), null)
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

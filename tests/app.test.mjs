import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { afterEach, test } from 'node:test'
import { Window } from 'happy-dom'
import { loadTs } from './load-ts.mjs'

const emptyXml = '<geogebra><construction/></geogebra>'
const mocks = {
  './AccountBar': 'export const AccountBar = () => null',
  './markdown': 'export const renderMarkdown = text => text',
  'solid-transition-group': 'export const TransitionGroup = props => props.children',
  './pb': `
    import { createSignal } from 'solid-js'
    const state = globalThis.__testState
    const [user, setUser] = createSignal(state.user)
    const listeners = new Set()
    export const authUser = user
    export const loggedIn = () => Boolean(user())
    export const authToken = () => user()?.id || ''
    export const pb = {
      authStore: {
        get isValid() { return Boolean(user()) },
        get record() { return user() },
        get token() { return user()?.id || '' },
        onChange: callback => { listeners.add(callback); return () => listeners.delete(callback) },
        save: (token, record) => state.changeUser(record),
      },
      collection: () => ({ update: async (id, patch) => ({ ...user(), ...patch }) }),
    }
    state.changeUser = value => { state.user = value; setUser(value); for (const listener of listeners) listener() }
  `,
  './api': `
    const state = globalThis.__testState
    export const blankCloud = mode => ({ id: null, name: '', mode, messages: [], input: '', report: null })
    export const fetchModels = async () => [{ id: 'test', label: 'Test', gateway: false }]
    export const readableError = (error, fallback) => error?.message || fallback
    export const latestCloudSession = async mode => {
      const owner = state.user?.id
      if (state.loadHook) return state.loadHook(owner, mode)
      return structuredClone(state.cloud[owner]?.[mode] || blankCloud(mode))
    }
    export const loadCloudSession = async id => Object.values(state.cloud[state.user?.id] || {}).find(slot => slot.id === id)
    export const saveCloudSession = async (slot, messages, report, owner = state.user?.id) => {
      state.saves.push(structuredClone({ owner, slot, messages, report }))
      if (state.failSave) throw new Error('offline')
      if (state.saveHook) return state.saveHook(slot)
      const saved = { ...slot, id: slot.id || 'created-' + owner, name: slot.name || 'Saved', messages, report }
      ;(state.cloud[owner] ||= {})[slot.mode] = structuredClone(saved)
      return { id: saved.id, name: saved.name }
    }
  `,
  './chat': `
    const state = globalThis.__testState
    export const fetchLlmStatus = async () => ({ configured: true, model: 'test' })
    export const hasFailure = report => Boolean(report?.results.some(item => item.status === 'failed'))
    export const runTurn = options => new Promise((resolve, reject) => {
      state.turns.push({ ...options, resolve, reject })
      options.signal.addEventListener('abort', () => {
        if (state.rejectOnAbort) reject(new DOMException('Aborted', 'AbortError'))
      }, { once: true })
    })
  `,
  './board': `
    const state = globalThis.__testState
    export const mountBoard = async (host, options) => { state.xml = ${JSON.stringify(emptyXml)}; state.mounts.push(options.appName) }
    export const unmountBoard = () => { state.boardListeners.clear() }
    export const captureBoard = () => state.xml
    export const getApi = () => ({})
    export const restoreBoard = xml => { state.xml = xml; state.restores.push(xml) }
    export const listObjects = () => []
    export const onBoardChange = callback => { state.boardListeners.add(callback); return () => state.boardListeners.delete(callback) }
    export const resetBoard = () => { state.xml = ${JSON.stringify(emptyXml)} }
    export const resizeBoard = () => {}
    export const setCoordinateSystem = () => {}
    export const executeCommands = commands => { state.replays.push(commands); return state.replayResult || { results: [], objects: [], hint: '' } }
    export const restoreCommands = executeCommands
  `,
}

let cleanup
let activeWindow

afterEach(async () => {
  cleanup?.()
  cleanup = undefined
  await activeWindow?.happyDOM.abort()
  activeWindow?.close()
  activeWindow = undefined
})

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function waitFor(predicate, description = 'expected state') {
  const until = Date.now() + 3000
  while (!predicate()) {
    if (Date.now() > until) throw new Error('Timed out waiting for ' + description)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function mount({ user = null, cloud = {}, storage, state: previousState } = {}) {
  const window = new Window({ url: 'http://localhost/' })
  activeWindow = window
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLDivElement', 'HTMLTextAreaElement', 'Element', 'Node', 'Document', 'MutationObserver', 'ResizeObserver', 'localStorage', 'sessionStorage', 'CustomEvent', 'KeyboardEvent', 'Event']) {
    Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true })
  }
  globalThis.getComputedStyle = window.getComputedStyle.bind(window)
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window)
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window)
  if (storage) for (const [key, value] of storage) localStorage.setItem(key, value)
  const state = previousState || { user, cloud, turns: [], saves: [], mounts: [], restores: [], replays: [], boardListeners: new Set(), xml: emptyXml, rejectOnAbort: true }
  globalThis.__testState = state
  const source = await readFile('src/App.tsx', 'utf8')
  const { App, render } = await loadTs('src/App.tsx', { mocks, source: source + '\nexport { render } from "solid-js/web"' })
  const host = document.createElement('div')
  document.body.append(host)
  cleanup = render(() => App(), host)
  await waitFor(() => !document.querySelector('textarea').disabled, 'board ready')
  return state
}

function button(text) {
  return [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text)
}

async function submit(text, state) {
  const input = document.querySelector('textarea')
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  const index = state.turns.length
  document.querySelector('.conversation form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await waitFor(() => state.turns.length > index, 'model request')
  return state.turns[index]
}

function report(commands, failed = false) {
  return { results: commands.map((command, index) => ({ command, status: failed && index === commands.length - 1 ? 'failed' : 'ok', labels: [], error: null })), objects: [], hint: '' }
}

test('Escape releases the form immediately and a delayed old response cannot overwrite a new turn', async () => {
  const state = await mount()
  state.rejectOnAbort = false
  const first = await submit('first request', state)
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
  document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true }))
  await waitFor(() => !document.querySelector('textarea').disabled, 'Escape to release input')
  const second = await submit('second request', state)
  first.onText('old response')
  first.resolve('old response')
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(document.querySelector('textarea').disabled, true, 'the old finally block must not release the new request')
  second.resolve('new response')
  await waitFor(() => !document.querySelector('textarea').disabled)
  assert.match(document.querySelector('.transcript').textContent, /new response/)
  assert.doesNotMatch(document.querySelector('.transcript').textContent, /old response/)
})

test('full XML retains earlier turns, successful commands before correction, and manual edits on restore', async () => {
  const state = await mount()
  const first = await submit('create A and B', state)
  state.xml = '<geogebra><construction>A B</construction></geogebra>'
  first.onReport(report(['A=(0,0)', 'B=(1,0)']))
  first.resolve('points created')
  await waitFor(() => !document.querySelector('textarea').disabled)
  const second = await submit('add a segment and correct it', state)
  state.xml = '<geogebra><construction>A B segment</construction></geogebra>'
  second.onReport(report(['Segment(A,B)', 'BadCommand()'], true))
  state.xml = '<geogebra><construction>A B segment midpoint</construction></geogebra>'
  second.onReport(report(['Midpoint(A,B)']))
  second.resolve('corrected')
  await waitFor(() => !document.querySelector('textarea').disabled)
  const manualXml = '<geogebra><construction>A B segment midpoint manual-drag</construction></geogebra>'
  state.xml = manualXml
  for (const listener of state.boardListeners) listener()
  button('3D').click()
  await waitFor(() => state.mounts.at(-1) === '3d' && !document.querySelector('textarea').disabled)
  button('几何').click()
  await waitFor(() => state.mounts.at(-1) === 'geometry' && !document.querySelector('textarea').disabled)
  assert.equal(state.xml, manualXml)
  assert.equal(state.restores.at(-1), manualXml)
  assert.equal(state.replays.length, 0, 'new snapshots must not rely on the latest command batch')
})

test('failed cloud save survives mode switching and reload, then retry uploads the complete snapshot', async () => {
  const state = await mount({ user: { id: 'alice', name: 'Alice' } })
  state.failSave = true
  const turn = await submit('cloud draft', state)
  const xml = '<geogebra><construction>private draft</construction></geogebra>'
  state.xml = xml
  turn.onReport(report(['A=(0,0)']))
  turn.resolve('draft answer')
  await waitFor(() => button('重试同步') && !document.querySelector('textarea').disabled, 'failed sync retry')
  button('3D').click()
  await waitFor(() => state.mounts.at(-1) === '3d' && !document.querySelector('textarea').disabled)
  button('几何').click()
  await waitFor(() => state.xml === xml && !document.querySelector('textarea').disabled)
  const storage = Object.entries(localStorage)
  cleanup()
  cleanup = undefined
  await activeWindow.happyDOM.abort()
  activeWindow.close()
  const reloaded = await mount({ user: { id: 'alice', name: 'Alice' }, storage })
  assert.equal(reloaded.xml, xml)
  assert.match(document.querySelector('.transcript').textContent, /draft answer/)
  reloaded.failSave = false
  button('重试同步').click()
  await waitFor(() => document.body.textContent.includes('已同步到云端'))
  assert.equal(reloaded.saves.at(-1).report.boardXml, xml)
  assert.equal(reloaded.saves.at(-1).owner, 'alice')
})

test('switching account clears all modes and ignores the previous account model callbacks', async () => {
  const state = await mount({ user: { id: 'alice', name: 'Alice' } })
  state.rejectOnAbort = false
  const alice = await submit('alice secret', state)
  state.changeUser({ id: 'bob', name: 'Bob' })
  await waitFor(() => !document.querySelector('textarea').disabled)
  alice.onText('alice late answer')
  alice.onReport(report(['PrivateAliceObject=(0,0)']))
  alice.resolve('alice late answer')
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.doesNotMatch(document.querySelector('.transcript').textContent, /alice/)
  assert.equal(state.saves.some(item => item.owner === 'bob' && item.messages.some(message => message.content.includes('alice'))), false)
  const bob = await submit('bob question', state)
  bob.resolve('bob answer')
  await waitFor(() => document.body.textContent.includes('bob answer'))
})

test('Escape preserves a partial answer and the already executed construction', async () => {
  const state = await mount()
  const turn = await submit('partial request', state)
  const xml = '<geogebra><construction>already executed</construction></geogebra>'
  state.xml = xml
  turn.onReport(report(['A=(0,0)']))
  turn.onText('partial explanation')
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
  document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true }))
  await waitFor(() => !document.querySelector('textarea').disabled)
  assert.match(document.querySelector('.transcript').textContent, /partial explanation/)
  const saved = JSON.parse(localStorage.getItem('aiggb.sessions')).geometry
  assert.equal(saved.report.boardXml, xml)
  assert.equal(saved.messages.at(-1).content, 'partial explanation')
})

test('a late mode load from the old account cannot replace the new account workspace', async () => {
  const state = await mount({ user: { id: 'alice' } })
  const oldLoad = deferred()
  state.loadHook = (owner, mode) => owner === 'alice'
    ? oldLoad.promise
    : { id: 'bob-session', name: 'Bob only', mode, messages: [{ role: 'user', content: 'bob data' }], input: '', report: { results: [], objects: [], hint: '', boardXml: '<geogebra><construction>bob</construction></geogebra>' } }
  button('3D').click()
  await waitFor(() => document.querySelector('textarea').disabled)
  state.changeUser({ id: 'bob' })
  await waitFor(() => !document.querySelector('textarea').disabled)
  const bobXml = state.xml
  oldLoad.resolve({ id: 'alice-session', name: 'Alice secret', mode: '3d', messages: [{ role: 'user', content: 'alice data' }], input: '', report: null })
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(state.xml, bobXml)
  assert.match(document.querySelector('.transcript').textContent, /bob data/)
  assert.doesNotMatch(document.querySelector('.transcript').textContent, /alice/)
})

test('a drag immediately before account switch is backed up under the previous owner', async () => {
  const state = await mount({ user: { id: 'alice' } })
  const xml = '<geogebra><construction>alice unsaved drag</construction></geogebra>'
  state.xml = xml
  for (const listener of state.boardListeners) listener()
  state.changeUser({ id: 'bob' })
  await waitFor(() => !document.querySelector('textarea').disabled)
  assert.notEqual(state.xml, xml)
  state.changeUser({ id: 'alice' })
  await waitFor(() => !document.querySelector('textarea').disabled)
  assert.equal(state.xml, xml)
  assert.equal(JSON.parse(localStorage.getItem('aiggb.cloud.alice.geometry')).report.boardXml, xml)
})

test('an in-flight save cannot mark newer manual changes as synchronized', async () => {
  const state = await mount({ user: { id: 'alice' } })
  const save = deferred()
  state.saveHook = () => save.promise
  const turn = await submit('first saved construction', state)
  state.xml = '<geogebra><construction>first</construction></geogebra>'
  turn.onReport(report(['A=(0,0)']))
  turn.resolve('first answer')
  await waitFor(() => state.saves.length === 1 && !document.querySelector('textarea').disabled)
  const latestXml = '<geogebra><construction>new manual change</construction></geogebra>'
  state.xml = latestXml
  for (const listener of state.boardListeners) listener()
  await waitFor(() => JSON.parse(localStorage.getItem('aiggb.cloud.alice.geometry'))?.report.boardXml === latestXml)
  state.saveHook = undefined
  save.resolve({ id: 'saved-alice', name: 'Saved' })
  await waitFor(() => state.saves.length === 2 && document.body.textContent.includes('已同步到云端'), 'newer revision to save')
  assert.equal(state.saves[1].slot.id, 'saved-alice', 'retry must update the newly created cloud record')
  assert.equal(state.saves[1].report.boardXml, latestXml)
  assert.equal(localStorage.getItem('aiggb.cloud.alice.geometry'), null)
})

test('rapid mode switches ignore an older duplicate cloud load after the newer load has been edited', async () => {
  const state = await mount({ user: { id: 'alice' } })
  const older = deferred()
  const newer = deferred()
  let loads = 0
  state.loadHook = (owner, mode) => mode === '3d'
    ? (++loads === 1 ? older.promise : newer.promise)
    : { id: null, name: '', mode, messages: [], input: '', report: null }
  button('3D').click()
  button('概率').click()
  button('3D').click()
  assert.equal(loads, 2)
  newer.resolve({ id: 'newer', name: 'Newer', mode: '3d', messages: [{ role: 'user', content: 'newer conversation' }], input: '', report: { ...report([]), boardXml: '<geogebra><construction>newer</construction></geogebra>' } })
  await waitFor(() => !document.querySelector('textarea').disabled)
  const editedXml = '<geogebra><construction>edited newer board</construction></geogebra>'
  state.xml = editedXml
  for (const listener of state.boardListeners) listener()
  older.resolve({ id: 'older', name: 'Older', mode: '3d', messages: [{ role: 'user', content: 'stale conversation' }], input: '', report: { ...report([]), boardXml: '<geogebra><construction>stale board</construction></geogebra>' } })
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(state.xml, editedXml)
  assert.match(document.querySelector('.transcript').textContent, /newer conversation/)
  assert.doesNotMatch(document.querySelector('.transcript').textContent, /stale conversation/)
  const input = document.querySelector('textarea')
  input.value = 'edited newer draft'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  const turn = await submit('continue newer conversation', state)
  assert.equal(turn.messages[0].content, 'newer conversation')
  turn.resolve('newer result')
  await waitFor(() => !document.querySelector('textarea').disabled)
})

test('a failed legacy restore offers a clean restart and allows another request', async () => {
  const legacy = { messages: [{ role: 'user', content: 'legacy request' }], input: '', report: report(['Segment(A,B)']) }
  const state = await mount({ storage: [['aiggb.sessions', JSON.stringify({ '3d': legacy })]] })
  state.replayResult = { results: [{ command: 'Segment(A,B)', status: 'failed', labels: [], error: 'missing A and B' }], objects: [], hint: '' }
  button('3D').click()
  await waitFor(() => button('清空并重新开始'), 'legacy recovery action')
  assert.equal(document.querySelector('textarea').disabled, true)
  assert.match(document.querySelector('.board-state').textContent, /未能完整恢复/)
  state.replayResult = undefined
  const mounts = state.mounts.length
  button('清空并重新开始').click()
  await waitFor(() => state.mounts.length > mounts && !document.querySelector('textarea').disabled)
  assert.equal(state.xml, emptyXml)
  assert.doesNotMatch(document.querySelector('.transcript').textContent, /legacy request/)
  const turn = await submit('new construction after recovery', state)
  turn.resolve('recovered successfully')
  await waitFor(() => !document.querySelector('textarea').disabled)
  assert.match(document.querySelector('.transcript').textContent, /recovered successfully/)
})

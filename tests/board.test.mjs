import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadTs } from './load-ts.mjs'

const board = await loadTs('src/board.ts')

async function mount(perspective) {
  const listeners = new Map()
  const objects = new Map()
  const fake = {
    xml: '<geogebra><construction/></geogebra>',
    perspectives: [],
    setErrorDialogsActive() {},
    setSize() {},
    setPerspective(value) { this.perspective = value; this.perspectives.push(value) },
    setRounding(value) { this.rounding = value },
    getAllObjectNames: () => [...objects.keys()],
    getObjectType: () => 'numeric',
    getCommandString: (name) => objects.get(name),
    getValueString: (name) => objects.get(name),
    getValue: (name) => objects.has(name) ? Number(objects.get(name).split('=')[1]) : 0,
    getXML() { return this.xml },
    setXML(xml) { this.xml = xml; emit('Clear'); listeners.get('Update')?.clear() },
    evalCommand(command) {
      const name = command.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*=/)?.[1]
      if (!name) return false
      objects.set(name, command)
      emit('Add', name)
      return true
    },
    reset() { objects.clear(); emit('Clear') },
  }
  function emit(type, ...args) {
    for (const listener of listeners.get(type) ?? []) listener(...args)
  }
  for (const type of ['Add', 'Remove', 'Update', 'Rename', 'Clear', 'StoreUndo', 'Client']) {
    fake[`register${type}Listener`] = (listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(listener)
    }
    fake[`unregister${type}Listener`] = (listener) => listeners.get(type)?.delete(listener)
  }
  globalThis.document = {
    createElement: () => ({ style: {}, remove() {} }),
    querySelector: () => null,
  }
  globalThis.window = {
    setTimeout, clearTimeout,
    GGBApplet: class {
      constructor(parameters) { this.parameters = parameters }
      inject() { this.parameters.appletOnLoad(fake) }
      setHTML5Codebase() {}
    },
  }
  await board.mountBoard({ appendChild() {}, clientWidth: 800, clientHeight: 600 }, {
    appName: perspective ? 'classic' : 'geometry', perspective,
    showToolBar: true, showAlgebraInput: true,
  })
  return { fake, emit, listeners }
}

test('full snapshots retain earlier turns, manual edits and more than 24 objects', async () => {
  const { fake } = await mount()
  const xml = `<geogebra><euclidianView/><construction>${Array.from({ length: 35 }, (_, i) => `<element label="p${i}"/>`).join('')}<element label="manual"/></construction></geogebra>`
  fake.xml = xml
  const saved = board.captureBoard()
  fake.xml = '<geogebra><construction/></geogebra>'
  board.restoreBoard(saved)
  assert.equal(board.captureBoard(), xml)
  board.unmountBoard()
  assert.equal(board.captureBoard(), null)
})

test('restoring probability snapshots retains the probability perspective', async () => {
  const { fake } = await mount('B')
  board.restoreBoard('<geogebra><probabilityCalculator/></geogebra>')
  assert.equal(fake.perspective, 'B')
  assert.equal(fake.rounding, '5')
})

test('manual edits notify, restoring does not, and old applet events are ignored', async () => {
  const first = await mount()
  let changes = 0
  const stop = board.onBoardChange(() => changes++)
  first.emit('Add', 'A')
  first.emit('Update', 'A')
  first.emit('Client', { type: 'viewChanged3D' })
  assert.equal(changes, 3)
  board.restoreBoard('<geogebra><construction/></geogebra>')
  assert.equal(changes, 3)
  await Promise.resolve()
  first.emit('Update', 'A')
  assert.equal(changes, 4, 'object updates continue after setXML clears listeners')
  stop()
  first.emit('Add', 'B')
  assert.equal(changes, 4)
  board.onBoardChange(() => changes++)
  await mount()
  first.emit('Add', 'C')
  assert.equal(changes, 4, 'unmounted applets cannot update the active session')
})

test('legacy command recovery replays over 24 commands and stops on first failure', async () => {
  await mount()
  const commands = Array.from({ length: 35 }, (_, i) => `p${i} = ${i}`)
  const restored = board.restoreCommands(commands, 'scientific', { enforceAngle: false })
  assert.equal(restored.results.length, 35)
  assert.ok(restored.results.every((item) => item.status === 'ok'))
  assert.equal(restored.objects.length, 35)
  await mount()
  const failed = board.restoreCommands([...commands.slice(0, 25), 'bad = unknown', 'after = 1'], 'scientific')
  assert.equal(failed.results[25].status, 'failed')
  assert.equal(failed.results[26].status, 'skipped')
  assert.equal(failed.objects.length, 25)
  await mount()
  assert.equal(board.executeCommands(commands, 'scientific').results.length, 24, 'new AI calls still have their original command limit')
})

test('a timed-out applet cannot replace the active API when loading eventually finishes', async () => {
  const { fake } = await mount()
  let timeout
  let parameters
  globalThis.window = {
    setTimeout(callback, delay) { if (delay === 30000) timeout = callback; return 1 },
    clearTimeout() {},
    GGBApplet: class {
      constructor(value) { parameters = value }
      inject() {}
      setHTML5Codebase() {}
    },
  }
  const loading = board.mountBoard({ appendChild() {} }, { appName: 'geometry', showToolBar: true, showAlgebraInput: true })
  await Promise.resolve()
  timeout()
  await assert.rejects(loading, /超时/)
  parameters.appletOnLoad(fake)
  assert.equal(board.getApi(), null)
})

test('probability sync resolves existing numeric variables and tolerates reordered XML attributes', async () => {
  const { fake } = await mount('B')
  fake.evalCommand('n = 4')
  fake.xml = '<geogebra><probabilityCalculator><distribution parameters="0,1" isOverlayActive="false" isCumulative="false" type="0"/><interval high="1" low="0" mode="0"/></probabilityCalculator></geogebra>'
  const result = board.executeCommands(['p = 1 - Poisson(3, n - 1, true)'], 'probability')
  assert.equal(result.results[0].status, 'ok')
  assert.match(fake.xml, /<distribution type="14"/)
  assert.match(fake.xml, /<interval mode="2" low="4"/)
  assert.deepEqual(fake.perspectives, ['B', 'B'], 'refresh the distribution selector and cumulative toggle after XML sync')
})

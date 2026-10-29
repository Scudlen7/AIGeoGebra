import { commandProblem } from './policy'
import { probabilitySelection } from './probability'
import type { AngleUnit, CalculatorMode, CommandResult, ConstructionReport, GgbObject } from './types'

type GgbListener = (...args: unknown[]) => void

type GgbApi = {
  evalCommand: (command: string) => boolean
  setErrorDialogsActive: (active: boolean) => void
  getAllObjectNames?: () => string[] | ArrayLike<string>
  getObjectNumber: () => number
  getObjectName: (index: number) => string
  getObjectType: (name: string) => string
  getCommandString: (name: string, localized?: boolean) => string
  getValueString: (name: string) => string
  getValue?: (name: string) => number
  getVisible?: (name: string) => boolean
  reset: () => void
  setSize: (width: number, height: number) => void
  refreshViews?: () => void
  setAxesVisible?: (xAxis: boolean, yAxis: boolean, zAxis?: boolean) => void
  setGridVisible?: (visible: boolean) => void
  getGridVisible?: () => boolean
  getXML?: () => string
  setXML?: (xml: string) => void
  setPerspective?: (perspective: string) => void
  getPerspectiveXML?: () => string
  setRounding?: (digits: string) => void
  registerAddListener?: (listener: GgbListener) => void
  unregisterAddListener?: (listener: GgbListener) => void
  registerRemoveListener?: (listener: GgbListener) => void
  unregisterRemoveListener?: (listener: GgbListener) => void
  registerUpdateListener?: (listener: GgbListener) => void
  unregisterUpdateListener?: (listener: GgbListener) => void
  registerRenameListener?: (listener: GgbListener) => void
  unregisterRenameListener?: (listener: GgbListener) => void
  registerClearListener?: (listener: GgbListener) => void
  unregisterClearListener?: (listener: GgbListener) => void
  registerStoreUndoListener?: (listener: GgbListener) => void
  unregisterStoreUndoListener?: (listener: GgbListener) => void
  registerClientListener?: (listener: GgbListener) => void
  unregisterClientListener?: (listener: GgbListener) => void
}

const SCRIPT_URL = 'https://www.geogebra.org/apps/deployggb.js'
const GEOGEBRA_CODEBASE = 'https://www.geogebra.org/apps/5.4.931.2/web3d/'

export type BoardOptions = {
  appName: string
  perspective?: string
  showToolBar: boolean
  showAlgebraInput: boolean
  coordinateSystem?: boolean
}

let api: GgbApi | null = null
let activeAppName = ''
let activePerspective = ''
let mountToken = 0
let slot: HTMLDivElement | null = null
let scriptReady: Promise<void> | null = null
let restoring = false
const boardListeners = new Set<() => void>()

function loadScript() {
  if (window.GGBApplet) return Promise.resolve()
  if (!scriptReady) {
    scriptReady = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = SCRIPT_URL
      script.async = true
      script.onload = () => resolve()
      script.onerror = () => {
        scriptReady = null
        reject(new Error('GeoGebra 脚本加载失败'))
      }
      document.head.appendChild(script)
    })
  }
  return scriptReady
}

export function getApi() {
  return api
}

export function currentAppName() {
  return activeAppName
}

export function unmountBoard() {
  for (const stop of [...boardListeners]) stop()
  mountToken += 1
  api = null
  activeAppName = ''
  activePerspective = ''
  slot?.remove()
  slot = null
}

export function captureBoard(): string | null {
  if (!api?.getXML) return null
  try {
    return api.getXML() || null
  } catch {
    return null
  }
}

export function restoreBoard(xml: string) {
  if (!api?.setXML) throw new Error('画板尚未就绪，无法恢复构造。')
  if (typeof xml !== 'string' || !/<geogebra\b/.test(xml) || !/<\/geogebra>\s*$/.test(xml)) {
    throw new Error('保存的画板数据不完整，无法恢复。')
  }
  restoring = true
  try {
    api.setXML(xml)
    api.setErrorDialogsActive(false)
    if (activePerspective) api.setPerspective?.(activePerspective)
    if (isProbabilityBoard()) api.setRounding?.('5')
    hideOnScreenKeyboard()
  } finally {
    restoring = false
  }
}

export function onBoardChange(listener: () => void): () => void {
  const target = api
  if (!target) return () => {}
  let active = true
  const notify = () => {
    if (active && api === target && !restoring) listener()
  }
  const clientChanged: GgbListener = (event) => {
    const type = event && typeof event === 'object' ? (event as { type?: string }).type : ''
    if (type && ['viewChanged2D', 'viewChanged3D', 'dragEnd', 'undo', 'redo', 'updateStyle', 'perspectiveChange'].includes(type)) notify()
  }
  const cleared = () => {
    // GeoGebra removes update listeners when setXML/reset clears a construction.
    queueMicrotask(() => {
      if (!active || api !== target) return
      target.unregisterUpdateListener?.(notify)
      target.registerUpdateListener?.(notify)
    })
    notify()
  }
  const registrations = [
    ['registerAddListener', 'unregisterAddListener', notify],
    ['registerRemoveListener', 'unregisterRemoveListener', notify],
    ['registerUpdateListener', 'unregisterUpdateListener', notify],
    ['registerRenameListener', 'unregisterRenameListener', notify],
    ['registerClearListener', 'unregisterClearListener', cleared],
    ['registerStoreUndoListener', 'unregisterStoreUndoListener', notify],
    ['registerClientListener', 'unregisterClientListener', clientChanged],
  ] as const
  for (const [register, , callback] of registrations) target[register]?.call(target, callback)
  const stop = () => {
    if (!active) return
    active = false
    boardListeners.delete(stop)
    for (const [, unregister, callback] of registrations) target[unregister]?.call(target, callback)
  }
  boardListeners.add(stop)
  return stop
}

export function mountBoard(host: HTMLElement, options: BoardOptions): Promise<void> {
  unmountBoard()
  const token = mountToken
  const target = document.createElement('div')
  target.className = 'ggb-slot'
  target.style.width = '100%'
  target.style.height = '100%'
  host.appendChild(target)
  slot = target

  return new Promise((resolve, reject) => {
    let settled = false
    let timeout = 0
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      callback()
    }
    timeout = window.setTimeout(() => {
      if (token !== mountToken) {
        finish(() => resolve())
        return
      }
      finish(() => reject(new Error('画板加载超时，请检查能否访问 geogebra.org')))
    }, 30000)

    const start = () => {
      if (settled) return
      if (token !== mountToken) {
        finish(() => resolve())
        return
      }
      if (!window.GGBApplet) {
        finish(() => reject(new Error('GeoGebra 脚本已加载，但没有暴露 GGBApplet')))
        return
      }
      const hostWidth = host.clientWidth || 800
      const hostHeight = host.clientHeight || 640
      const applet = new window.GGBApplet(
        {
          id: `aiggb${token}`,
          appName: options.appName,
          width: hostWidth,
          height: hostHeight,
          showToolBar: options.showToolBar,
          showAlgebraInput: options.showAlgebraInput,
          showMenuBar: false,
          showResetIcon: false,
          enableShiftDragZoom: true,
          errorDialogsActive: false,
          language: 'zh',
          ...(options.perspective ? { perspective: options.perspective } : {}),
          scaleContainerClass: 'board-host',
          appletOnLoad: (loaded: GgbApi) => {
            if (settled) return
            if (token !== mountToken) {
              finish(() => resolve())
              return
            }
            api = loaded
            activeAppName = options.appName
            activePerspective = options.perspective ?? ''
            api.setErrorDialogsActive(false)
            if (activePerspective) api.setPerspective?.(activePerspective)
            if (isProbabilityBoard()) api.setRounding?.('5')
            if (typeof options.coordinateSystem === 'boolean') applyCoordinateSystem(loaded, options.coordinateSystem)
            window.setTimeout(hideOnScreenKeyboard, 300)
            finish(() => resolve())
          },
        },
        true,
      )
      applet.setHTML5Codebase?.(GEOGEBRA_CODEBASE)
      applet.inject(target)
    }

    loadScript()
      .then(() => start())
      .catch((reason: unknown) => {
        if (token !== mountToken) {
          finish(() => resolve())
          return
        }
        const message = reason instanceof Error ? reason.message : 'GeoGebra 脚本加载失败'
        finish(() => reject(new Error(message)))
      })
  })
}

export function resizeBoard(width: number, height: number) {
  if (!api || width < 10 || height < 10) return
  api.setSize(Math.floor(width), Math.floor(height))
  hideOnScreenKeyboard()
}

export function resetBoard() {
  api?.reset()
  api?.setErrorDialogsActive(false)
  if (activePerspective) api?.setPerspective?.(activePerspective)
  if (isProbabilityBoard()) api?.setRounding?.('5')
  hideOnScreenKeyboard()
}

function applyCoordinateSystem(target: GgbApi, visible: boolean) {
  if (typeof target.setAxesVisible === 'function') target.setAxesVisible(visible, visible)
  else target.evalCommand(`ShowAxes(${visible})`)
  if (typeof target.setGridVisible === 'function') target.setGridVisible(visible)
  else target.evalCommand(`ShowGrid(${visible})`)
}

export function setCoordinateSystem(visible: boolean) {
  if (!api) return
  applyCoordinateSystem(api, visible)
}

function isProbabilityBoard() {
  return activePerspective === 'B' || activePerspective === 'B/G'
}

function syncProbabilityCalculator(commands: string[]) {
  if (!api?.getXML || !api.setXML || !isProbabilityBoard()) return
  const known = new Set(readNames())
  const selection = probabilitySelection(commands, (name) => {
    if (!known.has(name)) return null
    const value = api?.getValue?.(name)
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  })
  if (!selection) return
  try {
    const xml = api.getXML()
    if (!/<probabilityCalculator\b/.test(xml)) return
    let next = xml.replace(
      /<distribution\b[^>]*\/>/,
      `<distribution type="${selection.type}" isCumulative="${selection.cumulative}" isOverlayActive="false" parameters="${selection.parameters}"/>`,
    )
    if (selection.interval) {
      next = next.replace(
        /<interval\b[^>]*\/>/,
        `<interval mode="${selection.interval.mode}" low="${selection.interval.low}" high="${selection.interval.high}"/>`,
      )
    }
    if (next !== xml) {
      api.setXML(next)
      if (activePerspective) api.setPerspective?.(activePerspective)
      api.setRounding?.('5')
    }
  } catch {
    // A rejected calculator update leaves the commands and the previous distribution in place.
  }
}

function hideOnScreenKeyboard() {
  const panel = document.querySelector<HTMLElement>('.TabbedKeyBoard')
  if (!panel || getComputedStyle(panel).display === 'none') return
  panel.querySelector<HTMLButtonElement>('.closeTabbedKeyboardButton')?.click()
}

function readNames(): string[] {
  if (!api) return []
  const raw = api.getAllObjectNames?.()
  if (raw && typeof raw === 'object' && typeof raw.length === 'number') {
    return Array.from(raw).filter((name): name is string => typeof name === 'string' && name.length > 0)
  }
  const names: string[] = []
  const count = api.getObjectNumber()
  for (let index = 0; index < count; index += 1) {
    const name = api.getObjectName(index)
    if (name) names.push(name)
  }
  return names
}

function ascii(value: string) {
  return value
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/，/g, ',')
    .replace(/：/g, ':')
}

export function listObjects(): GgbObject[] {
  if (!api) return []
  return readNames().map((name) => {
    let type = 'object'
    let command = ''
    let value = ''
    try {
      type = api!.getObjectType(name) || type
      command = api!.getCommandString(name, false) || ''
      value = api!.getValueString(name) || ''
    } catch {
      // A few internal objects do not expose a definition.
    }
    return {
      name,
      type,
      definition: ascii(command || value),
    }
  })
}

function normalizeCommand(command: string) {
  return ascii(command)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function diagnose(
  command: string,
  known: Set<string>,
  mode?: CalculatorMode,
  options?: { angleUnit?: AngleUnit; enforceAngle?: boolean },
): string | null {
  const unquoted = command.replace(/"[^"]*"/g, '""')
  if (/[\u3400-\u9fff]/.test(unquoted)) {
    return '命令里含有中文。GeoGebra 这里只接受英文命令名，例如 Segment、Midpoint、Intersect。'
  }

  let depth = 0
  for (const character of command) {
    if (character === '(') depth += 1
    if (character === ')') depth -= 1
    if (depth < 0) return '括号不匹配。'
  }
  if (depth !== 0) return '括号不匹配。'

  const blocked = commandProblem(mode, command, {
    angleUnit: options?.angleUnit,
    known,
    enforceAngle: options?.enforceAngle,
  })
  if (blocked) return blocked

  const defined = command.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*(?:\([^)]*\))?\s*[:=]/)?.[1]
  const withoutCommands = unquoted.replace(/[A-Za-z][A-Za-z0-9_]*\s*(?=\()/g, '')
  const missing: string[] = []
  for (const match of withoutCommands.matchAll(/\b[A-Z]\d*\b/g)) {
    const label = match[0]
    if (label !== defined && !known.has(label) && !missing.includes(label)) missing.push(label)
  }
  if (missing.length > 0) {
    return `对象 ${missing.join('、')} 还不存在。请先创建这些点，或改用已经在画板上的标签。`
  }
  return null
}

function resultValue(name: string) {
  try {
    const raw = api?.getValueString(name) || ''
    const value = raw.replace(new RegExp(`^${name}\\s*=\\s*`), '').trim()
    return value || null
  } catch {
    return null
  }
}

function runOne(
  command: string,
  known: Set<string>,
  mode?: CalculatorMode,
  options?: { angleUnit?: AngleUnit; enforceAngle?: boolean },
): CommandResult {
  if (!api) {
    return { command, status: 'failed', labels: [], error: '画板还没有准备好。' }
  }
  const problem = diagnose(command, known, mode, options)
  if (problem) return { command, status: 'failed', labels: [], error: problem }

  const before = new Set(readNames())
  let accepted = false
  try {
    api.setErrorDialogsActive(false)
    accepted = api.evalCommand(command) === true
  } catch (error) {
    return {
      command,
      status: 'failed',
      labels: [],
      error: error instanceof Error ? error.message : '命令执行时出现异常。',
    }
  }
  if (!accepted) {
    return {
      command,
      status: 'failed',
      labels: [],
      error: '命令未被接受。请检查英文命令名、参数顺序，以及是否引用了不存在的对象。',
    }
  }

  const labels = readNames().filter((name) => !before.has(name))
  const assigned = command.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*(?:\([^)]*\))?\s*[:=]/)?.[1]
  if (assigned) known.add(assigned)
  for (const label of labels) known.add(label)
  return {
    command,
    status: 'ok',
    labels,
    error: null,
    value: (mode === 'scientific' || mode === 'probability') && assigned ? resultValue(assigned) : null,
  }
}

export function executeCommands(
  commands: string[],
  mode?: CalculatorMode,
  options?: { angleUnit?: AngleUnit; enforceAngle?: boolean },
): ConstructionReport {
  return runCommands(commands.flatMap(normalizeCommand).slice(0, 24), mode, options)
}

export function restoreCommands(
  commands: string[],
  mode?: CalculatorMode,
  options?: { angleUnit?: AngleUnit; enforceAngle?: boolean },
): ConstructionReport {
  return runCommands(commands.flatMap(normalizeCommand), mode, options)
}

function runCommands(
  commands: string[],
  mode?: CalculatorMode,
  options?: { angleUnit?: AngleUnit; enforceAngle?: boolean },
): ConstructionReport {
  const known = new Set(listObjects().map((object) => object.name))
  const results: CommandResult[] = []
  let failed = false

  for (const command of commands) {
    if (failed) {
      results.push({ command, status: 'skipped', labels: [], error: null })
      continue
    }
    const result = runOne(command, known, mode, options)
    results.push(result)
    if (result.status === 'failed') failed = true
  }

  if (mode === 'probability') {
    syncProbabilityCalculator(results.filter((item) => item.status === 'ok').map((item) => item.command))
  }
  hideOnScreenKeyboard()
  return {
    results,
    objects: listObjects(),
    hint: failed
      ? '有命令失败。请再次调用 applyCommands，只提交修正后的失败命令和尚未执行的命令，不要重复已成功的命令。'
      : mode === 'scientific'
        ? '全部算式已成功。不要再调用工具。请用中文说明计算过程，并写出结果。'
        : mode === 'probability'
          ? '全部命令已成功。不要再调用工具。请用中文说明分布和概率，并写出结果。'
          : '全部命令已成功。不要再调用工具。请用中文解释图形。',
  }
}

if (import.meta.env.DEV) {
  Object.assign(window, {
    __aiggb: {
      executeCommands,
      listObjects,
      getApi: () => api,
      appName: () => activeAppName,
    },
  })
}

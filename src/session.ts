import type { CalculatorMode, ChatTurn, ConstructionReport, ModeSession, SessionMap } from './types'
import type { CloudSession } from './api'

export const sessionStorageKey = 'aiggb.sessions'
export const modeStorageKey = 'aiggb.mode'

const modeIds: CalculatorMode[] = ['geometry', '3d', 'probability', 'scientific']

export function emptySession(): ModeSession {
  return { messages: [], input: '', report: null }
}

export function emptySessions(): SessionMap {
  return {
    geometry: emptySession(),
    '3d': emptySession(),
    probability: emptySession(),
    scientific: emptySession(),
  }
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return undefined
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

function isReport(value: unknown): value is ConstructionReport {
  if (!value || typeof value !== 'object') return false
  return Array.isArray((value as ConstructionReport).results)
}

export function normalizeSessions(value: unknown): SessionMap {
  const sessions = emptySessions()
  if (!value || typeof value !== 'object') return sessions
  const record = value as Partial<Record<CalculatorMode, Partial<ModeSession>>>
  for (const id of modeIds) {
    const item = record[id]
    if (!item) continue
    sessions[id] = {
      messages: Array.isArray(item.messages) ? (item.messages as ChatTurn[]) : [],
      input: typeof item.input === 'string' ? item.input : '',
      report: isReport(item.report) ? item.report : null,
      ...(id === 'scientific' && (item.angleUnit === 'degree' || item.angleUnit === 'radian') ? { angleUnit: item.angleUnit } : {}),
    }
  }
  return sessions
}

function pendingKey(owner: string, mode: CalculatorMode, id?: string | null) {
  return id ? `aiggb.cloud.${owner}.session.${id}` : `aiggb.cloud.${owner}.${mode}`
}

function readPendingSnapshot(key: string): CloudSession | null {
  const value = readJson(key)
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<CloudSession>
  const mode = record.mode
  if (!mode || !modeIds.includes(mode)) return null
  return {
    ...normalizeSessions({ [mode]: record })[mode],
    mode,
    id: typeof record.id === 'string' && record.id ? record.id : null,
    name: typeof record.name === 'string' ? record.name : '',
  }
}

export function readPendingCloud(owner: string, mode: CalculatorMode): CloudSession | null {
  const pending = readPendingSnapshot(pendingKey(owner, mode))
  return pending?.mode === mode ? pending : null
}

export function readDraft(owner: string, id: string): CloudSession | null {
  return readPendingSnapshot(`aiggb.cloud.${owner}.draft.${id}`)
}

export function writeDraft(owner: string, id: string, slot: CloudSession) {
  localStorage.setItem(`aiggb.cloud.${owner}.draft.${id}`, JSON.stringify(slot))
}

export function readPendingSession(owner: string, id: string): CloudSession | null {
  const pending = readPendingSnapshot(`aiggb.cloud.${owner}.session.${id}`)
  if (pending?.id === id) return pending
  // Older versions used one backup per mode. Recover it only for its own session.
  for (const mode of modeIds) {
    const legacy = readPendingCloud(owner, mode)
    if (legacy?.id === id) return legacy
  }
  return null
}

export function writePendingCloud(owner: string, mode: CalculatorMode, slot: CloudSession | null, id = slot?.id) {
  const key = pendingKey(owner, mode, id)
  if (slot) localStorage.setItem(key, JSON.stringify(slot))
  else localStorage.removeItem(key)
  if (id && readPendingCloud(owner, mode)?.id === id) {
    localStorage.removeItem(pendingKey(owner, mode))
  }
}

export function clearLocalAiggbCache() {
  const keys: string[] = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key && key.startsWith('aiggb.')) keys.push(key)
  }
  for (const key of keys) localStorage.removeItem(key)
}

export function migrateLegacyStorage() {
  if (localStorage.getItem(sessionStorageKey)) return
  const messages = readJson('aiggb.messages')
  const input = readJson('aiggb.input')
  const report = readJson('aiggb.report')
  const hasLegacy = messages !== undefined || input !== undefined || report !== undefined
  if (!hasLegacy) return
  const sessions = emptySessions()
  sessions.geometry = {
    messages: Array.isArray(messages) ? (messages as ChatTurn[]) : [],
    input: typeof input === 'string' ? input : '',
    report: isReport(report) ? report : null,
  }
  localStorage.setItem(sessionStorageKey, JSON.stringify(sessions))
  if (!localStorage.getItem(modeStorageKey)) {
    localStorage.setItem(modeStorageKey, JSON.stringify('geometry' satisfies CalculatorMode))
  }
  localStorage.removeItem('aiggb.messages')
  localStorage.removeItem('aiggb.input')
  localStorage.removeItem('aiggb.report')
}

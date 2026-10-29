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
    }
  }
  return sessions
}

// Unsent cloud changes stay separate from guest sessions and from other accounts.
function pendingKey(owner: string, mode: CalculatorMode) {
  return `aiggb.cloud.${owner}.${mode}`
}

export function readPendingCloud(owner: string, mode: CalculatorMode): CloudSession | null {
  const value = readJson(pendingKey(owner, mode))
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<CloudSession>
  if (record.mode !== mode) return null
  return {
    ...normalizeSessions({ [mode]: record })[mode],
    mode,
    id: typeof record.id === 'string' && record.id ? record.id : null,
    name: typeof record.name === 'string' ? record.name : '',
  }
}

export function writePendingCloud(owner: string, mode: CalculatorMode, slot: CloudSession | null) {
  if (slot) localStorage.setItem(pendingKey(owner, mode), JSON.stringify(slot))
  else localStorage.removeItem(pendingKey(owner, mode))
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

import { authUser, pb } from './pb'
import type { CalculatorMode, ChatTurn, ConstructionReport } from './types'

export type PublicModel = {
  id: string
  label: string
  gateway: boolean
}

export type GatewayModel = {
  id: string
  label: string
  endpoint: string
}

export type UsageSummary = {
  requests: number
  sessions: number
  tokens: number
  days: Array<{ date: string; requests: number }>
  models: Array<{ model: string; requests: number; tokens: number }>
  gatewayMonth: {
    requests: number
    tokens: number
    models: Array<{ model: string; requests: number; tokens: number }>
  }
}

export type CloudSession = {
  id: string | null
  name: string
  mode: CalculatorMode
  messages: ChatTurn[]
  input: string
  report: ConstructionReport | null
}

type ApiError = Error & { retryAfter?: number }

export function blankCloud(mode: CalculatorMode): CloudSession {
  return { id: null, name: '', mode, messages: [], input: '', report: null }
}

export function sessionTitle(text: string) {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (!trimmed) return '未命名会话'
  let name = ''
  let count = 0
  for (const char of trimmed) {
    if (count >= 24) break
    name += char
    count += 1
  }
  return name || '未命名会话'
}

export function safeRedirect(value: string | string[] | null | undefined) {
  const target = Array.isArray(value) ? value[0] : value
  if (!target || !target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) return '/'
  return target
}

export function readableError(error: unknown, fallback: string) {
  if (error && typeof error === 'object') {
    const record = error as { message?: string; data?: { message?: string; data?: Record<string, { message?: string }> } }
    const nested = record.data?.data
    if (nested && typeof nested === 'object') {
      for (const value of Object.values(nested)) {
        if (value && typeof value.message === 'string' && value.message) return mapMessage(value.message)
      }
    }
    const message = record.data?.message || record.message || ''
    if (message) return mapMessage(message)
  }
  return fallback
}

function mapMessage(message: string) {
  const text = message.replace(/\.+$/, '')
  if (/old password/i.test(text)) return '当前密码不正确'
  if (/failed to authenticate/i.test(text)) return '邮箱或密码不正确'
  if (text === 'Something went wrong') return '请求失败'
  return text
}

export async function postAuth(path: string, body: Record<string, unknown>, withAuth = false) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (withAuth && pb.authStore.token) headers.authorization = pb.authStore.token
  const response = await fetch(`${pb.baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const retryAfter = Number(data.retryAfter || data.data?.retryAfter || 0)
    const error = new Error(data.message || '请求失败') as ApiError
    if (retryAfter > 0) error.retryAfter = retryAfter
    throw error
  }
  return data as Record<string, unknown>
}

export function retryAfterOf(error: unknown) {
  if (error && typeof error === 'object' && 'retryAfter' in error) {
    const value = Number((error as ApiError).retryAfter || 0)
    return value > 0 ? value : 0
  }
  return 0
}

export async function fetchModels() {
  const response = await fetch('/api/models')
  if (!response.ok) return [] as PublicModel[]
  const data = await response.json()
  return Array.isArray(data) ? (data as PublicModel[]) : []
}

export async function fetchGateway() {
  const response = await fetch('/api/gateway')
  if (!response.ok) return [] as GatewayModel[]
  const data = await response.json()
  return Array.isArray(data.items) ? (data.items as GatewayModel[]) : []
}

export async function testModel(id: string) {
  const response = await fetch('/api/models/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  return response.json() as Promise<{ ok: boolean; latencyMs: number; error?: string }>
}

export async function fetchSummary(): Promise<UsageSummary> {
  const response = await fetch(`${pb.baseUrl}/api/usage/summary`, {
    headers: { authorization: pb.authStore.token },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || '用量读取失败')
  return data as UsageSummary
}

function isReport(value: unknown): value is ConstructionReport {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as ConstructionReport).results))
}

export function fromSessionRecord(record: Record<string, unknown>): CloudSession {
  const mode = record.mode
  const safeMode: CalculatorMode = mode === '3d' || mode === 'probability' || mode === 'scientific' || mode === 'geometry' ? mode : 'geometry'
  return {
    id: String(record.id || ''),
    name: typeof record.name === 'string' ? record.name : '未命名会话',
    mode: safeMode,
    messages: Array.isArray(record.messages) ? (record.messages as ChatTurn[]) : [],
    input: typeof record.input === 'string' ? record.input : '',
    report: isReport(record.report) ? record.report : null,
  }
}

export async function latestCloudSession(mode: CalculatorMode) {
  const list = await pb.collection('sessions').getList(1, 1, {
    filter: `mode = "${mode}"`,
    sort: '-updated',
  })
  const item = list.items[0]
  return item ? fromSessionRecord(item as unknown as Record<string, unknown>) : blankCloud(mode)
}

export async function loadCloudSession(id: string) {
  const item = await pb.collection('sessions').getOne(id)
  return fromSessionRecord(item as unknown as Record<string, unknown>)
}

export async function saveCloudSession(slot: CloudSession, messages: ChatTurn[], report: ConstructionReport | null) {
  const user = authUser()
  if (!user) throw new Error('请先登录')
  const name = slot.id ? slot.name || '未命名会话' : sessionTitle(messages.find((item) => item.role === 'user')?.content || '')
  const payload = { name, mode: slot.mode, messages, input: '', report }
  if (!slot.id) {
    const created = await pb.collection('sessions').create({ ...payload, owner: user.id })
    return { id: created.id, name: String(created.name || name) }
  }
  await pb.collection('sessions').update(slot.id, payload)
  return { id: slot.id, name }
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function sessionExport(record: Record<string, unknown>) {
  return {
    id: record.id,
    name: record.name,
    mode: record.mode,
    messages: record.messages ?? [],
    input: record.input ?? '',
    report: record.report ?? null,
    created: record.created,
    updated: record.updated,
  }
}

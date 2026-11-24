import PocketBase, { BaseAuthStore, getTokenPayload, type RecordModel } from 'pocketbase'
import { createSignal } from 'solid-js'

const legacyKey = 'pocketbase_auth'
const activeKey = 'pocketbase_auth.active'
const sessionKey = (id: string) => `pocketbase_auth.session.${id}`
const activityKey = (id: string) => `pocketbase_auth.activity.${id}`
const profileKey = (id: string) => `pocketbase_auth.profile.${id}`
const idleTimeout = 30 * 60_000
const maximumAge = 8 * 60 * 60_000
type Credentials = { token: string; record: RecordModel; signedInAt: number }
type EndReason = 'expired' | 'emailChanged' | null

const [authUser, setAuthUser] = createSignal<RecordModel | null>(null)
const [authSessionEnd, setAuthSessionEnd] = createSignal<EndReason>(null)
export { authUser, authSessionEnd }

class SessionAuthStore extends BaseAuthStore {
  private cache = new Map<string, { raw: string | null; value: unknown }>()
  private memoryOnly = false
  private id = ''
  private credentials: Credentials | null = null
  private timer: number | undefined

  private read<T>(key: string): T | null {
    const cached = this.cache.get(key)
    if (this.memoryOnly) return (cached?.value as T | undefined) ?? null
    try {
      const raw = localStorage.getItem(key)
      if (raw === cached?.raw) return cached.value as T | null
      if (!raw) {
        this.cache.delete(key)
        return null
      }
      const value = JSON.parse(raw) as T
      this.cache.set(key, { raw, value })
      return value
    } catch { return null }
  }

  private write(key: string, value: unknown) {
    const raw = value === null ? null : JSON.stringify(value)
    if (raw) this.cache.set(key, { raw, value })
    else this.cache.delete(key)
    if (this.memoryOnly) return
    try {
      if (raw) localStorage.setItem(key, raw)
      else localStorage.removeItem(key)
    } catch { this.memoryOnly = true }
  }

  private deadline(id: string, credentials: Credentials) {
    if (!credentials.record?.id || typeof credentials.token !== 'string' || !Number.isFinite(credentials.signedInAt)) return 0
    const activity = this.read<number>(activityKey(id))
    const lastActiveAt = typeof activity === 'number' ? Math.max(activity, credentials.signedInAt) : credentials.signedInAt
    const { exp } = getTokenPayload(credentials.token)
    return typeof exp === 'number' && Number.isFinite(lastActiveAt) && lastActiveAt <= Date.now()
      ? Math.min(credentials.signedInAt + maximumAge, lastActiveAt + idleTimeout, exp * 1000)
      : 0
  }

  private active() {
    return this.credentials && this.read<string>(activeKey) === this.id
      && this.read<Credentials>(sessionKey(this.id)) && this.deadline(this.id, this.credentials) > Date.now()
      ? this.credentials : null
  }

  override get token() { return this.active()?.token || '' }
  override get record() {
    const active = this.active()
    if (!active) return null
    const profile = this.read<RecordModel>(profileKey(this.id))
    return profile?.id === active.record.id ? profile : active.record
  }
  override get model() { return this.record }

  override save(token: string, record?: RecordModel | null) {
    const active = this.active()
    if (!active || token !== active.token || !record || record.id !== active.record.id) return
    this.write(profileKey(this.id), record)
    this.triggerChange()
  }

  start(token: string, record: RecordModel) {
    const id = window.crypto.getRandomValues(new Uint32Array(4)).join('-')
    const now = Date.now()
    const credentials = { token, record, signedInAt: now }
    if (this.deadline(id, credentials) <= now) throw new Error('无法建立登录会话，请重新登录')
    const previous = this.read<string>(activeKey)
    this.write(sessionKey(id), credentials)
    this.write(activeKey, id)
    if (previous) this.removeSession(previous)
    this.check()
  }

  override clear(reason: EndReason = null) {
    if (this.id) this.removeSession(this.id)
    this.check(reason)
  }

  private removeSession(id: string) {
    // Expiry only removes this session's data. Another tab may have just signed in.
    this.write(sessionKey(id), null)
    this.write(activityKey(id), null)
    this.write(profileKey(id), null)
  }

  check(reason?: EndReason) {
    window.clearTimeout(this.timer)
    const id = this.read<string>(activeKey) || ''
    let credentials = id ? this.read<Credentials>(sessionKey(id)) : null
    if (this.read(legacyKey)) {
      this.write(legacyKey, null)
      if (!credentials) reason ??= 'expired'
    }
    const remaining = credentials ? this.deadline(id, credentials) - Date.now() : 0
    if (credentials && remaining <= 0) {
      this.removeSession(id)
      credentials = null
      reason = 'expired'
    }
    if (this.id && this.id !== id) this.removeSession(this.id)
    this.id = id
    this.credentials = credentials
    if (credentials) {
      setAuthSessionEnd(null)
      this.timer = window.setTimeout(() => this.check(), remaining)
    } else if (reason !== undefined) setAuthSessionEnd(reason)
    this.triggerChange()
  }

  noteActivity(event: Event) {
    if (!event.isTrusted || document.hidden) return
    if (this.active()) this.write(activityKey(this.id), Date.now())
    this.check()
  }
}

const store = new SessionAuthStore()
export const pb = new PocketBase(window.location.origin, store)

store.onChange((_token, record) => setAuthUser(record))
window.addEventListener('storage', (event) => {
  if (event.key === null || event.key.startsWith('pocketbase_auth')) store.check()
})
window.addEventListener('focus', () => store.check())
window.addEventListener('pageshow', () => store.check())
document.addEventListener('visibilitychange', () => store.check())
for (const event of ['pointerdown', 'keydown', 'input', 'wheel']) {
  document.addEventListener(event, (activity) => store.noteActivity(activity), { capture: true, passive: true })
}

export function initPb(url: string) {
  pb.baseURL = url
  pb.autoCancellation(false)
  store.check()
}

export async function signInWithPassword(email: string, password: string, previousToken?: string) {
  const client = new PocketBase(pb.baseURL, new BaseAuthStore())
  const { token, record } = await client.collection('users').authWithPassword(email, password)
  if (previousToken && store.token !== previousToken) return
  store.start(token, record)
}

export const startAuthSession = (token: string, record: RecordModel) => store.start(token, record)
export const endSessionAfterEmailChange = () => store.clear('emailChanged')

export function loggedIn() {
  const owner = authUser()
  return Boolean(owner && owner.id === store.record?.id)
}

export function authToken() {
  return pb.authStore.token
}

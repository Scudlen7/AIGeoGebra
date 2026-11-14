/* @refresh reload */
import { Navigate, Route, Router, useLocation, useNavigate, useSearchParams } from '@solidjs/router'
import { Show, Suspense, createMemo, createSignal, lazy, type ParentProps } from 'solid-js'
import { render } from 'solid-js/web'
import 'katex/dist/katex.min.css'
import { Forgot } from './pages/Forgot'
import { Home } from './pages/Home'
import { Privacy, Terms } from './pages/Legal'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { Register } from './pages/Register'
import { Settings, SettingsIndex } from './pages/Settings'
import { DataSettings } from './pages/settings/Data'
import { ModelSettings } from './pages/settings/Models'
import { SecuritySettings } from './pages/settings/Security'
import { NotFound } from './pages/NotFound'
import { authUser, initPb, loggedIn } from './pb'
import { isCalculatorMode } from './modes'
import { workspacePath } from './api'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('缺少根节点')
const mount: HTMLElement = root
const App = lazy(() => import('./App').then(({ App }) => ({ default: App })))

const [configState, setConfigState] = createSignal<'loading' | 'ready' | 'error'>('loading')

function AccountService(props: ParentProps) {
  return (
    <Show when={configState() === 'ready'} fallback={
      <main id="main-content" class="page">
        <Show when={configState() === 'error'} fallback={<p role="status">正在连接账户服务…</p>}>
          <h1>账户服务暂不可用</h1>
          <p role="alert">无法读取账户服务配置。请稍后重试。</p>
          <button type="button" onClick={() => void loadConfig()}>重试</button>
        </Show>
      </main>
    }>
      {props.children}
    </Show>
  )
}

function RequireAccount(props: ParentProps) {
  const location = useLocation()
  return (
    <AccountService>
      <Show when={loggedIn() && authUser()?.id} keyed fallback={<Navigate href={() => `/login?redirect=${encodeURIComponent(location.pathname + location.search + location.hash)}`} />}>
        {(_owner) => props.children}
      </Show>
    </AccountService>
  )
}

function Workspace() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  let promotion: { draftId: string; sessionId: string } | undefined
  const workspaceKey = createMemo(() => {
    const sessionId = typeof params.session === 'string' ? params.session : ''
    const draftId = typeof params.draft === 'string' ? params.draft : ''
    if (sessionId && sessionId === promotion?.sessionId) return `draft:${promotion.draftId}`
    if (draftId !== promotion?.draftId) promotion = undefined
    return sessionId ? `session:${sessionId}` : draftId ? `draft:${draftId}` : ''
  })
  return (
    <RequireAccount>
      <Suspense fallback={<main class="page" role="status">正在打开作图工作区…</main>}>
        <Show when={workspaceKey()} keyed fallback={<App />}>
          {(_key) => {
            const sessionId = typeof params.session === 'string' ? params.session : undefined
            const draftId = typeof params.draft === 'string' ? params.draft : undefined
            const initialMode = isCalculatorMode(params.mode) ? params.mode : 'geometry'
            const initialName = typeof params.name === 'string' ? params.name : ''
            return <App sessionId={sessionId} draftId={draftId} initialMode={initialMode} initialName={initialName}
              onSessionSaved={(id) => {
                if (!draftId || params.draft !== draftId) return
                promotion = { draftId, sessionId: id }
                navigate(workspacePath(id), { replace: true })
              }}
              onModeChange={(mode) => navigate(`/dashboard?mode=${mode}`)} />
          }}
        </Show>
      </Suspense>
    </RequireAccount>
  )
}

function Trial() {
  return (
    <Show when={configState() !== 'loading'} fallback={<main class="page" role="status">正在打开游客工作区…</main>}>
      <Show when={!loggedIn()} fallback={<Navigate href="/dashboard" />}>
        <Suspense fallback={<main class="page" role="status">正在打开游客工作区…</main>}><App /></Suspense>
      </Show>
    </Show>
  )
}

async function loadConfig() {
  setConfigState('loading')
  try {
    const response = await fetch('/api/config', { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw new Error('配置请求失败')
    const data: unknown = await response.json()
    if (!data || typeof data !== 'object' || !('pbUrl' in data) || typeof data.pbUrl !== 'string') {
      throw new Error('配置格式错误')
    }
    const address = data.pbUrl.trim() || (import.meta.env.DEV ? 'http://127.0.0.1:8090' : '')
    const relative = address.startsWith('/') && !address.startsWith('//')
    if (!address || address.includes('\\') || (!relative && !/^https?:\/\//i.test(address))) throw new Error('无效的账户服务地址')
    const url = new URL(address, window.location.origin)
    if (import.meta.env.PROD && !relative && /^(?:localhost\.?|127\.|\[::1\])/i.test(url.hostname)) throw new Error('无效的账户服务地址')
    if (url.username || url.password || url.search || url.hash) throw new Error('无效的账户服务地址')
    initPb(url.href.replace(/\/$/, ''))
    setConfigState('ready')
  } catch {
    setConfigState('error')
  }
}

function boot() {
  try {
    if (localStorage.getItem('aiggb.theme') === 'dark') document.documentElement.dataset.theme = 'dark'
  } catch { /* The default theme works without storage. */ }
  render(
    () => (
      <Router>
        <Route path="/" component={Home} />
        <Route path="/try" component={Trial} />
        <Route path="/workspace" component={Workspace} />
        <Route path="/login" component={() => <AccountService><Login /></AccountService>} />
        <Route path="/register" component={() => <AccountService><Register /></AccountService>} />
        <Route path="/forgot" component={() => <AccountService><Forgot /></AccountService>} />
        <Route path="/terms" component={Terms} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/dashboard" component={() => <RequireAccount><Dashboard /></RequireAccount>} />
        <Route path="/settings" component={(props: ParentProps) => <RequireAccount><Settings>{props.children}</Settings></RequireAccount>}>
          <Route path="/" component={SettingsIndex} />
          <Route path="/models" component={ModelSettings} />
          <Route path="/security" component={SecuritySettings} />
          <Route path="/data" component={DataSettings} />
        </Route>
        <Route path="*404" component={NotFound} />
      </Router>
    ),
    mount,
  )
  void loadConfig()
}

boot()

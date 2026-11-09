/* @refresh reload */
import { Navigate, Route, Router, useLocation, useNavigate, useSearchParams } from '@solidjs/router'
import { Show, Suspense, lazy, type ParentProps } from 'solid-js'
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
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('缺少根节点')
const mount: HTMLElement = root
const App = lazy(() => import('./App').then(({ App }) => ({ default: App })))

function RequireAccount(props: ParentProps) {
  const location = useLocation()
  return (
    <Show when={loggedIn() && authUser()?.id} keyed fallback={<Navigate href={() => `/login?redirect=${encodeURIComponent(location.pathname + location.search + location.hash)}`} />}>
      {(_owner) => props.children}
    </Show>
  )
}

function Workspace() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  return (
    <RequireAccount>
      <Suspense fallback={<main class="page" role="status">正在打开作图工作区…</main>}>
        <Show when={typeof params.session === 'string' && params.session} keyed fallback={<App />}>
          {(id) => <App sessionId={id} onModeChange={(mode) => navigate(`/dashboard?mode=${mode}`)} />}
        </Show>
      </Suspense>
    </RequireAccount>
  )
}

function Trial() {
  return (
    <Show when={!loggedIn()} fallback={<Navigate href="/dashboard" />}>
      <Suspense fallback={<main class="page" role="status">正在打开游客工作区…</main>}><App /></Suspense>
    </Show>
  )
}

async function boot() {
  let pbUrl = import.meta.env.DEV ? 'http://127.0.0.1:8090' : ''
  try {
    const response = await fetch('/api/config')
    const data = await response.json()
    if (typeof data.pbUrl === 'string' && data.pbUrl.trim()) pbUrl = data.pbUrl.trim()
  } catch {
    // 配置接口不可用时，本地开发仍回退到本机 PocketBase。
  }
  initPb(pbUrl)
  try {
    if (localStorage.getItem('aiggb.theme') === 'dark') document.documentElement.dataset.theme = 'dark'
  } catch { /* The default theme works without storage. */ }
  render(
    () => (
      <Router>
        <Route path="/" component={Home} />
        <Route path="/try" component={Trial} />
        <Route path="/workspace" component={Workspace} />
        <Route path="/login" component={Login} />
        <Route path="/register" component={Register} />
        <Route path="/forgot" component={Forgot} />
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
}

void boot()

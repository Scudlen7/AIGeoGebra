/* @refresh reload */
import { Route, Router } from '@solidjs/router'
import { render } from 'solid-js/web'
import 'katex/dist/katex.min.css'
import { App } from './App'
import { Forgot } from './pages/Forgot'
import { Privacy, Terms } from './pages/Legal'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { Register } from './pages/Register'
import { Settings } from './pages/Settings'
import { initPb } from './pb'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('缺少根节点')
const mount: HTMLElement = root

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
  render(
    () => (
      <Router>
        <Route path="/" component={App} />
        <Route path="/login" component={Login} />
        <Route path="/register" component={Register} />
        <Route path="/forgot" component={Forgot} />
        <Route path="/terms" component={Terms} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/settings" component={Settings} />
      </Router>
    ),
    mount,
  )
}

void boot()

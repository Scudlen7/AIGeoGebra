import { A, useNavigate, useSearchParams } from '@solidjs/router'
import { createSignal } from 'solid-js'
import { AccountBar } from '../AccountBar'
import { readableError, safeRedirect } from '../api'
import { pb } from '../pb'

export function Login() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [email, setEmail] = createSignal('')
  const [password, setPassword] = createSignal('')
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal(false)

  async function submit(event: Event) {
    event.preventDefault()
    setError('')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email().trim())) {
      setError('请输入正确的邮箱地址')
      return
    }
    if (password().length < 8) {
      setError('密码至少 8 位')
      return
    }
    setBusy(true)
    try {
      await pb.collection('users').authWithPassword(email().trim().toLowerCase(), password())
      navigate(safeRedirect(params.redirect || null))
    } catch (reason) {
      setError(readableError(reason, '邮箱或密码不正确'))
      setBusy(false)
    }
  }

  return (
    <div class="subpage">
      <AccountBar />
      <main class="auth-card">
        <h1>登录</h1>
        <p class="lede">登录后，新的作图会话会保存到云端。未登录时的本地会话不会上传。</p>
        <form class="stack-form" onSubmit={(event) => void submit(event)}>
          <label>
            邮箱
            <input type="email" autocomplete="username" value={email()} onInput={(event) => setEmail(event.currentTarget.value)} />
          </label>
          <label>
            密码
            <input type="password" autocomplete="current-password" value={password()} onInput={(event) => setPassword(event.currentTarget.value)} />
          </label>
          <p class="form-links">
            <A href="/forgot">忘记密码</A>
            <A href="/register">注册</A>
          </p>
          <button class="btn" type="submit" disabled={busy()}>{busy() ? '登录中…' : '登录'}</button>
          {error() ? <p class="banner">{error()}</p> : null}
        </form>
      </main>
    </div>
  )
}

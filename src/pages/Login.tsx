import { A, useNavigate, useSearchParams } from '@solidjs/router'
import { createSignal } from 'solid-js'
import { AuthLayout } from '../AuthLayout'
import { readableError, safeRedirect } from '../api'
import { pb } from '../pb'

export function Login() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [email, setEmail] = createSignal('')
  const [password, setPassword] = createSignal('')
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const authLink = (path: string) => params.redirect ? `${path}?redirect=${encodeURIComponent(safeRedirect(params.redirect))}` : path

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
      navigate(safeRedirect(params.redirect), { replace: true })
    } catch (reason) {
      setError(readableError(reason, '邮箱或密码不正确'))
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="欢迎回来" description="登录后继续你的会话和画板。" alternate={{ href: authLink('/register'), label: '注册' }}>
      <form class="stack-form" onSubmit={(event) => void submit(event)}>
        <label>
          邮箱
          <input type="email" autocomplete="username" placeholder="you@example.com" value={email()} onInput={(event) => setEmail(event.currentTarget.value)} />
        </label>
        <label>
          密码
          <input type="password" autocomplete="current-password" value={password()} onInput={(event) => setPassword(event.currentTarget.value)} />
        </label>
        <p class="form-links"><A href={authLink('/forgot')}>忘记密码</A></p>
        <button class="btn" type="submit" disabled={busy()}>{busy() ? '登录中…' : '登录'}</button>
        {error() ? <p class="banner" role="alert">{error()}</p> : null}
      </form>
    </AuthLayout>
  )
}

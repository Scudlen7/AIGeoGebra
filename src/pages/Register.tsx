import { A, useNavigate, useSearchParams } from '@solidjs/router'
import { createSignal, onCleanup } from 'solid-js'
import { AccountBar } from '../AccountBar'
import { postAuth, readableError, retryAfterOf, safeRedirect } from '../api'
import { pb } from '../pb'

export function Register() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [name, setName] = createSignal('')
  const [email, setEmail] = createSignal('')
  const [code, setCode] = createSignal('')
  const [password, setPassword] = createSignal('')
  const [passwordConfirm, setPasswordConfirm] = createSignal('')
  const [agree, setAgree] = createSignal(false)
  const [error, setError] = createSignal('')
  const [wait, setWait] = createSignal(0)
  const [busy, setBusy] = createSignal(false)
  let timer: number | undefined
  onCleanup(() => window.clearInterval(timer))

  function startWait(seconds: number) {
    window.clearInterval(timer)
    setWait(seconds)
    timer = window.setInterval(() => {
      setWait((value) => {
        if (value <= 1) {
          window.clearInterval(timer)
          return 0
        }
        return value - 1
      })
    }, 1000)
  }

  async function sendCode() {
    setError('')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email().trim())) {
      setError('请输入正确的邮箱地址')
      return
    }
    try {
      await postAuth('/api/auth/request-code', { email: email().trim().toLowerCase(), purpose: 'register' })
      startWait(60)
    } catch (reason) {
      const retry = retryAfterOf(reason)
      if (retry) startWait(retry)
      setError(readableError(reason, '验证码发送失败'))
    }
  }

  async function submit(event: Event) {
    event.preventDefault()
    setError('')
    if ([...name().trim()].length < 2) {
      setError('昵称至少 2 个字符')
      return
    }
    if (password().length < 8) {
      setError('密码至少 8 位')
      return
    }
    if (password() !== passwordConfirm()) {
      setError('两次输入的密码不一致')
      return
    }
    if (!/^\d{4}$/.test(code().trim())) {
      setError('请输入 4 位验证码')
      return
    }
    if (!agree()) {
      setError('请先阅读并同意用户协议与隐私政策')
      return
    }
    setBusy(true)
    try {
      const data = await postAuth('/api/auth/register', {
        name: name().trim(),
        email: email().trim().toLowerCase(),
        code: code().trim(),
        password: password(),
        passwordConfirm: passwordConfirm(),
      })
      pb.authStore.save(String(data.token || ''), data.record as never)
      await pb.collection('users').authRefresh()
      navigate(safeRedirect(params.redirect || null))
    } catch (reason) {
      setError(readableError(reason, '注册失败'))
      setBusy(false)
    }
  }

  return (
    <div class="subpage">
      <AccountBar />
      <main class="auth-card">
        <h1>注册</h1>
        <p class="lede">验证码会发到邮箱，页面和接口都不会显示验证码。</p>
        <form class="stack-form" onSubmit={(event) => void submit(event)}>
          <label>
            昵称
            <input value={name()} minLength={2} onInput={(event) => setName(event.currentTarget.value)} />
          </label>
          <label>
            邮箱
            <input type="email" autocomplete="username" value={email()} onInput={(event) => setEmail(event.currentTarget.value)} />
          </label>
          <label>
            验证码
            <span class="code-row">
              <input inputMode="numeric" maxlength={4} value={code()} onInput={(event) => setCode(event.currentTarget.value)} />
              <button class="btn ghost" type="button" disabled={wait() > 0} onClick={() => void sendCode()}>
                {wait() > 0 ? `${wait()} 秒后重发` : '发送验证码'}
              </button>
            </span>
          </label>
          <label>
            密码
            <input type="password" autocomplete="new-password" value={password()} onInput={(event) => setPassword(event.currentTarget.value)} />
          </label>
          <label>
            确认密码
            <input type="password" autocomplete="new-password" value={passwordConfirm()} onInput={(event) => setPasswordConfirm(event.currentTarget.value)} />
          </label>
          <label class="check">
            <input type="checkbox" checked={agree()} onChange={(event) => setAgree(event.currentTarget.checked)} />
            <span>我已阅读并同意 <A href="/terms">用户协议</A> 与 <A href="/privacy">隐私政策</A></span>
          </label>
          <button class="btn" type="submit" disabled={busy()}>{busy() ? '注册中…' : '注册'}</button>
          {error() ? <p class="banner">{error()}</p> : null}
          <p class="form-links"><A href="/login">已有账号，去登录</A></p>
        </form>
      </main>
    </div>
  )
}

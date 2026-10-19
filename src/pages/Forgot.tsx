import { A } from '@solidjs/router'
import { createSignal, onCleanup, Show } from 'solid-js'
import { AccountBar } from '../AccountBar'
import { postAuth, readableError, retryAfterOf } from '../api'

export function Forgot() {
  const [step, setStep] = createSignal(1)
  const [email, setEmail] = createSignal('')
  const [code, setCode] = createSignal('')
  const [password, setPassword] = createSignal('')
  const [passwordConfirm, setPasswordConfirm] = createSignal('')
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

  async function send(event: Event) {
    event.preventDefault()
    setError('')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email().trim())) {
      setError('请输入正确的邮箱地址')
      return
    }
    setBusy(true)
    try {
      await postAuth('/api/auth/request-code', { email: email().trim().toLowerCase(), purpose: 'reset' })
      startWait(60)
      setStep(2)
    } catch (reason) {
      const retry = retryAfterOf(reason)
      if (retry) startWait(retry)
      setError(readableError(reason, '验证码发送失败'))
    } finally {
      setBusy(false)
    }
  }

  async function reset(event: Event) {
    event.preventDefault()
    setError('')
    if (!/^\d{4}$/.test(code().trim())) {
      setError('请输入 4 位验证码')
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
    setBusy(true)
    try {
      await postAuth('/api/auth/reset-password', {
        email: email().trim().toLowerCase(),
        code: code().trim(),
        password: password(),
        passwordConfirm: passwordConfirm(),
      })
      setStep(3)
    } catch (reason) {
      setError(readableError(reason, '重置失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="subpage">
      <AccountBar />
      <main class="auth-card">
        <h1>找回密码</h1>
        <ol class="steps">
          <li classList={{ on: step() === 1 }}>填写邮箱</li>
          <li classList={{ on: step() === 2 }}>验证并设置新密码</li>
          <li classList={{ on: step() === 3 }}>完成</li>
        </ol>
        <Show when={step() === 1}>
          <form class="stack-form" onSubmit={(event) => void send(event)}>
            <label>
              邮箱
              <input type="email" value={email()} onInput={(event) => setEmail(event.currentTarget.value)} />
            </label>
            <button class="btn" type="submit" disabled={busy() || wait() > 0}>
              {wait() > 0 ? `${wait()} 秒后重发` : busy() ? '发送中…' : '发送验证码'}
            </button>
          </form>
        </Show>
        <Show when={step() === 2}>
          <form class="stack-form" onSubmit={(event) => void reset(event)}>
            <p class="lede">验证码已发往 {email()}。如果这个邮箱没有注册，你不会收到邮件。</p>
            <label>
              验证码
              <input inputMode="numeric" maxlength={4} value={code()} onInput={(event) => setCode(event.currentTarget.value)} />
            </label>
            <label>
              新密码
              <input type="password" autocomplete="new-password" value={password()} onInput={(event) => setPassword(event.currentTarget.value)} />
            </label>
            <label>
              确认新密码
              <input type="password" autocomplete="new-password" value={passwordConfirm()} onInput={(event) => setPasswordConfirm(event.currentTarget.value)} />
            </label>
            <button class="btn" type="submit" disabled={busy()}>{busy() ? '提交中…' : '重置密码'}</button>
            <button class="btn ghost" type="button" disabled={wait() > 0} onClick={(event) => void send(event)}>
              {wait() > 0 ? `${wait()} 秒后重发` : '重新发送'}
            </button>
          </form>
        </Show>
        <Show when={step() === 3}>
          <p class="lede">密码已更新。请用新密码登录。</p>
          <A class="btn" href="/login">去登录</A>
        </Show>
        {error() ? <p class="banner">{error()}</p> : null}
      </main>
    </div>
  )
}

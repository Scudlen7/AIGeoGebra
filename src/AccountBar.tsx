import { A, useNavigate } from '@solidjs/router'
import { Show, createSignal } from 'solid-js'
import { authUser, loggedIn, pb } from './pb'

export function AccountBar() {
  const navigate = useNavigate()
  const [open, setOpen] = createSignal(false)

  function logout() {
    pb.authStore.clear()
    setOpen(false)
    navigate('/')
  }

  return (
    <header class="topbar">
      <A class="brand" href="/">AI 几何画板</A>
      <A class="top-link" href="/" end>工作区</A>
      <div class="topbar-gap" />
      <Show
        when={loggedIn()}
        fallback={
          <p class="auth-links">
            <A href="/login">登录</A>
            <span> / </span>
            <A href="/register">注册</A>
          </p>
        }
      >
        <div class="user-menu">
          <button type="button" aria-expanded={open()} aria-haspopup="menu" onClick={() => setOpen((value) => !value)}>
            {String(authUser()?.name || '用户')}
          </button>
          <Show when={open()}>
            <div class="menu" role="menu">
              <A href="/dashboard" onClick={() => setOpen(false)}>工作台</A>
              <A href="/settings" onClick={() => setOpen(false)}>设置</A>
              <button type="button" onClick={logout}>退出</button>
            </div>
          </Show>
        </div>
      </Show>
    </header>
  )
}

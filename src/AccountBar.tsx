import { A, useLocation, useNavigate } from '@solidjs/router'
import { Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import { authUser, loggedIn, pb } from './pb'
import { Icon } from './Icon'
import { SessionSidebar } from './SessionSidebar'
import type { CalculatorMode } from './types'

function sidebarStartsCollapsed() {
  try {
    const saved = localStorage.getItem('aiggb.sidebar-collapsed')
    if (saved === 'true' || saved === 'false') return saved === 'true'
  } catch { /* The sidebar works without storage. */ }
  return window.matchMedia('(min-width: 861px) and (max-width: 1200px)').matches
}

export function AccountBar(props: { workbenchMode?: CalculatorMode; sessionId?: string | null }) {
  const navigate = useNavigate()
  const location = useLocation()
  const mobileLayout = window.matchMedia('(max-width: 860px)')
  const [mobile, setMobile] = createSignal(mobileLayout.matches)
  const [drawerOpen, setDrawerOpen] = createSignal(false)
  const [collapsed, setCollapsed] = createSignal(sidebarStartsCollapsed())
  const [open, setOpen] = createSignal(false)
  const [dark, setDark] = createSignal(document.documentElement.dataset.theme === 'dark')
  const hasSessions = () => loggedIn() && Boolean(props.workbenchMode)
  let menu: HTMLDialogElement | undefined
  let trigger: HTMLButtonElement | undefined
  onMount(() => {
    try { setDark(localStorage.getItem('aiggb.theme') === 'dark') } catch { /* Storage may be disabled. */ }
    const changeLayout = () => {
      setMobile(mobileLayout.matches)
      if (!mobileLayout.matches) close()
    }
    mobileLayout.addEventListener('change', changeLayout)
    onCleanup(() => mobileLayout.removeEventListener('change', changeLayout))
  })
  createEffect(() => { document.documentElement.dataset.theme = dark() ? 'dark' : 'light' })
  createEffect(() => { location.pathname; location.search; close(); setOpen(false) })
  onCleanup(() => menu?.close())
  function toggleTheme() {
    setDark(!dark())
    try { localStorage.setItem('aiggb.theme', dark() ? 'dark' : 'light') } catch { /* Theme still works in memory. */ }
  }
  function toggleSidebar() {
    const next = !collapsed()
    setCollapsed(next)
    try { localStorage.setItem('aiggb.sidebar-collapsed', String(next)) } catch { /* Keep the current choice in memory. */ }
  }
  function openDrawer() {
    menu?.showModal()
    setDrawerOpen(Boolean(menu?.open))
  }
  function close() {
    if (!menu?.open) return
    menu.close()
    setDrawerOpen(false)
    trigger?.focus()
  }
  function logout() { pb.authStore.clear(); setOpen(false); close(); navigate('/') }
  const links = () => <>
    <Show when={loggedIn()} fallback={<A href="/try" class="nav-item" activeClass="active" aria-label="游客试用" title="游客试用" onClick={close}><Icon name="squares-four" /><span>游客试用</span></A>}>
      <A href={props.workbenchMode ? `/dashboard?mode=${props.workbenchMode}` : '/dashboard'} class="nav-item" activeClass="active" aria-label="工作台" title="工作台" onClick={close}><Icon name="chat-circle-text" /><span>工作台</span></A>
      <A href="/workspace" class="nav-item" activeClass="active" aria-label="作图工作区" title="作图工作区" onClick={close}><Icon name="squares-four" /><span>作图工作区</span></A>
      <A href="/settings" class="nav-item" activeClass="active" aria-label="偏好与账户" title="偏好与账户" onClick={close}><Icon name="gear-six" /><span>偏好与账户</span></A>
    </Show>
  </>
  const brand = () => <A class="brand" href="/" aria-label="AI 几何画板首页" onClick={close}><img src="/design/mark.svg" alt="" /><span>AI 几何画板<small>让数学看得见</small></span></A>
  return <>
    <a class="skip-link" href="#main-content">跳到主要内容</a>
    <aside id="desktop-sidebar" class="sidebar" classList={{ collapsed: collapsed() }}>
      {brand()}<nav aria-label="主导航">{links()}</nav>
      <Show when={!mobile() && hasSessions()} fallback={<div class="side-note"><strong>从一个问题开始</strong><p>把数学想法写下来，让图形帮你理解。</p></div>}>
        <SessionSidebar mode={props.workbenchMode!} sessionId={props.sessionId} enabled={!collapsed()} />
      </Show>
      <div class="sidebar-bottom"><p class="meta">几何 · 空间 · 概率 · 科学计算</p><div class="rule" /><A href={loggedIn() ? '/settings' : '/login'} class="profile"><span class="avatar">{String(authUser()?.name || '访').slice(0, 1)}</span><span>{String(authUser()?.name || '访客')}<small>{loggedIn() ? '管理你的账户' : '登录以保存云端会话'}</small></span></A><div class="legal-links"><A href="/privacy">隐私政策</A><A href="/terms">用户协议</A></div></div>
    </aside>
    <dialog id="mobile-sidebar" class="mobile-navigation" ref={menu} aria-label="导航菜单" onClose={() => setDrawerOpen(false)}>
      <div class="mobile-navigation-head">{brand()}<button class="btn ghost" type="button" onClick={close}>关闭菜单 <Icon name="x" /></button></div>
      <nav aria-label="主导航">{links()}</nav>
      <Show when={mobile() && hasSessions()}>
        <SessionSidebar mode={props.workbenchMode!} sessionId={props.sessionId} enabled={drawerOpen()} onNavigate={close} />
      </Show>
      <div class="legal-links"><A href="/privacy" onClick={close}>隐私政策</A><A href="/terms" onClick={close}>用户协议</A></div>
    </dialog>
    <header class="topbar">
      <button class="icon-btn sidebar-toggle" type="button" aria-controls="desktop-sidebar" aria-expanded={!collapsed()}
        aria-label={collapsed() ? '展开侧栏' : '折叠侧栏'} title={collapsed() ? '展开侧栏' : '折叠侧栏'} onClick={toggleSidebar}><Icon name="sidebar" /></button>
      <button ref={trigger} class="icon-btn mobile-menu" type="button" aria-controls="mobile-sidebar" aria-expanded={drawerOpen()} aria-label="打开导航" onClick={openDrawer}><Icon name="list" /></button>
      <span class="breadcrumb">数学探索 / {location.pathname === '/try' ? '游客试用' : location.pathname === '/workspace' ? '作图工作区' : location.pathname === '/dashboard' ? '工作台' : /^\/settings(?:\/|$)/.test(location.pathname) ? '设置' : '账户'}</span>
      <div class="topbar-gap" />
      <button class="icon-btn" aria-label={dark() ? '切换浅色' : '切换深色'} onClick={toggleTheme}><Icon name={dark() ? 'sun' : 'moon'} /></button>
      <Show when={loggedIn()} fallback={<div class="auth-links"><A href="/login">登录</A><A class="btn ghost" href="/register">创建账户 <Icon name="arrow-right" /></A></div>}>
        <div class="user-menu"><button class="btn ghost" aria-expanded={open()} onClick={() => setOpen(!open())}>{String(authUser()?.name || '用户')}<Icon name="caret-down" /></button><Show when={open()}><div class="menu"><A href="/settings" onClick={() => setOpen(false)}>账户设置</A><button onClick={logout}>退出登录</button></div></Show></div>
      </Show>
    </header>
  </>
}

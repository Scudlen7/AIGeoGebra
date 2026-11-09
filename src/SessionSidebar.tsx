import { useNavigate } from '@solidjs/router'
import { For, Show, createEffect, createResource, createSignal, onCleanup } from 'solid-js'
import { createCloudSession, readableError, workspacePath } from './api'
import { isCalculatorMode, modeDefinition, modeList } from './modes'
import { authUser, loggedIn, pb } from './pb'
import type { CalculatorMode } from './types'

type SessionEntry = { id: string; name: string; mode: CalculatorMode }

export function SessionSidebar(props: { mode: CalculatorMode; sessionId?: string | null; enabled: boolean; onNavigate?: () => void }) {
  const navigate = useNavigate()
  const [mode, setMode] = createSignal(props.mode)
  const [creating, setCreating] = createSignal(false)
  const [createError, setCreateError] = createSignal('')
  const [history, { refetch }] = createResource(
    () => props.enabled && loggedIn() && authUser()?.id,
    async () => {
      try {
        const entries = await pb.collection('sessions').getFullList<SessionEntry>({ fields: 'id,name,mode', sort: '-updated' })
        return { entries, error: '' }
      } catch (reason) {
        return { entries: [], error: readableError(reason, '历史会话读取失败') }
      }
    },
  )
  const sessions = () => history()?.entries.filter((item) => item.mode === mode()) ?? []
  let disposed = false
  createEffect(() => setMode(props.mode))
  onCleanup(() => { disposed = true })

  async function createSession() {
    const owner = authUser()?.id
    if (!owner || creating()) return
    setCreating(true)
    setCreateError('')
    try {
      const session = await createCloudSession(mode())
      if (disposed || authUser()?.id !== owner) return
      props.onNavigate?.()
      navigate(workspacePath(session.id))
    } catch (reason) {
      if (!disposed) setCreateError(readableError(reason, '新建会话失败'))
    } finally {
      if (!disposed) setCreating(false)
    }
  }

  return (
    <section class="sidebar-sessions" aria-label="侧栏会话">
      <button class="btn sidebar-create" type="button" disabled={creating()} onClick={() => void createSession()}>
        <span aria-hidden="true">+</span>{creating() ? '正在新建…' : `新建${modeDefinition(mode()).label}会话`}
      </button>
      <Show when={createError()}><p class="empty sidebar-error" role="alert">{createError()}</p></Show>
      <div class="sidebar-history-head">
        <h2>历史会话</h2>
        <select aria-label="会话模块" value={mode()} disabled={creating()} onChange={(event) => {
          const next = event.currentTarget.value
          if (isCalculatorMode(next)) setMode(next)
        }}>
          <For each={modeList}>{(item) => <option value={item.id}>{item.label}</option>}</For>
        </select>
      </div>
      <Show when={!history.loading} fallback={<p class="empty" role="status">正在读取会话…</p>}>
        <Show when={!history()?.error} fallback={<div class="sidebar-history-error"><p class="empty sidebar-error" role="alert">{history()?.error}</p><button class="btn ghost" type="button" onClick={() => void refetch()}>重试</button></div>}>
          <Show when={sessions().length > 0} fallback={<p class="empty">这个模块还没有历史会话。</p>}>
            <ul class="sidebar-history">
              <For each={sessions()}>{(item) => (
                <li>
                  <a href={workspacePath(item.id)} aria-current={item.id === props.sessionId ? 'page' : undefined}
                    title={item.name || '未命名会话'} onClick={() => props.onNavigate?.()}>
                    {item.name || '未命名会话'}
                  </a>
                </li>
              )}</For>
            </ul>
          </Show>
        </Show>
      </Show>
    </section>
  )
}

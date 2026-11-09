import { A, useNavigate, useSearchParams } from '@solidjs/router'
import { For, Show, createSignal, onCleanup, onMount } from 'solid-js'
import type { RecordModel } from 'pocketbase'
import { AccountBar } from '../AccountBar'
import { Icon } from '../Icon'
import { createCloudSession, downloadJson, fetchSummary, readableError, sessionExport, workspacePath, type UsageSummary } from '../api'
import { isCalculatorMode, modeDefinition, modeList } from '../modes'
import { authUser, pb } from '../pb'
import { readPendingSession, writePendingCloud } from '../session'
import type { CalculatorMode } from '../types'

type SessionRecord = RecordModel & { name: string; mode: CalculatorMode }

export function Dashboard() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [summary, setSummary] = createSignal<UsageSummary | null>(null)
  const [sessions, setSessions] = createSignal<SessionRecord[]>([])
  const [error, setError] = createSignal('')
  const [listError, setListError] = createSignal('')
  const [usageError, setUsageError] = createSignal('')
  const [name, setName] = createSignal('')
  const [editing, setEditing] = createSignal('')
  const [draftName, setDraftName] = createSignal('')
  const [query, setQuery] = createSignal('')
  const [loading, setLoading] = createSignal(true)
  const [creating, setCreating] = createSignal(false)
  let disposed = false

  const mode = () => isCalculatorMode(params.mode) ? params.mode : 'geometry'
  const current = () => modeDefinition(mode())
  const sessionsFor = (id: CalculatorMode) => sessions().filter((item) => item.mode === id)
  const visibleSessions = () => sessionsFor(mode()).filter((item) => (item.name || '未命名会话').toLowerCase().includes(query().trim().toLowerCase()))

  async function loadSessions() {
    setLoading(true)
    setListError('')
    try {
      const list = await pb.collection('sessions').getFullList<SessionRecord>({ sort: '-updated' })
      if (!disposed) setSessions(list)
    } catch (reason) {
      if (!disposed) setListError(readableError(reason, '会话读取失败'))
    } finally {
      if (!disposed) setLoading(false)
    }
  }

  onMount(() => {
    void loadSessions()
    fetchSummary().then((usage) => {
      if (!disposed) setSummary(usage)
    }).catch((reason) => {
      if (!disposed) setUsageError(readableError(reason, '用量读取失败'))
    })
  })
  onCleanup(() => { disposed = true })

  async function createSession(event: Event) {
    event.preventDefault()
    if (!authUser()?.id || creating()) return
    setError('')
    setCreating(true)
    try {
      const created = await createCloudSession(mode(), name().trim() || undefined)
      if (!disposed) navigate(workspacePath(created.id))
    } catch (reason) {
      if (!disposed) setError(readableError(reason, '新建会话失败'))
    } finally {
      if (!disposed) setCreating(false)
    }
  }

  async function rename(item: SessionRecord) {
    const title = draftName().trim()
    const owner = authUser()?.id
    if (!title || !owner) return
    await pb.collection('sessions').update(item.id, { name: title })
    const pending = readPendingSession(owner, item.id)
    if (pending) writePendingCloud(owner, pending.mode, { ...pending, name: title })
    setEditing('')
    setSessions((list) => list.map((record) => record.id === item.id ? { ...record, name: title } : record))
  }

  async function remove(item: SessionRecord) {
    const owner = authUser()?.id
    if (!owner || !window.confirm('删除这条云端会话？')) return
    await pb.collection('sessions').delete(item.id)
    writePendingCloud(owner, item.mode, null, item.id)
    setSessions((list) => list.filter((record) => record.id !== item.id))
  }

  const maxDay = () => Math.max(1, ...(summary()?.days.map((item) => item.requests) ?? [0]))

  return (
    <div class="subpage">
      <AccountBar workbenchMode={mode()} />
      <main id="main-content" class="page">
        <div class="page-head">
          <p class="eyebrow">个人空间</p>
          <h1>我的工作台</h1>
          <p>选择数学模块，新建一次探索，或打开历史会话继续作图。</p>
        </div>
        <nav class="module-grid module-picker" aria-label="会话模块">
          <For each={modeList}>{(item) => (
            <button
              type="button"
              class="module-card"
              classList={{ active: item.id === mode() }}
              aria-pressed={item.id === mode()}
              onClick={() => {
                setEditing('')
                setParams({ mode: item.id }, { replace: true })
              }}
            >
              <span class="module-symbol"><Icon name={item.icon} /></span>
              <strong>{item.label}</strong>
              <small>{sessionsFor(item.id).length} 条会话</small>
            </button>
          )}</For>
        </nav>
        {error() ? <p class="banner" role="alert">{error()}</p> : null}
        <section class="card">
          <h2>新建{current().label}会话</h2>
          <form class="inline-form" onSubmit={(event) => void createSession(event)}>
            <label>
              会话名称
              <input value={name()} maxlength={80} placeholder="未命名会话" onInput={(event) => setName(event.currentTarget.value)} />
            </label>
            <button class="btn" type="submit" disabled={creating()}>{creating() ? '正在创建…' : '新建会话'} <Icon name="arrow-right" /></button>
          </form>
        </section>
        <section aria-labelledby="session-history">
          <div class="session-tools">
            <h2 id="session-history">{current().label}历史会话</h2>
            <input class="session-search" type="search" aria-label="搜索会话" placeholder="搜索会话名称" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} />
          </div>
          <Show when={!loading()} fallback={<div class="card" role="status"><p>正在读取你的会话…</p><div class="skeleton" /><div class="skeleton short" /></div>}>
            <Show when={!listError()} fallback={<div class="empty-panel"><p role="alert">{listError()}</p><button class="btn ghost" onClick={() => void loadSessions()}>重新读取</button></div>}>
              <Show when={visibleSessions().length > 0} fallback={<div class="empty-panel"><h3>{query().trim() ? '没有找到相关会话' : '还没有会话'}</h3><p class="empty">{query().trim() ? '换一个关键词试试。' : '在上方新建会话，开始一次数学探索。'}</p></div>}>
                <ul class="session-list">
                  <For each={visibleSessions()}>
                    {(item) => (
                      <li>
                        <div class="session-art"><Icon name={current().icon} /><small>计算模式示意</small></div>
                        <div class="session-body">
                          <Show when={editing() === item.id} fallback={<strong>{item.name || '未命名会话'}</strong>}>
                            <input aria-label="新会话名称" value={draftName()} maxlength={80} onInput={(event) => setDraftName(event.currentTarget.value)} />
                          </Show>
                          <div class="row-actions">
                            <A class="btn ghost" href={workspacePath(item.id)}>打开</A>
                            <Show
                              when={editing() === item.id}
                              fallback={<button class="btn ghost" type="button" onClick={() => { setEditing(item.id); setDraftName(item.name || '') }}>重命名</button>}
                            >
                              <button class="btn ghost" type="button" onClick={() => void rename(item).catch((reason) => setError(readableError(reason, '重命名失败')))}>保存</button>
                            </Show>
                            <button class="btn ghost" type="button" onClick={() => downloadJson(`session-${item.name || item.id}.json`, sessionExport(item))}>导出</button>
                            <button class="btn ghost" type="button" onClick={() => void remove(item).catch((reason) => setError(readableError(reason, '删除失败')))}>删除</button>
                          </div>
                        </div>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </Show>
          </Show>
        </section>
        <details class="usage-details">
          <summary>查看用量统计</summary>
          <Show when={summary()} fallback={<p class="empty">{usageError() || '正在读取用量…'}</p>}>
            {(usage) => <>
              <section class="stat-grid">
                <article><span>累计请求数</span><strong>{usage().requests}</strong></article>
                <article><span>会话数</span><strong>{sessions().length}</strong></article>
                <article><span>Token 总量</span><strong>{usage().tokens}</strong></article>
              </section>
              <section class="dash-grid">
                <div class="card">
                  <h2>近 7 天每日请求</h2>
                  <div class="bars">
                    <For each={usage().days}>
                      {(day) => (
                        <div class="bar">
                          <div style={{ height: `${Math.max(4, (day.requests / maxDay()) * 120)}px` }} title={`${day.date} ${day.requests} 次`} />
                          <span>{day.requests}</span>
                          <small>{day.date.slice(5)}</small>
                        </div>
                      )}
                    </For>
                  </div>
                  <Show when={usage().days.length === 0}><p class="empty">还没有请求记录</p></Show>
                </div>
                <div class="card">
                  <h2>按模型的请求数</h2>
                  <Show when={usage().models.length > 0} fallback={<p class="empty">还没有请求记录</p>}>
                    <ul class="plain">
                      <For each={usage().models}>{(item) => <li><span>{item.model}</span><b>{item.requests}</b></li>}</For>
                    </ul>
                  </Show>
                </div>
              </section>
            </>}
          </Show>
        </details>
      </main>
    </div>
  )
}

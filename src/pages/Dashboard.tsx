import { useNavigate } from '@solidjs/router'
import { For, Show, createSignal, onMount } from 'solid-js'
import { AccountBar } from '../AccountBar'
import { Icon } from '../Icon'
import { downloadJson, fetchSummary, readableError, sessionExport, type UsageSummary } from '../api'
import { modeList } from '../modes'
import { loggedIn, pb } from '../pb'
import type { CalculatorMode } from '../types'

const modeLabel: Record<CalculatorMode, string> = {
  geometry: '几何',
  '3d': '3D',
  probability: '概率',
  scientific: '科学',
}

export function Dashboard() {
  const navigate = useNavigate()
  const [summary, setSummary] = createSignal<UsageSummary | null>(null)
  const [sessions, setSessions] = createSignal<Array<Record<string, unknown>>>([])
  const [error, setError] = createSignal('')
  const [name, setName] = createSignal('')
  const [mode, setMode] = createSignal<CalculatorMode>('geometry')
  const [editing, setEditing] = createSignal('')
  const [draftName, setDraftName] = createSignal('')
  const [query, setQuery] = createSignal('')
  const [loading, setLoading] = createSignal(true)
  const visibleSessions = () => sessions().filter((item) => String(item.name || '未命名会话').toLowerCase().includes(query().trim().toLowerCase()))
  const modeIcon: Record<string, string> = { geometry: 'triangle', '3d': 'cube', probability: 'chart-bell', scientific: 'function' }

  async function load() {
    const [usage, list] = await Promise.all([
      fetchSummary(),
      pb.collection('sessions').getFullList({ sort: '-updated' }),
    ])
    setSummary(usage)
    setSessions(list as unknown as Array<Record<string, unknown>>)
  }

  onMount(() => {
    if (!loggedIn()) {
      navigate('/login?redirect=' + encodeURIComponent('/dashboard'), { replace: true })
      return
    }
    load().catch((reason) => setError(readableError(reason, '工作台加载失败'))).finally(() => setLoading(false))
  })

  async function createSession(event: Event) {
    event.preventDefault()
    const title = name().trim()
    if (!title) {
      setError('请填写会话名称')
      return
    }
    const user = pb.authStore.record
    if (!user) return
    try {
      const created = await pb.collection('sessions').create({
        owner: user.id,
        name: title,
        mode: mode(),
        messages: [],
        input: '',
        report: null,
      })
      navigate(`/?session=${created.id}`)
    } catch (reason) {
      setError(readableError(reason, '新建会话失败'))
    }
  }

  async function rename(id: string) {
    const title = draftName().trim()
    if (!title) return
    await pb.collection('sessions').update(id, { name: title })
    setEditing('')
    await load()
  }

  async function remove(id: string) {
    if (!window.confirm('删除这条云端会话？')) return
    await pb.collection('sessions').delete(id)
    await load()
  }

  const maxDay = () => Math.max(1, ...(summary()?.days.map((item) => item.requests) ?? [0]))

  return (
    <div class="subpage">
      <AccountBar />
      <main id="main-content" class="page">
        <div class="page-head">
          <h1>每一次探索，都有迹可循</h1>
          <p>回到之前的问题，继续你的数学思考。用量来自你的真实云端记录。</p>
        </div>
        {error() ? <p class="banner">{error()}</p> : null}
        <section class="stat-grid">
          <article>
            <span>累计请求数</span>
            <strong>{summary()?.requests ?? 0}</strong>
          </article>
          <article>
            <span>会话数</span>
            <strong>{summary()?.sessions ?? 0}</strong>
          </article>
          <article>
            <span>Token 总量</span>
            <strong>{summary()?.tokens ?? 0}</strong>
          </article>
        </section>
        <details class="usage-details"><summary>查看用量趋势</summary><section class="dash-grid">
          <div class="card">
            <h2>近 7 天每日请求</h2>
            <div class="bars">
              <For each={summary()?.days ?? []}>
                {(day) => (
                  <div class="bar">
                    <div style={{ height: `${Math.max(4, (day.requests / maxDay()) * 120)}px` }} title={`${day.date} ${day.requests} 次`} />
                    <span>{day.requests}</span>
                    <small>{day.date.slice(5)}</small>
                  </div>
                )}
              </For>
            </div>
            <Show when={(summary()?.days.length ?? 0) === 0}>
              <p class="empty">还没有请求记录</p>
            </Show>
          </div>
          <div class="card">
            <h2>按模型的请求数</h2>
            <Show when={(summary()?.models.length ?? 0) > 0} fallback={<p class="empty">还没有请求记录</p>}>
              <ul class="plain">
                <For each={summary()?.models ?? []}>
                  {(item) => (
                    <li>
                      <span>{item.model}</span>
                      <b>{item.requests}</b>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        </section></details>
        <section class="card">
          <h2>新建会话</h2>
          <form class="inline-form" onSubmit={(event) => void createSession(event)}>
            <label>
              名称
              <input value={name()} onInput={(event) => setName(event.currentTarget.value)} />
            </label>
            <label>
              模式
              <select value={mode()} onChange={(event) => setMode(event.currentTarget.value as CalculatorMode)}>
                <For each={modeList}>{(item) => <option value={item.id}>{item.label}</option>}</For>
              </select>
            </label>
            <button class="btn" type="submit">进入空白工作区</button>
          </form>
        </section>
        <section>
          <div class="session-tools"><h2>最近的探索</h2><input class="session-search" type="search" aria-label="搜索会话" placeholder="搜索会话名称" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} /></div>
          <Show when={!loading()} fallback={<div class="card" role="status"><p>正在读取你的会话…</p><div class="skeleton" /><div class="skeleton short" /></div>}>
          <Show when={visibleSessions().length > 0} fallback={<div class="empty-panel"><h3>{query().trim() ? '没有找到相关会话' : '从第一个问题开始'}</h3><p class="empty">{query().trim() ? '换一个关键词试试。' : '还没有云端会话。在上方新建，或完成一次作图后自动保存。'}</p></div>}>
            <ul class="session-list">
              <For each={visibleSessions()}>
                {(item) => (
                  <li>
                    <div class="session-art"><Icon name={modeIcon[String(item.mode)] || 'function'} /><small>计算模式示意</small></div>
                    <div class="session-body">
                    <div>
                      <Show when={editing() === item.id} fallback={<strong>{String(item.name || '未命名会话')}</strong>}>
                        <input value={draftName()} onInput={(event) => setDraftName(event.currentTarget.value)} />
                      </Show>
                      <p class="meta">{modeLabel[item.mode as CalculatorMode] || String(item.mode || '')}</p>
                    </div>
                    <div class="row-actions">
                      <button class="btn ghost" type="button" onClick={() => navigate(`/?session=${item.id}`)}>打开</button>
                      <Show
                        when={editing() === item.id}
                        fallback={
                          <button class="btn ghost" type="button" onClick={() => { setEditing(String(item.id)); setDraftName(String(item.name || '')) }}>
                            重命名
                          </button>
                        }
                      >
                          <button class="btn ghost" type="button" onClick={() => void rename(String(item.id)).catch((reason) => setError(readableError(reason, '重命名失败')))}>保存</button>
                      </Show>
                      <button class="btn ghost" type="button" onClick={() => downloadJson(`session-${item.name || item.id}.json`, sessionExport(item))}>导出</button>
                      <button class="btn ghost" type="button" onClick={() => void remove(String(item.id)).catch((reason) => setError(readableError(reason, '删除失败')))}>删除</button>
                    </div>
                    </div>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          </Show>
        </section>
      </main>
    </div>
  )
}

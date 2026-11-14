import { A, useNavigate, useSearchParams } from '@solidjs/router'
import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import type { RecordModel } from 'pocketbase'
import { AccountBar } from '../AccountBar'
import { Icon } from '../Icon'
import { draftWorkspacePath, downloadJson, fetchSummary, readableError, sessionExport, workspacePath, type UsageSummary } from '../api'
import { isCalculatorMode, modeDefinition, modeList } from '../modes'
import { authUser, pb } from '../pb'
import { readPendingSession, writePendingCloud } from '../session'
import type { CalculatorMode } from '../types'

type SessionRecord = RecordModel & { name: string; mode: CalculatorMode }

const pageSize = 5
const countFormat = new Intl.NumberFormat('zh-CN')
const timeFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23' })
const reminderDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' })

function sessionTime(record: SessionRecord) {
  const value = record.updated || record.created
  if (!value) return undefined
  const date = new Date(value.replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? undefined : date
}

function UsageTrend(props: { usage: UsageSummary }) {
  const step = () => Math.max(1, Math.ceil(Math.max(...props.usage.days.map((day) => day.requests)) / 4))

  return (
    <>
      <Show when={props.usage.days.some((day) => day.requests > 0)} fallback={<p class="dashboard-empty dashboard-trend-state">近 7 天暂无请求记录。</p>}>
        <div class="dashboard-chart">
          <div class="dashboard-chart-axis" aria-hidden="true">
            <For each={[4, 3, 2, 1, 0]}>{(tick) => <span>{countFormat.format(tick * step())}</span>}</For>
          </div>
          <ol class="dashboard-chart-bars" role="list" aria-label="每日请求量">
            <For each={props.usage.days}>{(day) => {
              const label = `${day.date}，${countFormat.format(day.requests)} 次请求`
              return (
                <li aria-label={label} title={label}>
                  <div class="dashboard-chart-track" aria-hidden="true">
                    <span style={{ height: `${day.requests / (4 * step()) * 100}%` }} />
                  </div>
                  <time dateTime={day.date} aria-hidden="true">{day.date.slice(5)}</time>
                </li>
              )
            }}</For>
          </ol>
        </div>
      </Show>
      <details class="dashboard-model-usage">
        <summary>按模型查看请求数</summary>
        <Show when={props.usage.models.length > 0} fallback={<p class="empty">还没有请求记录。</p>}>
          <ul role="list">
            <For each={props.usage.models}>{(item) => <li><span>{item.model}</span><strong>{countFormat.format(item.requests)}</strong></li>}</For>
          </ul>
        </Show>
      </details>
    </>
  )
}

export function Dashboard() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [summary, setSummary] = createSignal<UsageSummary | null>(null)
  const [usageError, setUsageError] = createSignal('')
  const [sessions, setSessions] = createSignal<SessionRecord[]>([])
  const [loading, setLoading] = createSignal(true)
  const [listError, setListError] = createSignal('')
  const [query, setQuery] = createSignal('')
  const [page, setPage] = createSignal(0)
  const [expanded, setExpanded] = createSignal('')
  const [editing, setEditing] = createSignal(false)
  const [draftName, setDraftName] = createSignal('')
  const [updating, setUpdating] = createSignal(false)
  const [actionError, setActionError] = createSignal('')
  const [createMode, setCreateMode] = createSignal<CalculatorMode>('geometry')
  const [name, setName] = createSignal('')
  const [creating, setCreating] = createSignal(false)
  const [createError, setCreateError] = createSignal('')
  let createDialog!: HTMLDialogElement
  let reminderDialog!: HTMLDialogElement
  let muteReminder!: HTMLInputElement
  const reminderKey = `aiggb.usage-reminder.${authUser()?.id}`
  let disposed = false

  const mode = () => isCalculatorMode(params.mode) ? params.mode : 'geometry'
  const history = createMemo(() => {
    const needle = query().trim().toLowerCase()
    return sessions().filter((item) => item.mode === mode() && (item.name || '未命名会话').toLowerCase().includes(needle))
  })
  const pageCount = () => Math.max(1, Math.ceil(history().length / pageSize))
  const currentPage = () => Math.min(page(), pageCount() - 1)
  const visibleSessions = () => history().slice(currentPage() * pageSize, (currentPage() + 1) * pageSize)
  const metrics = [
    { label: '累计请求数', icon: 'chat-circle-text', description: '全部数学模块', value: () => summary()?.requests },
    { label: '云端会话', icon: 'squares-four', description: '已保存的历史会话', value: () => loading() || listError() ? summary()?.sessions : sessions().length },
    { label: 'Token 总量', icon: 'function', description: '已记录的模型用量', value: () => summary()?.tokens },
    { label: '近 7 天活跃天数', icon: 'chart-bell', description: '产生过模型请求的天数', value: () => summary()?.days.filter((day) => day.requests > 0).length },
  ]

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

  async function loadUsage() {
    setUsageError('')
    try {
      const usage = await fetchSummary()
      if (!disposed) setSummary(usage)
    } catch (reason) {
      if (!disposed) setUsageError(readableError(reason, '用量读取失败'))
    }
  }

  onMount(() => {
    void loadSessions()
    void loadUsage()
    try {
      if (localStorage.getItem(reminderKey) === reminderDate.format()) return
    } catch { /* The reminder still works without storage. */ }
    reminderDialog.showModal()
  })
  onCleanup(() => { disposed = true })

  function rememberUsageReminder() {
    if (!muteReminder.checked) return
    try {
      localStorage.setItem(reminderKey, reminderDate.format())
    } catch { /* Closing the dialog still works without storage. */ }
  }

  function showCreateDialog() {
    setCreateMode(mode())
    setName('')
    setCreateError('')
    createDialog.showModal()
  }

  async function createSession(event: Event) {
    event.preventDefault()
    const owner = authUser()?.id
    if (!owner || creating()) return
    setCreateError('')
    setCreating(true)
    try {
      const path = draftWorkspacePath(createMode(), name())
      if (disposed || authUser()?.id !== owner) return
      createDialog.close()
      navigate(path)
    } catch (reason) {
      if (!disposed) setCreateError(readableError(reason, '新建会话失败'))
    } finally {
      if (!disposed) setCreating(false)
    }
  }

  function showPage(index: number) {
    setPage(index)
    setExpanded('')
    setEditing(false)
    setActionError('')
  }

  async function rename(event: Event, item: SessionRecord) {
    event.preventDefault()
    const title = draftName().trim()
    const owner = authUser()?.id
    if (!title || !owner || updating()) return
    setUpdating(true)
    setActionError('')
    try {
      const updated = await pb.collection('sessions').update<SessionRecord>(item.id, { name: title })
      const pending = readPendingSession(owner, item.id)
      if (pending) writePendingCloud(owner, pending.mode, { ...pending, name: title })
      if (disposed) return
      setSessions((list) => [updated, ...list.filter((record) => record.id !== item.id)])
      showPage(0)
    } catch (reason) {
      if (!disposed) setActionError(readableError(reason, '重命名失败'))
    } finally {
      if (!disposed) setUpdating(false)
    }
  }

  async function remove(item: SessionRecord) {
    const owner = authUser()?.id
    if (!owner || updating() || !window.confirm('删除这条云端会话？')) return
    setUpdating(true)
    setActionError('')
    try {
      await pb.collection('sessions').delete(item.id)
      writePendingCloud(owner, item.mode, null, item.id)
      if (disposed) return
      setSessions((list) => list.filter((record) => record.id !== item.id))
      showPage(currentPage())
    } catch (reason) {
      if (!disposed) setActionError(readableError(reason, '删除失败'))
    } finally {
      if (!disposed) setUpdating(false)
    }
  }

  return (
    <div class="subpage">
      <AccountBar workbenchMode={mode()} />
      <main id="main-content" class="page dashboard-page">
        <header class="dashboard-head">
          <div>
            <h1>我的工作台</h1>
            <p>查看使用概况，继续你的数学探索。</p>
          </div>
          <button class="btn" type="button" aria-haspopup="dialog" onClick={showCreateDialog}><span aria-hidden="true">＋</span>新建会话</button>
        </header>

        <section class="dashboard-metrics" aria-label="用量概况">
          <For each={metrics}>{(metric) => (
            <article class="dashboard-panel dashboard-metric">
              <header><h2>{metric.label}</h2><Icon name={metric.icon} /></header>
              <strong>{metric.value()?.toLocaleString('zh-CN') ?? '—'}</strong>
              <p>{metric.description}</p>
            </article>
          )}</For>
        </section>

        <div class="dashboard-panels">
          <section class="dashboard-panel dashboard-history" aria-labelledby="session-history">
            <div class="dashboard-panel-heading">
              <h2 id="session-history">历史会话</h2>
              <Show when={!loading() && !listError()}><span>{countFormat.format(history().length)} 条</span></Show>
            </div>
            <div class="dashboard-history-tools">
              <nav class="dashboard-filters" aria-label="会话模块">
                <For each={modeList}>{(item) => (
                  <button type="button" aria-pressed={item.id === mode()} onClick={() => {
                    setParams({ mode: item.id }, { replace: true })
                    showPage(0)
                  }}>{item.label}</button>
                )}</For>
              </nav>
              <input type="search" aria-label="搜索会话" placeholder="搜索会话名称" value={query()} onInput={(event) => {
                setQuery(event.currentTarget.value)
                showPage(0)
              }} />
            </div>
            <Show when={actionError()}><p class="banner" role="alert">{actionError()}</p></Show>
            <Show when={!loading()} fallback={<p class="dashboard-empty" role="status">正在读取你的会话…</p>}>
              <Show when={!listError()} fallback={<div class="dashboard-empty"><p role="alert">{listError()}</p><button class="btn ghost" type="button" onClick={() => void loadSessions()}>重新读取</button></div>}>
                <Show when={visibleSessions().length > 0} fallback={<div class="dashboard-empty"><h3>{query().trim() ? '没有找到相关会话' : '这个模块还没有会话'}</h3><p>{query().trim() ? `当前只搜索${modeDefinition(mode()).label}会话。` : '新建会话，开始一次数学探索。'}</p></div>}>
                  <ul class="session-list" role="list">
                    <For each={visibleSessions()}>{(item) => {
                      const name = () => item.name || '未命名会话'
                      const definition = modeDefinition(item.mode)
                      return (
                        <li>
                          <div class="dashboard-session">
                            <span class="dashboard-session-icon"><Icon name={definition.icon} /></span>
                            <div class="dashboard-session-info">
                              <strong title={name()}>{name()}</strong>
                              <p>{definition.label}<Show when={sessionTime(item)}>{(date) => <> · <time dateTime={date().toISOString()}>{timeFormat.format(date())}</time></>}</Show></p>
                            </div>
                            <A class="dashboard-open-session" href={workspacePath(item.id)} aria-label={`打开 ${name()}`}>打开</A>
                            <button class="dashboard-session-menu" type="button" aria-label={`更多操作 ${name()}`} aria-expanded={expanded() === item.id}
                              disabled={updating()} onClick={() => {
                                setExpanded(expanded() === item.id ? '' : item.id)
                                setEditing(false)
                                setActionError('')
                              }}>…</button>
                          </div>
                          <Show when={expanded() === item.id}>
                            <Show when={editing()} fallback={<div class="dashboard-session-actions">
                              <button class="btn ghost" type="button" onClick={() => { setDraftName(item.name || ''); setEditing(true) }}>重命名</button>
                              <button class="btn ghost" type="button" onClick={() => downloadJson(`session-${item.name || item.id}.json`, sessionExport(item))}>导出</button>
                              <button class="btn ghost dashboard-delete" type="button" disabled={updating()} onClick={() => void remove(item)}>删除</button>
                            </div>}>
                              <form class="dashboard-session-actions" onSubmit={(event) => void rename(event, item)}>
                                <input aria-label="新会话名称" value={draftName()} maxlength={80} disabled={updating()} onInput={(event) => setDraftName(event.currentTarget.value)} />
                                <button class="btn" type="submit" disabled={updating() || !draftName().trim()}>保存</button>
                                <button class="btn ghost" type="button" disabled={updating()} onClick={() => { setEditing(false); setActionError('') }}>取消</button>
                              </form>
                            </Show>
                          </Show>
                        </li>
                      )
                    }}</For>
                  </ul>
                  <Show when={pageCount() > 1}>
                    <nav class="dashboard-pagination" aria-label="历史会话分页">
                      <span>第 {currentPage() + 1} / {pageCount()} 页</span>
                      <button class="btn ghost" type="button" disabled={currentPage() === 0} onClick={() => showPage(currentPage() - 1)}>上一页</button>
                      <button class="btn ghost" type="button" disabled={currentPage() + 1 >= pageCount()} onClick={() => showPage(currentPage() + 1)}>下一页</button>
                    </nav>
                  </Show>
                </Show>
              </Show>
            </Show>
          </section>

          <section class="dashboard-panel dashboard-usage" aria-labelledby="dashboard-usage">
            <h2 id="dashboard-usage">近 7 天请求</h2>
            <p class="dashboard-caption">按北京时间统计模型请求次数</p>
            <Show when={summary()} fallback={
              <div class="dashboard-empty dashboard-trend-state">
                <Show when={usageError()} fallback={<p role="status">正在读取用量…</p>}>
                  <p role="alert">{usageError()}</p>
                  <button class="btn ghost" type="button" onClick={() => void loadUsage()}>重试用量</button>
                </Show>
              </div>
            }>
              {(usage) => <UsageTrend usage={usage()} />}
            </Show>
          </section>
        </div>

        <dialog class="dashboard-dialog" ref={reminderDialog} aria-labelledby="usage-reminder-title"
          aria-describedby="usage-reminder-description" onCancel={rememberUsageReminder}>
          <h2 id="usage-reminder-title">试用额度提醒</h2>
          <p id="usage-reminder-description" class="dialog-copy">平台模型每天提供有限的试用额度。经常作图或连续解题时，建议提前在「模型偏好」添加自己的模型供应商，填写 API 地址和 API Key，再选为默认模型。个人模型的额度和费用由供应商决定。</p>
          <label class="check"><input ref={muteReminder} type="checkbox" />今日不再提醒</label>
          <div class="dashboard-dialog-actions">
            <button class="btn ghost" type="button" autofocus onClick={() => {
              rememberUsageReminder()
              reminderDialog.close()
            }}>关闭</button>
            <A class="btn" href="/settings/models" onClick={rememberUsageReminder}>前往模型偏好</A>
          </div>
        </dialog>
        <dialog class="dashboard-dialog" ref={createDialog} aria-labelledby="create-session-title" onCancel={(event) => {
          if (creating()) event.preventDefault()
        }}>
          <h2 id="create-session-title">新建会话</h2>
          <p class="dashboard-caption">选择数学模块，打开一块新的画板。</p>
          <form class="stack-form" onSubmit={(event) => void createSession(event)}>
            <label>数学模块
              <select value={createMode()} disabled={creating()} onChange={(event) => {
                const next = event.currentTarget.value
                if (isCalculatorMode(next)) setCreateMode(next)
              }}>
                <For each={modeList}>{(item) => <option value={item.id}>{item.label}</option>}</For>
              </select>
            </label>
            <label>会话名称（可选）
              <input value={name()} maxlength={80} placeholder="留空则根据首条消息自动命名" disabled={creating()} onInput={(event) => setName(event.currentTarget.value)} />
            </label>
            <Show when={createError()}><p class="banner" role="alert">{createError()}</p></Show>
            <div class="dashboard-dialog-actions">
              <button class="btn ghost" type="button" disabled={creating()} onClick={() => createDialog.close()}>取消</button>
              <button class="btn" type="submit" disabled={creating()}>{creating() ? '正在创建…' : '创建会话'}</button>
            </div>
          </form>
        </dialog>
      </main>
    </div>
  )
}

import { createAutofocus } from '@solid-primitives/autofocus'
import { writeClipboard } from '@solid-primitives/clipboard'
import { createShortcut } from '@solid-primitives/keyboard'
import { createResizeObserver } from '@solid-primitives/resize-observer'
import { throttle } from '@solid-primitives/scheduled'
import { makePersisted } from '@solid-primitives/storage'
import { For, Show, createSignal, onCleanup, onMount, type Signal } from 'solid-js'
import { TransitionGroup } from 'solid-transition-group'
import { AccountBar } from './AccountBar'
import { blankCloud, fetchModels, loadCloudSession, readableError, saveCloudSession, latestCloudSession, type CloudSession, type PublicModel } from './api'
import { executeCommands, mountBoard, resetBoard, resizeBoard, setCoordinateSystem, unmountBoard } from './board'
import { fetchLlmStatus, hasFailure, runTurn } from './chat'
import { renderMarkdown } from './markdown'
import { isCalculatorMode, modeDefinition, modeList } from './modes'
import { authUser, loggedIn, pb } from './pb'
import { emptySession, emptySessions, migrateLegacyStorage, modeStorageKey, normalizeSessions, sessionStorageKey } from './session'
import type { AngleUnit, CalculatorMode, ChatTurn, ConstructionReport, LlmStatus, ModeSession, SessionMap } from './types'

const statusLabel = {
  ok: '已执行',
  failed: '失败',
  skipped: '未执行',
} as const

function emptyCloudMap(): Record<CalculatorMode, CloudSession> {
  return {
    geometry: blankCloud('geometry'),
    '3d': blankCloud('3d'),
    probability: blankCloud('probability'),
    scientific: blankCloud('scientific'),
  }
}

export function App() {
  migrateLegacyStorage()
  const [llm, setLlm] = createSignal<LlmStatus>({ configured: false, model: '' })
  const [models, setModels] = createSignal<PublicModel[]>([])
  const [boardReady, setBoardReady] = createSignal(false)
  const [boardError, setBoardError] = createSignal('')
  const [mode, setMode] = makePersisted<CalculatorMode, Signal<CalculatorMode>>(createSignal<CalculatorMode>('geometry'), {
    name: modeStorageKey,
  })
  const [sessions, setSessions] = makePersisted<SessionMap, Signal<SessionMap>>(createSignal(emptySessions()), {
    name: sessionStorageKey,
    deserialize: (data) => normalizeSessions(JSON.parse(data)),
  })
  const [cloudSlots, setCloudSlots] = createSignal(emptyCloudMap())
  const [draft, setDraft] = createSignal('')
  const [running, setRunning] = createSignal(false)
  const [error, setError] = createSignal('')
  const [syncNote, setSyncNote] = createSignal({ ok: false, text: '' })
  const [report, setReport] = createSignal<ConstructionReport | null>(null)
  const [attempts, setAttempts] = createSignal(0)
  const [copied, setCopied] = createSignal('')
  const [frame, setFrame] = createSignal<HTMLDivElement>()
  const [showAxes, setShowAxes] = makePersisted<boolean, Signal<boolean>>(createSignal(false), { name: 'aiggb.axes' })
  const [showCommands, setShowCommands] = makePersisted<boolean, Signal<boolean>>(createSignal(true), { name: 'aiggb.commands' })
  const [angleUnit, setAngleUnit] = makePersisted<AngleUnit, Signal<AngleUnit>>(createSignal<AngleUnit>('degree'), {
    name: 'aiggb.angle',
  })
  let host: HTMLDivElement | undefined
  let inputEl: HTMLTextAreaElement | undefined
  let controller: AbortController | undefined
  let copyTimer: number | undefined
  let loadGeneration = 0
  let cloudGeneration = 0
  let authSeen = ''

  const activeMode = (): CalculatorMode => (isCalculatorMode(mode()) ? mode() : 'geometry')
  const current = () => modeDefinition(activeMode())
  const unit = (): AngleUnit => (angleUnit() === 'radian' ? 'radian' : 'degree')
  const activeSession = () => {
    if (loggedIn()) return cloudSlots()[activeMode()] ?? blankCloud(activeMode())
    return { ...(sessions()[activeMode()] ?? emptySession()), id: null, name: '', mode: activeMode() }
  }
  const messagesFor = (id: CalculatorMode) => (loggedIn() ? cloudSlots()[id]?.messages ?? [] : (sessions()[id] ?? emptySession()).messages)
  const shownName = () => cloudSlots()[activeMode()]?.name || '未命名会话'

  function requestModel() {
    const list = models()
    const fallback = list[0]?.id || llm().model
    if (!loggedIn()) return fallback
    const chosen = String(authUser()?.model || '')
    return list.some((item) => item.id === chosen) ? chosen : fallback
  }

  const renderDraft = throttle((text: string) => setDraft(text), 80)
  const resizeThrottled = throttle((width: number, height: number) => resizeBoard(width, height), 120)

  createResizeObserver(frame, ({ width, height }) => resizeThrottled(width, height))
  createAutofocus(() => (boardReady() ? inputEl : undefined))
  createShortcut(['Escape'], () => controller?.abort(), { preventDefault: false })
  createShortcut(['Control', 'Enter'], () => void submit())

  function patchSession(id: CalculatorMode, patch: Partial<ModeSession>) {
    setSessions((currentSessions) => {
      const base = normalizeSessions(currentSessions)
      return {
        ...base,
        [id]: { ...base[id], ...patch },
      }
    })
  }

  function patchWorkspace(id: CalculatorMode, patch: Partial<ModeSession>) {
    if (loggedIn()) {
      setCloudSlots((currentSlots) => ({
        ...currentSlots,
        [id]: { ...(currentSlots[id] ?? blankCloud(id)), ...patch },
      }))
      return
    }
    patchSession(id, patch)
  }

  function reportFor(target: CalculatorMode) {
    if (loggedIn()) return cloudSlots()[target]?.report ?? null
    return (sessions()[target] ?? emptySession()).report
  }

  async function loadCloudMode(target: CalculatorMode) {
    const generation = ++cloudGeneration
    const previous = cloudSlots()[target]
    const slot = await latestCloudSession(target)
    if (generation !== cloudGeneration) return
    if (previous?.id && previous.id === slot.id && previous.input) slot.input = previous.input
    setCloudSlots((currentSlots) => ({ ...currentSlots, [target]: slot }))
  }

  async function loadBoard(target: CalculatorMode) {
    const generation = ++loadGeneration
    const definition = modeDefinition(target)
    setBoardReady(false)
    setBoardError('')
    setReport(null)
    if (!definition.ready || !definition.applet) {
      unmountBoard()
      return
    }
    if (!host) return
    try {
      await mountBoard(host, {
        ...definition.applet,
        coordinateSystem: target === 'geometry' ? showAxes() : undefined,
      })
      if (generation !== loadGeneration) return
      setBoardReady(true)
      const board = frame()
      if (board) resizeBoard(board.clientWidth, board.clientHeight)
      const saved = reportFor(target)
      if (saved) {
        const commands = saved.results.filter((item) => item.status === 'ok').map((item) => item.command)
        if (commands.length > 0 && generation === loadGeneration) {
          setReport(executeCommands(commands, target, { angleUnit: unit(), enforceAngle: false }))
        }
      }
      if (target === 'geometry' && generation === loadGeneration) setCoordinateSystem(showAxes())
    } catch (reason) {
      if (generation !== loadGeneration) return
      setBoardError(reason instanceof Error ? reason.message : '画板加载失败')
    }
  }

  async function switchMode(next: CalculatorMode) {
    if (next === activeMode() || running()) return
    controller?.abort()
    renderDraft.clear()
    setDraft('')
    setError('')
    setSyncNote({ ok: false, text: '' })
    setAttempts(0)
    setRunning(false)
    setMode(next)
    const url = new URL(window.location.href)
    if (url.searchParams.has('session')) {
      url.searchParams.delete('session')
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
    }
    if (loggedIn()) {
      try {
        await loadCloudMode(next)
      } catch (reason) {
        setError(readableError(reason, '云端会话读取失败'))
      }
    }
    await loadBoard(next)
  }

  async function chooseModel(modelId: string) {
    const user = authUser()
    if (!user) return
    try {
      const updated = await pb.collection('users').update(user.id, { model: modelId })
      pb.authStore.save(pb.authStore.token, updated)
    } catch (reason) {
      setError(readableError(reason, '模型切换失败'))
    }
  }

  onMount(() => {
    authSeen = pb.authStore.isValid ? pb.authStore.record?.id || '' : ''
    const stop = pb.authStore.onChange(() => {
      const next = pb.authStore.isValid ? pb.authStore.record?.id || '' : ''
      if (next === authSeen) return
      authSeen = next
      setSyncNote({ ok: false, text: '' })
      void (async () => {
        if (loggedIn()) {
          try {
            await loadCloudMode(activeMode())
          } catch (reason) {
            setError(readableError(reason, '云端会话读取失败'))
          }
        }
        await loadBoard(activeMode())
      })()
    })
    onCleanup(stop)

    void (async () => {
      try {
        const [status, list] = await Promise.all([fetchLlmStatus(), fetchModels()])
        setLlm(status)
        setModels(list)
      } catch {
        setLlm({ configured: false, model: '' })
      }
      if (!isCalculatorMode(mode())) setMode('geometry')
      const sessionId = new URLSearchParams(window.location.search).get('session')
      if (loggedIn()) {
        try {
          if (sessionId) {
            const slot = await loadCloudSession(sessionId)
            setMode(slot.mode)
            setCloudSlots((currentSlots) => ({ ...currentSlots, [slot.mode]: slot }))
          } else {
            await loadCloudMode(activeMode())
          }
        } catch (reason) {
          setError(readableError(reason, '云端会话读取失败'))
        }
      }
      await loadBoard(activeMode())
    })()
  })

  onCleanup(() => {
    controller?.abort()
    unmountBoard()
  })

  async function clearConstruction() {
    const id = activeMode()
    controller?.abort()
    renderDraft.clear()
    if (modeDefinition(id).ready) {
      resetBoard()
      if (id === 'geometry') setCoordinateSystem(showAxes())
    }
    if (loggedIn()) {
      const slot = cloudSlots()[id]
      patchWorkspace(id, emptySession())
      if (slot?.id) {
        try {
          await pb.collection('sessions').update(slot.id, { messages: [], input: '', report: null })
          setSyncNote({ ok: true, text: '已同步到云端' })
        } catch (reason) {
          setSyncNote({ ok: false, text: readableError(reason, '云端同步失败，当前页面已清空') })
        }
      }
    } else {
      patchSession(id, emptySession())
    }
    setDraft('')
    setReport(null)
    setAttempts(0)
    setError('')
    setRunning(false)
  }

  async function copyCommand(command: string) {
    await writeClipboard(command)
    setCopied(command)
    window.clearTimeout(copyTimer)
    copyTimer = window.setTimeout(() => setCopied(''), 1200)
  }

  async function submit(text = activeSession().input.trim()) {
    const id = activeMode()
    if (!text || running() || !boardReady() || !llm().configured || !modeDefinition(id).ready) return
    controller?.abort()
    controller = new AbortController()
    const history: ChatTurn[] = [...activeSession().messages, { role: 'user', content: text }]
    patchWorkspace(id, { messages: history, input: '' })
    setDraft('')
    setReport(null)
    setAttempts(0)
    setError('')
    setSyncNote({ ok: false, text: '' })
    setRunning(true)

    try {
      const answer = await runTurn({
        mode: id,
        angleUnit: unit(),
        model: requestModel(),
        messages: history,
        signal: controller.signal,
        onText: renderDraft,
        onReport: (next) => {
          setReport(next)
          patchWorkspace(id, { report: next })
          setAttempts((count) => count + 1)
        },
      })
      renderDraft.clear()
      const finalMessages: ChatTurn[] = [
        ...history,
        { role: 'assistant', content: answer || (id === 'scientific' || id === 'probability' ? '计算已完成。' : '作图已执行。') },
      ]
      patchWorkspace(id, { messages: finalMessages, input: '' })
      setDraft('')
      if (loggedIn()) {
        try {
          const slot = { ...(cloudSlots()[id] ?? blankCloud(id)), mode: id }
          const saved = await saveCloudSession(slot, finalMessages, report())
          setCloudSlots((currentSlots) => ({
            ...currentSlots,
            [id]: { ...currentSlots[id], id: saved.id, name: saved.name, messages: finalMessages, input: '' },
          }))
          setSyncNote({ ok: true, text: '已同步到云端' })
        } catch (reason) {
          setSyncNote({ ok: false, text: readableError(reason, '云端同步失败，作图结果仍保留在当前页面') })
        }
      }
    } catch (reason) {
      renderDraft.clear()
      if (controller.signal.aborted) return
      setError(reason instanceof Error ? reason.message : '模型请求失败')
      if (draft()) {
        patchWorkspace(id, { messages: [...history, { role: 'assistant', content: draft() }] })
        setDraft('')
      }
    } finally {
      if (!controller.signal.aborted) setRunning(false)
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      void submit()
    }
  }

  return (
    <div class="shell" data-mode={activeMode()}>
      <AccountBar />
      <header class="workspace-head">
        <div>
          <p class="eyebrow">{current().eyebrow}</p>
          <h1>{current().title}</h1>
          <Show when={loggedIn()}>
            <p class="session-name">当前会话 {shownName()}</p>
          </Show>
          <Show when={syncNote().text}>
            <p class="sync-note" classList={{ ok: syncNote().ok, bad: !syncNote().ok }}>{syncNote().text}</p>
          </Show>
        </div>
        <p class="lede">{current().lede}</p>
        <div class="model-slot">
          <Show when={llm().configured} fallback={<p class="meta">模型未配置</p>}>
            <Show when={loggedIn() && models().length > 0} fallback={<p class="meta">当前模型 {models().find((item) => item.id === requestModel())?.label || llm().model}</p>}>
              <label class="model-switch">
                当前模型
                <select value={requestModel()} disabled={running()} onChange={(event) => void chooseModel(event.currentTarget.value)}>
                  <For each={models()}>{(item) => <option value={item.id}>{item.label}</option>}</For>
                </select>
              </label>
            </Show>
          </Show>
        </div>
        <nav class="modes" aria-label="计算器模式">
          <For each={modeList}>
            {(item) => (
              <button
                type="button"
                classList={{ active: activeMode() === item.id }}
                aria-pressed={activeMode() === item.id}
                disabled={running()}
                title={item.ready ? item.label : '后续步骤接入'}
                onClick={() => void switchMode(item.id)}
              >
                {item.label}
              </button>
            )}
          </For>
        </nav>
      </header>

      <main class="workspace">
        <section class="conversation">
          <div class="examples">
            <For each={current().examples}>
              {(example) => (
                <button
                  type="button"
                  disabled={running() || !boardReady() || !llm().configured}
                  onClick={() => void submit(example)}
                >
                  {example}
                </button>
              )}
            </For>
          </div>

          <div class="transcript">
            <Show when={activeMode()} keyed>
              {(id) => (
                <>
                  <Show when={messagesFor(id).length === 0 && !draft()}>
                    <p class="empty">{modeDefinition(id).empty}</p>
                  </Show>
                  <TransitionGroup name="msg">
                    <For each={messagesFor(id)}>
                      {(message) => (
                        <article class={message.role}>
                          <Show when={message.role === 'assistant'} fallback={<p>{message.content}</p>}>
                            <div class="md" innerHTML={renderMarkdown(message.content)} />
                          </Show>
                        </article>
                      )}
                    </For>
                  </TransitionGroup>
                </>
              )}
            </Show>
            <Show when={draft()}>
              <article class="assistant">
                <div class="md" innerHTML={renderMarkdown(draft())} />
              </article>
            </Show>
            <Show when={error()}>
              <p class="banner">{error()}</p>
            </Show>
            <Show when={!llm().configured}>
              <p class="banner">
                复制 .env.example 为 .env，填入 LLM_BASE_URL、LLM_API_KEY 和 LLM_MODEL，然后重新运行 npm run dev。
              </p>
            </Show>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            <textarea
              ref={inputEl}
              rows={3}
              value={activeSession().input}
              placeholder={current().placeholder}
              disabled={running() || (current().ready && !boardReady())}
              onInput={(event) => patchWorkspace(activeMode(), { input: event.currentTarget.value })}
              onKeyDown={onKeyDown}
            />
            <div class="actions">
              <button type="button" class="ghost" onClick={() => void clearConstruction()} disabled={current().ready && !boardReady()}>
                清空
              </button>
              <button
                type="submit"
                disabled={running() || !boardReady() || !llm().configured || !current().ready || !activeSession().input.trim()}
              >
                {running() ? `${current().submitLabel}中…` : current().submitLabel}
              </button>
            </div>
          </form>
        </section>

        <section class="stage">
          <div class="stage-tools">
            <Show when={activeMode() === 'geometry'}>
              <button
                type="button"
                classList={{ active: showAxes() }}
                aria-pressed={showAxes()}
                disabled={!boardReady()}
                onClick={() => {
                  const next = !showAxes()
                  setShowAxes(next)
                  setCoordinateSystem(next)
                }}
              >
                {showAxes() ? '隐藏坐标系' : '显示坐标系'}
              </button>
            </Show>
            <Show when={activeMode() === 'scientific'}>
              <button
                type="button"
                classList={{ active: unit() === 'radian' }}
                aria-pressed={unit() === 'radian'}
                onClick={() => setAngleUnit(unit() === 'radian' ? 'degree' : 'radian')}
              >
                {unit() === 'radian' ? '弧度' : '角度'}
              </button>
            </Show>
            <button type="button" classList={{ active: showCommands() }} aria-pressed={showCommands()} onClick={() => setShowCommands((value) => !value)}>
              {showCommands() ? `隐藏${current().logLabel}` : `显示${current().logLabel}`}
            </button>
          </div>
          <div class="board-frame" ref={setFrame}>
            <div class="board-host" ref={host} />
            <Show when={current().ready && !boardReady()}>
              <p class="board-state">{boardError() || '正在加载画板…'}</p>
            </Show>
            <Show when={!current().ready}>
              <p class="board-state">这一模式的计算器将在后续步骤接入。几何画板里的作图会保留。</p>
            </Show>
          </div>

          <Show when={showCommands()}>
          <div class="log">
            <div class="log-head">
              <h2>{current().logLabel}</h2>
              <Show when={attempts() > 1 && !hasFailure(report())}>
                <span>已自动修改并重新执行</span>
              </Show>
              <Show when={report()}>
                {(currentReport) => <span>{currentReport().objects.length} 个对象</span>}
              </Show>
            </div>
            <Show when={report()} fallback={<p class="empty">{current().logLabel}执行后会显示在这里。</p>}>
              {(currentReport) => (
                <ol>
                  <For each={currentReport().results}>
                    {(item) => (
                      <li class={item.status}>
                        <div>
                          <code>{item.command}</code>
                          <span class="row-end">
                            <span>{statusLabel[item.status]}</span>
                            <button
                              type="button"
                              class="copy"
                              classList={{ copied: copied() === item.command }}
                              onClick={() => void copyCommand(item.command)}
                            >
                              {copied() === item.command ? '已复制' : '复制'}
                            </button>
                          </span>
                        </div>
                        <Show when={item.value}>
                          <p class="value">{item.value}</p>
                        </Show>
                        <Show when={item.error}>
                          <p>{item.error}</p>
                        </Show>
                      </li>
                    )}
                  </For>
                </ol>
              )}
            </Show>
          </div>
          </Show>
        </section>
      </main>
    </div>
  )
}

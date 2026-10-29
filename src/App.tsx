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
import { captureBoard, getApi, listObjects, mountBoard, onBoardChange, resetBoard, resizeBoard, restoreBoard, restoreCommands, setCoordinateSystem, unmountBoard } from './board'
import { fetchLlmStatus, hasFailure, runTurn } from './chat'
import { renderMarkdown } from './markdown'
import { isCalculatorMode, modeDefinition, modeList } from './modes'
import { authUser, loggedIn, pb } from './pb'
import { emptySession, emptySessions, migrateLegacyStorage, modeStorageKey, normalizeSessions, readPendingCloud, sessionStorageKey, writePendingCloud } from './session'
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
  const [pendingModes, setPendingModes] = createSignal<Partial<Record<CalculatorMode, boolean>>>({})
  const [syncing, setSyncing] = createSignal(false)
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
  let turnGeneration = 0
  let loadedOwner = ''
  let loadedMode: CalculatorMode | null = null
  let stopBoardChanges: (() => void) | undefined
  let snapshotTimer: number | undefined
  let syncTimer: number | undefined
  const cloudLoaded = new Set<CalculatorMode>()
  const revisions = new Map<CalculatorMode, number>()
  const saving = new Set<CalculatorMode>()
  const ownerId = () => loggedIn() ? authUser()!.id : ''

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
  createShortcut(['Escape'], () => {
    controller?.abort()
    renderDraft.clear()
    setDraft('')
    setRunning(false)
  }, { preventDefault: false })
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
      revisions.set(id, (revisions.get(id) ?? 0) + 1)
      setPendingModes((current) => ({ ...current, [id]: true }))
      persistPending(id)
      return
    }
    patchSession(id, patch)
  }

  function reportFor(target: CalculatorMode) {
    if (loggedIn()) return cloudSlots()[target]?.report ?? null
    return (sessions()[target] ?? emptySession()).report
  }

  function persistPending(target: CalculatorMode) {
    const owner = ownerId()
    if (!owner) return
    try {
      writePendingCloud(owner, target, pendingModes()[target] ? cloudSlots()[target] : null)
    } catch {
      setSyncNote({ ok: false, text: '本机备份失败，请保留页面并重试云端同步' })
    }
  }

  function captureWorkspace(owner = ownerId()) {
    if (!boardReady() || loadedMode !== activeMode() || loadedOwner !== owner) return
    const xml = captureBoard()
    const previous = owner ? cloudSlots()[activeMode()]?.report : sessions()[activeMode()]?.report
    if (!xml || xml === previous?.boardXml) return
    const next = { results: previous?.results ?? [], hint: previous?.hint ?? '', objects: listObjects(), boardXml: xml }
    if (owner !== ownerId()) {
      if (!owner) patchSession(activeMode(), { report: next })
      else {
        try { writePendingCloud(owner, activeMode(), { ...cloudSlots()[activeMode()], report: next }) } catch { /* Keep the old account's in-memory copy until it is detached. */ }
      }
      return
    }
    patchWorkspace(activeMode(), { report: next })
    setReport(next)
  }

  function scheduleSync(target = activeMode()) {
    window.clearTimeout(syncTimer)
    if (!ownerId() || running()) return
    syncTimer = window.setTimeout(() => void syncCloud(target), 800)
  }

  async function syncCloud(target = activeMode()) {
    const owner = ownerId()
    if (!owner || !pendingModes()[target] || saving.has(target)) return
    const generation = cloudGeneration
    const revision = revisions.get(target) ?? 0
    const slot = cloudSlots()[target]
    saving.add(target)
    setSyncing(true)
    try {
      const saved = await saveCloudSession(slot, slot.messages, slot.report, owner)
      if (owner !== ownerId() || generation !== cloudGeneration) return
      setCloudSlots((slots) => ({ ...slots, [target]: { ...slots[target], ...saved } }))
      const unchanged = revision === (revisions.get(target) ?? 0)
      setPendingModes((current) => ({ ...current, [target]: !unchanged }))
      persistPending(target)
      if (target === activeMode()) setSyncNote({ ok: unchanged, text: unchanged ? '已同步到云端' : '有新的修改待同步' })
      if (!unchanged) scheduleSync(target)
    } catch (reason) {
      if (owner === ownerId() && generation === cloudGeneration && target === activeMode()) {
        setSyncNote({ ok: false, text: readableError(reason, '云端同步失败，已保留本机待同步副本') })
      }
    } finally {
      if (owner === ownerId() && generation === cloudGeneration) {
        saving.delete(target)
        setSyncing(saving.size > 0)
      }
    }
  }

  async function loadCloudMode(target: CalculatorMode) {
    if (cloudLoaded.has(target)) return
    const generation = cloudGeneration
    const owner = ownerId()
    const pending = readPendingCloud(owner, target)
    const slot = pending ?? await latestCloudSession(target)
    if (generation !== cloudGeneration || owner !== ownerId()) return
    if (cloudLoaded.has(target)) return
    setCloudSlots((currentSlots) => ({ ...currentSlots, [target]: slot }))
    cloudLoaded.add(target)
    if (pending) {
      setPendingModes((current) => ({ ...current, [target]: true }))
      if (target === activeMode()) setSyncNote({ ok: false, text: '已恢复本机待同步副本，请重试同步' })
    }
  }

  async function loadBoard(target: CalculatorMode) {
    const generation = ++loadGeneration
    const owner = ownerId()
    stopBoardChanges?.()
    window.clearTimeout(snapshotTimer)
    loadedMode = null
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
      const board = frame()
      if (board) resizeBoard(board.clientWidth, board.clientHeight)
      const saved = reportFor(target)
      if (saved) {
        if (saved.boardXml) restoreBoard(saved.boardXml)
        else {
          const commands = saved.results.filter((item) => item.status === 'ok').map((item) => item.command)
          const restored = restoreCommands(commands, target, { angleUnit: unit(), enforceAngle: false })
          if (hasFailure(restored)) throw new Error('旧会话的作图未能完整恢复，请查看命令并重新作图')
        }
        setReport(saved)
      }
      if (target === 'geometry' && generation === loadGeneration) setCoordinateSystem(showAxes())
      loadedOwner = owner
      loadedMode = target
      setBoardReady(true)
      stopBoardChanges = onBoardChange(() => {
        window.clearTimeout(snapshotTimer)
        snapshotTimer = window.setTimeout(() => {
          if (generation !== loadGeneration || owner !== ownerId()) return
          captureWorkspace()
          scheduleSync()
        }, 250)
      })
    } catch (reason) {
      if (generation !== loadGeneration) return
      setBoardError(reason instanceof Error ? reason.message : '画板加载失败')
    }
  }

  async function switchMode(next: CalculatorMode) {
    if (next === activeMode() || running()) return
    captureWorkspace()
    void syncCloud(activeMode())
    const generation = ++loadGeneration
    const owner = ownerId()
    stopBoardChanges?.()
    window.clearTimeout(snapshotTimer)
    window.clearTimeout(syncTimer)
    loadedMode = null
    unmountBoard()
    setBoardReady(false)
    turnGeneration += 1
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
        if (generation === loadGeneration && owner === ownerId() && next === activeMode()) {
          setError(readableError(reason, '云端会话读取失败'))
        }
      }
    }
    if (generation === loadGeneration && owner === ownerId() && next === activeMode()) await loadBoard(next)
  }

  async function chooseModel(modelId: string) {
    const user = authUser()
    if (!user) return
    const token = pb.authStore.token
    try {
      const updated = await pb.collection('users').update(user.id, { model: modelId })
      if (ownerId() === user.id && pb.authStore.token === token) pb.authStore.save(token, updated)
    } catch (reason) {
      if (ownerId() === user.id && pb.authStore.token === token) setError(readableError(reason, '模型切换失败'))
    }
  }

  onMount(() => {
    authSeen = pb.authStore.isValid ? pb.authStore.record?.id || '' : ''
    const stop = pb.authStore.onChange(() => {
      const next = pb.authStore.isValid ? pb.authStore.record?.id || '' : ''
      if (next === authSeen) return
      captureWorkspace(authSeen)
      authSeen = next
      cloudGeneration += 1
      loadGeneration += 1
      turnGeneration += 1
      controller?.abort()
      renderDraft.clear()
      window.clearTimeout(snapshotTimer)
      window.clearTimeout(syncTimer)
      stopBoardChanges?.()
      loadedMode = null
      unmountBoard()
      cloudLoaded.clear()
      revisions.clear()
      saving.clear()
      setCloudSlots(emptyCloudMap())
      setPendingModes({})
      setSyncing(false)
      setRunning(false)
      setDraft('')
      setReport(null)
      setError('')
      setBoardReady(false)
      setSyncNote({ ok: false, text: '' })
      const generation = cloudGeneration
      void (async () => {
        if (loggedIn()) {
          try {
            await loadCloudMode(activeMode())
          } catch (reason) {
            if (generation === cloudGeneration) setError(readableError(reason, '云端会话读取失败'))
          }
        }
        if (generation === cloudGeneration) await loadBoard(activeMode())
      })()
    })
    onCleanup(stop)

    void (async () => {
      const generation = cloudGeneration
      try {
        const [status, list] = await Promise.all([fetchLlmStatus(), fetchModels()])
        setLlm(status)
        setModels(list)
      } catch {
        setLlm({ configured: false, model: '' })
      }
      if (generation !== cloudGeneration) return
      if (!isCalculatorMode(mode())) setMode('geometry')
      const sessionId = new URLSearchParams(window.location.search).get('session')
      if (loggedIn()) {
        try {
          if (sessionId) {
            const slot = await loadCloudSession(sessionId)
            if (generation !== cloudGeneration) return
            const pending = readPendingCloud(ownerId(), slot.mode)
            const restored = pending ?? slot
            setMode(restored.mode)
            setCloudSlots((currentSlots) => ({ ...currentSlots, [restored.mode]: restored }))
            cloudLoaded.add(restored.mode)
            if (pending) {
              setPendingModes((current) => ({ ...current, [restored.mode]: true }))
              setSyncNote({ ok: false, text: pending.id === sessionId ? '已恢复本机待同步副本，请重试同步' : '该模式有未同步修改，已优先恢复本机副本，请先同步后再打开其他会话' })
            }
          } else {
            await loadCloudMode(activeMode())
          }
        } catch (reason) {
          if (generation === cloudGeneration) setError(readableError(reason, '云端会话读取失败'))
        }
      }
      if (generation === cloudGeneration) await loadBoard(activeMode())
    })()
  })

  function backupBeforeLeave() {
    captureWorkspace()
  }
  onMount(() => window.addEventListener('pagehide', backupBeforeLeave))

  onCleanup(() => {
    captureWorkspace()
    turnGeneration += 1
    loadGeneration += 1
    cloudGeneration += 1
    controller?.abort()
    renderDraft.clear()
    window.clearTimeout(snapshotTimer)
    window.clearTimeout(syncTimer)
    window.removeEventListener('pagehide', backupBeforeLeave)
    stopBoardChanges?.()
    unmountBoard()
  })

  async function clearConstruction() {
    const id = activeMode()
    turnGeneration += 1
    controller?.abort()
    renderDraft.clear()
    window.clearTimeout(snapshotTimer)
    window.clearTimeout(syncTimer)
    if (modeDefinition(id).ready) {
      resetBoard()
      if (id === 'geometry') setCoordinateSystem(showAxes())
    }
    patchWorkspace(id, emptySession())
    setDraft('')
    setReport(null)
    setAttempts(0)
    setError('')
    setRunning(false)
    captureWorkspace()
    void syncCloud(id)
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
    captureWorkspace()
    controller?.abort()
    const requestController = new AbortController()
    controller = requestController
    const generation = ++turnGeneration
    const owner = ownerId()
    const isCurrent = () => generation === turnGeneration && owner === ownerId() && id === activeMode()
    const history: ChatTurn[] = [...activeSession().messages, { role: 'user', content: text }]
    let streamedText = ''
    let completed = false
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
        signal: requestController.signal,
        onText: (text) => {
          if (!isCurrent() || requestController.signal.aborted) return
          streamedText = text
          renderDraft(text)
        },
        onReport: (next) => {
          if (!isCurrent() || requestController.signal.aborted) return
          const boardXml = captureBoard()
          const saved = { ...next, ...(boardXml ? { boardXml } : {}) }
          setReport(saved)
          patchWorkspace(id, { report: saved })
          setAttempts((count) => count + 1)
        },
      })
      if (!isCurrent()) return
      requestController.signal.throwIfAborted()
      const finalMessages: ChatTurn[] = [
        ...history,
        { role: 'assistant', content: answer || (id === 'scientific' || id === 'probability' ? '计算已完成。' : '作图已执行。') },
      ]
      patchWorkspace(id, { messages: finalMessages, input: '' })
      completed = true
    } catch (reason) {
      if (!isCurrent()) return
      if (!requestController.signal.aborted) setError(reason instanceof Error ? reason.message : '模型请求失败')
    } finally {
      if (isCurrent()) {
        renderDraft.clear()
        if (!completed && streamedText.trim()) {
          patchWorkspace(id, { messages: [...history, { role: 'assistant', content: streamedText }] })
        }
        setDraft('')
        captureWorkspace()
        setRunning(false)
        void syncCloud(id)
      }
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
          <Show when={loggedIn() && pendingModes()[activeMode()]}>
            <button class="btn ghost" type="button" disabled={running() || syncing()} onClick={() => { captureWorkspace(); void syncCloud() }}>
              {syncing() ? '同步中…' : '重试同步'}
            </button>
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
              onInput={(event) => {
                patchWorkspace(activeMode(), { input: event.currentTarget.value })
                scheduleSync()
              }}
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
              <div class="board-state">
                <p>{boardError() || '正在加载画板…'}</p>
                <Show when={boardError()}>
                  <button class="btn ghost" type="button" onClick={() => void loadBoard(activeMode())}>重新加载画板</button>
                  <Show when={getApi()}>
                    <button class="btn ghost" type="button" onClick={() => {
                      setBoardReady(true)
                      void clearConstruction().then(() => loadBoard(activeMode()))
                    }}>清空并重新开始</button>
                  </Show>
                </Show>
              </div>
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

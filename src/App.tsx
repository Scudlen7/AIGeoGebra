import { createAutofocus } from '@solid-primitives/autofocus'
import { writeClipboard } from '@solid-primitives/clipboard'
import { createShortcut } from '@solid-primitives/keyboard'
import { createResizeObserver } from '@solid-primitives/resize-observer'
import { throttle } from '@solid-primitives/scheduled'
import { makePersisted } from '@solid-primitives/storage'
import { For, Show, createSignal, onCleanup, onMount, type Signal } from 'solid-js'
import { AccountBar } from './AccountBar'
import { Icon } from './Icon'
import { ModelPicker } from './ModelPicker'
import { blankCloud, fetchModels, loadCloudSession, readableError, saveCloudSession, latestCloudSession, type CloudSession, type PublicModel } from './api'
import { captureBoard, getApi, listObjects, mountBoard, onBoardChange, resetBoard, resizeBoard, restoreBoard, restoreCommands, setCoordinateSystem, unmountBoard } from './board'
import { hasFailure, runTurn } from './chat'
import { renderMarkdown } from './markdown'
import { assistantText } from './assistant-text'
import { isCalculatorMode, modeDefinition, modeList } from './modes'
import { authUser, loggedIn, pb } from './pb'
import { fetchProviders, personalModels, preferredModel } from './providers'
import { emptySession, emptySessions, migrateLegacyStorage, modeStorageKey, normalizeSessions, readPendingCloud, readPendingSession, readDraft, writeDraft, sessionStorageKey, writePendingCloud } from './session'
import type { AngleUnit, CalculatorMode, ChatTurn, ConstructionReport, ModeSession, SessionMap } from './types'

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

export function App(props: { sessionId?: string; draftId?: string; initialMode?: CalculatorMode; initialName?: string; onSessionSaved?: (id: string) => void; onModeChange?: (mode: CalculatorMode) => void }) {
  migrateLegacyStorage()
  const [loadingModels, setLoadingModels] = createSignal(true)
  const [savingModel, setSavingModel] = createSignal(false)
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
  const [mobileView, setMobileView] = createSignal<'chat' | 'board'>('chat')
  const [error, setError] = createSignal('')
  const [syncNote, setSyncNote] = createSignal({ ok: false, text: '' })
  const [pendingModes, setPendingModes] = createSignal<Partial<Record<CalculatorMode, boolean>>>({})
  const [retryModes, setRetryModes] = createSignal<Partial<Record<CalculatorMode, boolean>>>({})
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
  let modelGeneration = 0
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
  const saving = new Map<CalculatorMode, number>()
  const ownerId = () => loggedIn() ? authUser()!.id : ''

  const activeMode = (): CalculatorMode => (isCalculatorMode(mode()) ? mode() : 'geometry')
  const current = () => modeDefinition(activeMode())
  const unit = (): AngleUnit => (angleUnit() === 'radian' ? 'radian' : 'degree')
  const activeSession = () => {
    if (loggedIn()) return cloudSlots()[activeMode()] ?? blankCloud(activeMode())
    return { ...(sessions()[activeMode()] ?? emptySession()), id: null, name: '', mode: activeMode() }
  }
  const messagesFor = (id: CalculatorMode) => (loggedIn() ? cloudSlots()[id]?.messages ?? [] : (sessions()[id] ?? emptySession()).messages)
  const shownName = () => cloudSlots()[activeMode()]?.name || (activeSession().id ? '未命名会话' : '新会话')

  const requestModel = () => preferredModel(models(), authUser()?.model)
  const canUseModel = () => Boolean(requestModel()) && !savingModel()

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

  function persistPending(target: CalculatorMode, savedUnnamed = false) {
    const owner = ownerId()
    if (!owner) return
    try {
      const slot = cloudSlots()[target]
      if (props.draftId) {
        writeDraft(owner, props.draftId, slot)
        if (!slot.id) return
      }
      writePendingCloud(owner, target, pendingModes()[target] ? slot : null, slot.id)
      if (savedUnnamed && !props.draftId) writePendingCloud(owner, target, null)
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
        try {
          const slot = { ...cloudSlots()[activeMode()], report: next }
          if (props.draftId) writeDraft(owner, props.draftId, slot)
          else writePendingCloud(owner, activeMode(), slot)
        } catch { /* Keep the old account's in-memory copy until it is detached. */ }
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

  async function syncCloud(target = activeMode(), leaving = false) {
    const owner = ownerId()
    if (!owner || !pendingModes()[target]) return
    const revision = revisions.get(target) ?? 0
    const slot = cloudSlots()[target]
    if (!slot.id && !slot.messages.some((message) => message.role === 'user' && message.content.trim())) return
    if (saving.has(target) && (!leaving || saving.get(target) === revision || !slot.id)) return
    const generation = cloudGeneration
    saving.set(target, revision)
    setSyncing(true)
    try {
      const saved = await saveCloudSession(slot, slot.messages, slot.report, owner)
      if (owner !== ownerId() || generation !== cloudGeneration) {
        if (!slot.id && props.draftId) {
          const recovered = { ...(readDraft(owner, props.draftId) ?? slot), ...saved }
          writeDraft(owner, props.draftId, recovered)
          writePendingCloud(owner, target, recovered)
        }
        if (slot.id) {
          const pending = readPendingSession(owner, slot.id)
          if (pending && JSON.stringify([pending.input, pending.messages, pending.report]) === JSON.stringify([slot.input, slot.messages, slot.report])) {
            writePendingCloud(owner, target, null, slot.id)
          }
        }
        return
      }
      setCloudSlots((slots) => ({ ...slots, [target]: { ...slots[target], ...saved } }))
      const unchanged = revision === (revisions.get(target) ?? 0)
      setPendingModes((current) => ({ ...current, [target]: !unchanged }))
      setRetryModes((current) => ({ ...current, [target]: false }))
      persistPending(target, !slot.id)
      if (target === activeMode()) setSyncNote({ ok: unchanged, text: unchanged ? '已同步到云端' : '有新的修改待同步' })
      if (!unchanged) scheduleSync(target)
      if (props.draftId && unchanged && !running() && !leaving) props.onSessionSaved?.(saved.id)
    } catch (reason) {
      if (owner === ownerId() && generation === cloudGeneration) {
        setRetryModes((current) => ({ ...current, [target]: true }))
        if (target === activeMode()) setSyncNote({ ok: false, text: readableError(reason, '云端同步失败，已保留本机待同步副本') })
      }
    } finally {
      if (owner === ownerId() && generation === cloudGeneration) {
        saving.delete(target)
        setSyncing(saving.size > 0)
      }
    }
  }

  function setCloudSession(slot: CloudSession, pending: boolean) {
    const target = slot.mode
    setCloudSlots((currentSlots) => ({ ...currentSlots, [target]: slot }))
    cloudLoaded.add(target)
    if (pending) {
      setRetryModes((current) => ({ ...current, [target]: true }))
      setPendingModes((current) => ({ ...current, [target]: true }))
      if (target === activeMode()) setSyncNote({ ok: false, text: '已恢复本机待同步副本，请重试同步' })
    }
  }

  async function loadCloudMode(target: CalculatorMode) {
    if (cloudLoaded.has(target)) return
    const generation = cloudGeneration
    const owner = ownerId()
    const legacy = readPendingCloud(owner, target)
    const slot = legacy ?? await latestCloudSession(target)
    if (generation !== cloudGeneration || owner !== ownerId()) return
    if (cloudLoaded.has(target)) return
    const pending = legacy ?? (slot.id ? readPendingSession(owner, slot.id) : null)
    setCloudSession(pending ?? slot, Boolean(pending))
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
    if (props.onModeChange) {
      props.onModeChange(next)
      return
    }
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

  async function loadWorkspace() {
    const generation = ++loadGeneration
    const owner = ownerId()
    setBoardError('')
    if (owner) {
      try {
        if (props.draftId) {
          const cached = readDraft(owner, props.draftId)
          const pending = cached?.id ? readPendingSession(owner, cached.id) : null
          const slot = cached?.id
            ? pending ?? await loadCloudSession(cached.id)
            : cached ?? { ...blankCloud(props.initialMode ?? 'geometry'), name: props.initialName?.trim() || '' }
          if (generation !== loadGeneration || owner !== ownerId()) return
          setMode(slot.mode)
          setCloudSession(slot, Boolean(pending || (cached && !cached.id && cached.messages.length)))
        } else if (props.sessionId) {
          const pending = readPendingSession(owner, props.sessionId)
          const slot = pending ?? await loadCloudSession(props.sessionId)
          if (generation !== loadGeneration || owner !== ownerId()) return
          setMode(slot.mode)
          setCloudSession(slot, Boolean(pending))
        } else {
          await loadCloudMode(activeMode())
        }
      } catch (reason) {
        if (generation !== loadGeneration || owner !== ownerId()) return
        if (props.sessionId || props.draftId) {
          setBoardError('无法打开此会话，请重试或返回工作台选择其他会话')
          return
        }
        setError(readableError(reason, '云端会话读取失败'))
      }
    }
    if (generation === loadGeneration && owner === ownerId()) await loadBoard(activeMode())
  }

  async function loadModels() {
    const generation = ++modelGeneration
    const owner = ownerId()
    setLoadingModels(true)
    setSavingModel(false)
    setModels([])
    const [platform, personal] = await Promise.allSettled([fetchModels(), owner ? fetchProviders() : Promise.resolve([])])
    if (generation !== modelGeneration || owner !== ownerId()) return
    setModels([
      ...(personal.status === 'fulfilled' ? personalModels(personal.value) : []),
      ...(platform.status === 'fulfilled' ? platform.value : []),
    ])
    setLoadingModels(false)
  }

  async function chooseModel(modelId: string) {
    const user = authUser()
    if (!user || running() || savingModel() || requestModel()?.id === modelId || !models().some((item) => item.id === modelId)) return
    const token = pb.authStore.token
    const generation = modelGeneration
    const isCurrent = () => generation === modelGeneration && ownerId() === user.id && pb.authStore.token === token
    setSavingModel(true)
    setError('')
    try {
      const updated = await pb.collection('users').update(user.id, { model: modelId })
      if (isCurrent()) pb.authStore.save(token, updated)
    } catch (reason) {
      if (isCurrent()) setError(readableError(reason, '模型切换失败'))
    } finally {
      if (generation === modelGeneration) setSavingModel(false)
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
      setRetryModes({})
      setSyncing(false)
      setRunning(false)
      setDraft('')
      setReport(null)
      setError('')
      setBoardReady(false)
      setSyncNote({ ok: false, text: '' })
      void loadModels()
      void loadWorkspace()
    })
    onCleanup(stop)

    void loadModels()
    if (!isCalculatorMode(mode())) setMode('geometry')
    void loadWorkspace()
  })

  function backupBeforeLeave() {
    captureWorkspace()
  }
  onMount(() => window.addEventListener('pagehide', backupBeforeLeave))

  onCleanup(() => {
    captureWorkspace(loadedOwner)
    if (loadedOwner === ownerId() && (activeSession().id || activeSession().messages.length)) void syncCloud(activeMode(), true)
    modelGeneration += 1
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
    const model = requestModel()
    if (!text || running() || !boardReady() || !model || savingModel() || !modeDefinition(id).ready) return
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
        model: model.id,
        connection: model.connection,
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
      <AccountBar workbenchMode={activeMode()} sessionId={activeSession().id} />
      <header class="workspace-head">
        <div class="workspace-identity">
          <p class="eyebrow">{current().eyebrow}</p>
          <h1>{current().title}</h1>
          <Show when={loggedIn()}>
            <p class="session-name">当前会话 {shownName()}</p>
          </Show>
          <Show when={loggedIn() || syncNote().text}>
            <p class="sync-note" title={syncNote().text} classList={{ ok: syncNote().ok, bad: !syncNote().ok }}>{syncNote().text}</p>
          </Show>
          <Show when={loggedIn() && pendingModes()[activeMode()] && retryModes()[activeMode()]}>
            <button class="btn ghost" type="button" disabled={running() || syncing()} onClick={() => { captureWorkspace(); void syncCloud() }}>
              {syncing() ? '同步中…' : '重试同步'}
            </button>
          </Show>
        </div>
        <p class="lede">{current().lede}</p>
        <div class="model-slot">
          <Show when={loggedIn() && models().length > 0} fallback={
            <p class="meta">{loadingModels() ? '正在读取模型…' : requestModel() ? `当前模型 ${requestModel()?.label}` : '模型未配置'}</p>
          }>
            <ModelPicker models={models()} selected={requestModel()} disabled={running() || savingModel()}
              saving={savingModel()} onSelect={(id) => void chooseModel(id)} />
          </Show>
        </div>
        <nav class="modes" aria-label={props.onModeChange ? '会话模块' : '计算器模式'}>
          <For each={modeList}>
            {(item) => (
              <button
                type="button"
                classList={{ active: activeMode() === item.id }}
                aria-pressed={activeMode() === item.id}
                disabled={running()}
                title={props.onModeChange && activeMode() !== item.id ? `查看${item.label}会话` : item.label}
                onClick={() => void switchMode(item.id)}
              >
                {item.label}
              </button>
            )}
          </For>
        </nav>
      </header>

      <div class="mobile-work-tabs" aria-label="工作区视图">
        <button class="btn ghost" classList={{ active: mobileView() === 'chat' }} aria-pressed={mobileView() === 'chat'} onClick={() => setMobileView('chat')}><Icon name="chat-circle-text" />对话</button>
        <button class="btn ghost" classList={{ active: mobileView() === 'board' }} aria-pressed={mobileView() === 'board'} onClick={() => setMobileView('board')}><Icon name="squares-four" />画板</button>
      </div>
      <main id="main-content" class="workspace" data-mobile={mobileView()}>
        <section class="conversation">
          <div class="conversation-heading"><Icon name="chat-circle-text" />与数学助手对话</div>
          <div class="rule" />
          <details class="example-picker">
          <summary>试试示例问题</summary>
          <div class="examples">
            <For each={current().examples}>
              {(example) => (
                <button
                  type="button"
                  disabled={running() || !boardReady() || !canUseModel()}
                  onClick={() => void submit(example)}
                >
                  {example}
                </button>
              )}
            </For>
          </div>
          </details>

          <div class="transcript">
            <Show when={activeMode()} keyed>
              {(id) => (
                <>
                  <Show when={messagesFor(id).length === 0 && !draft()}>
                    <div class="welcome"><Icon name="function" /><h2>今天，想探索什么？</h2><p class="lede">{modeDefinition(id).empty}</p><div class="examples"><button disabled={running() || !boardReady() || !canUseModel()} onClick={() => void submit(modeDefinition(id).examples[0])}>{modeDefinition(id).examples[0]}<Icon name="arrow-right" /></button></div></div>
                  </Show>
                  <For each={messagesFor(id)}>
                    {(message) => (
                      <article class={message.role}>
                        <Show when={message.role === 'assistant'} fallback={<p>{message.content}</p>}>
                          <div class="assistant-label"><Icon name="function" />数学助手</div><div class="md" innerHTML={renderMarkdown(assistantText(message.content))} />
                        </Show>
                      </article>
                    )}
                  </For>
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
            <Show when={!loadingModels() && !savingModel() && !requestModel()}>
              <p class="banner">
                {loggedIn()
                  ? (models().length ? '请先从上方选择一个模型。' : <>请在 <a class="back-link" href="/settings/models">模型偏好</a> 中添加供应商并选择模型。</>)
                  : <>你可以直接使用画板，也可以<a class="back-link" href="/login">登录</a>后配置自己的数学助手。</>}
              </p>
            </Show>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            <label class="composer-label" for="math-prompt">描述你的问题</label>
            <textarea
              id="math-prompt"
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
              <span class="input-hint">Enter 发送 · Shift + Enter 换行</span>
              <Show when={running()}><button type="button" class="ghost" onClick={() => { controller?.abort(); renderDraft.clear(); setDraft(''); setRunning(false) }}>停止</button></Show>
              <button type="button" class="ghost" onClick={() => void clearConstruction()} disabled={current().ready && !boardReady()}>
                清空
              </button>
              <button
                type="submit"
                disabled={running() || !boardReady() || !canUseModel() || !current().ready || !activeSession().input.trim()}
              >
                {running() ? `${current().submitLabel}中…` : current().submitLabel}
              </button>
            </div>
          </form>
        </section>

        <section class="stage">
          <div class="stage-tools">
            <span class="stage-label">{current().label}画板</span>
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
          <div class="rule" />
          <div class="board-frame" ref={setFrame}>
            <div class="board-host" ref={host} />
            <Show when={current().ready && !boardReady()}>
              <div class="board-state">
                <Show when={!boardError()}><div class="skeleton" /><div class="skeleton short" /></Show>
                <p>{boardError() || '正在加载画板…'}</p>
                <Show when={boardError()}>
                  <button class="btn ghost" type="button" onClick={() => {
                    if (props.sessionId && activeSession().id !== props.sessionId) void loadWorkspace()
                    else void loadBoard(activeMode())
                  }}>重新加载</button>
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
      <footer class="workspace-footer"><span>{loggedIn() ? (activeSession().id ? '登录会话 · 自动保存到云端' : '本机草稿 · 发送消息后保存到云端') : '访客模式 · 会话保存在本机'}</span><span>四种模式，分别探索</span></footer>
    </div>
  )
}

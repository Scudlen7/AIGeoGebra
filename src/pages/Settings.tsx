import { useNavigate } from '@solidjs/router'
import { For, Show, createSignal, onCleanup, onMount } from 'solid-js'
import { AccountBar } from '../AccountBar'
import { downloadJson, fetchGateway, fetchModels, fetchSummary, postAuth, readableError, retryAfterOf, sessionExport, testModel, type GatewayModel, type PublicModel, type UsageSummary } from '../api'
import { clearLocalAiggbCache } from '../session'
import { authUser, loggedIn, pb } from '../pb'

export function Settings() {
  const navigate = useNavigate()
  const [models, setModels] = createSignal<PublicModel[]>([])
  const [gateway, setGateway] = createSignal<GatewayModel[]>([])
  const [summary, setSummary] = createSignal<UsageSummary | null>(null)
  const [name, setName] = createSignal('')
  const [email, setEmail] = createSignal('')
  const [code, setCode] = createSignal('')
  const [oldPassword, setOldPassword] = createSignal('')
  const [password, setPassword] = createSignal('')
  const [passwordConfirm, setPasswordConfirm] = createSignal('')
  const [notice, setNotice] = createSignal('')
  const [error, setError] = createSignal('')
  const [tests, setTests] = createSignal<Record<string, string>>({})
  const [wait, setWait] = createSignal(0)
  let timer: number | undefined
  onCleanup(() => window.clearInterval(timer))

  onMount(() => {
    if (!loggedIn()) {
      navigate('/login?redirect=' + encodeURIComponent('/settings'), { replace: true })
      return
    }
    setName(String(authUser()?.name || ''))
    setEmail(String(authUser()?.email || ''))
    Promise.all([fetchModels(), fetchGateway(), fetchSummary().catch(() => null)])
      .then(([modelList, gatewayList, usage]) => {
        setModels(modelList)
        setGateway(gatewayList)
        setSummary(usage)
      })
      .catch((reason) => setError(readableError(reason, '设置加载失败')))
  })

  function selectedModel() {
    const chosen = String(authUser()?.model || '')
    return models().some((item) => item.id === chosen) ? chosen : models()[0]?.id || ''
  }

  async function chooseModel(modelId: string) {
    const user = authUser()
    if (!user) return
    setError('')
    const updated = await pb.collection('users').update(user.id, { model: modelId })
    pb.authStore.save(pb.authStore.token, updated)
    setNotice('模型已保存，下次请求生效')
  }

  async function runTest(id: string) {
    setTests((current) => ({ ...current, [id]: '测试中…' }))
    const result = await testModel(id)
    setTests((current) => ({ ...current, [id]: result.ok ? `已连通，${result.latencyMs} ms` : `连接失败${result.error ? `：${result.error}` : ''}` }))
  }

  async function saveName(event: Event) {
    event.preventDefault()
    const user = authUser()
    if (!user) return
    if ([...name().trim()].length < 2) {
      setError('昵称至少 2 个字符')
      return
    }
    setError('')
    try {
      const updated = await pb.collection('users').update(user.id, { name: name().trim() })
      pb.authStore.save(pb.authStore.token, updated)
      setNotice('昵称已更新')
    } catch (reason) {
      setError(readableError(reason, '昵称更新失败'))
    }
  }

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

  async function sendEmailCode() {
    setError('')
    try {
      await postAuth('/api/auth/request-code', { email: email().trim().toLowerCase(), purpose: 'email_change' }, true)
      startWait(60)
      setNotice('验证码已发到新邮箱')
    } catch (reason) {
      const retry = retryAfterOf(reason)
      if (retry) startWait(retry)
      setError(readableError(reason, '验证码发送失败'))
    }
  }

  async function changeEmail(event: Event) {
    event.preventDefault()
    setError('')
    try {
      await postAuth('/api/auth/change-email', { email: email().trim().toLowerCase(), code: code().trim() }, true)
      await pb.collection('users').authRefresh()
      setNotice('邮箱已更新')
      setCode('')
    } catch (reason) {
      setError(readableError(reason, '邮箱更新失败'))
    }
  }

  async function changePassword(event: Event) {
    event.preventDefault()
    const user = authUser()
    if (!user) return
    if (password().length < 8) {
      setError('密码至少 8 位')
      return
    }
    if (password() !== passwordConfirm()) {
      setError('两次输入的密码不一致')
      return
    }
    setError('')
    try {
      await pb.collection('users').update(user.id, {
        oldPassword: oldPassword(),
        password: password(),
        passwordConfirm: passwordConfirm(),
      })
      await pb.collection('users').authWithPassword(String(user.email || ''), password())
      setOldPassword('')
      setPassword('')
      setPasswordConfirm('')
      setNotice('密码已更新')
    } catch (reason) {
      setError(readableError(reason, '密码更新失败'))
    }
  }

  async function exportAll() {
    const list = await pb.collection('sessions').getFullList({ sort: '-updated' })
    downloadJson('aiggb-sessions.json', list.map((item) => sessionExport(item as unknown as Record<string, unknown>)))
    setNotice('已导出全部会话')
  }

  function clearCache() {
    if (!window.confirm('只清空本机 aiggb.* 缓存。不会退出登录，也不会删除云端会话。')) return
    clearLocalAiggbCache()
    window.location.reload()
  }

  async function deleteAccount() {
    const user = authUser()
    if (!user) return
    if (!window.confirm('删除账号后，会话和用量记录会一并删除，且不可恢复。确定删除？')) return
    await pb.collection('users').delete(user.id)
    pb.authStore.clear()
    navigate('/')
  }

  function monthStat(id: string) {
    return summary()?.gatewayMonth.models.find((item) => item.model === id)
  }

  return (
    <div class="subpage">
      <AccountBar />
      <main class="page">
        <div class="page-head">
          <h1>设置</h1>
          <p>模型由服务端环境变量决定。这里不能填写、查看、复制或重置密钥。</p>
        </div>
        {notice() ? <p class="note">{notice()}</p> : null}
        {error() ? <p class="banner">{error()}</p> : null}

        <section class="card">
          <h2>模型</h2>
          <Show when={models().length > 0} fallback={<p class="empty">模型未配置</p>}>
            <label>
              当前模型
              <select value={selectedModel()} onChange={(event) => void chooseModel(event.currentTarget.value)}>
                <For each={models()}>{(item) => <option value={item.id}>{item.label}{item.gateway ? ' · 网关' : ''}</option>}</For>
              </select>
            </label>
            <ul class="plain">
              <For each={models()}>
                {(item) => (
                  <li>
                    <span>{item.label}{item.gateway ? ' · 网关' : ''}</span>
                    <button class="btn ghost" type="button" onClick={() => void runTest(item.id)}>测试连接</button>
                    <em>{tests()[item.id] || ''}</em>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>

        <Show when={models().some((item) => item.gateway) && gateway().length > 0}>
          <section class="card gateway-card">
            <h2>EdgeOne AI Gateway</h2>
            <For each={gateway()}>
              {(item) => (
                <div class="gateway-block">
                  <p>端点 <code>{item.endpoint}</code></p>
                  <p>网关模型 <code>{item.id}</code></p>
                  <p>本月请求 <b>{monthStat(item.id)?.requests ?? 0}</b></p>
                  <p>本月 Token <b>{monthStat(item.id)?.tokens ?? 0}</b></p>
                </div>
              )}
            </For>
          </section>
        </Show>

        <section class="card">
          <h2>账户</h2>
          <form class="stack-form" onSubmit={(event) => void saveName(event)}>
            <label>
              昵称
              <input value={name()} onInput={(event) => setName(event.currentTarget.value)} />
            </label>
            <button class="btn" type="submit">保存昵称</button>
          </form>
          <form class="stack-form" onSubmit={(event) => void changeEmail(event)}>
            <label>
              新邮箱
              <span class="code-row">
                <input type="email" value={email()} onInput={(event) => setEmail(event.currentTarget.value)} />
                <button class="btn ghost" type="button" disabled={wait() > 0} onClick={() => void sendEmailCode()}>
                  {wait() > 0 ? `${wait()} 秒后重发` : '发送验证码'}
                </button>
              </span>
            </label>
            <label>
              新邮箱验证码
              <input inputMode="numeric" maxlength={4} value={code()} onInput={(event) => setCode(event.currentTarget.value)} />
            </label>
            <button class="btn" type="submit">更新邮箱</button>
          </form>
          <form class="stack-form" onSubmit={(event) => void changePassword(event)}>
            <label>
              当前密码
              <input type="password" autocomplete="current-password" value={oldPassword()} onInput={(event) => setOldPassword(event.currentTarget.value)} />
            </label>
            <label>
              新密码
              <input type="password" autocomplete="new-password" value={password()} onInput={(event) => setPassword(event.currentTarget.value)} />
            </label>
            <label>
              确认新密码
              <input type="password" autocomplete="new-password" value={passwordConfirm()} onInput={(event) => setPasswordConfirm(event.currentTarget.value)} />
            </label>
            <button class="btn" type="submit">更新密码</button>
          </form>
          <button class="btn danger" type="button" onClick={() => void deleteAccount()}>删除账号</button>
        </section>

        <section class="card">
          <h2>数据</h2>
          <div class="row-actions">
            <button class="btn ghost" type="button" onClick={() => void exportAll()}>导出全部会话</button>
            <button class="btn ghost" type="button" onClick={clearCache}>清空本机缓存</button>
          </div>
          <p class="empty">清空缓存只删除本机 aiggb.* 数据，不清除登录状态，也不删除云端记录。</p>
        </section>
      </main>
    </div>
  )
}

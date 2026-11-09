import { For, Show, createSignal, onMount } from 'solid-js'
import { fetchGateway, fetchModels, fetchSummary, readableError, testModel, type GatewayModel, type PublicModel, type UsageSummary } from '../../api'
import { authUser, pb } from '../../pb'

type ConnectionTest = { state: 'pending' | 'ok' | 'error'; message: string }

function displayName(model: PublicModel) {
  return model.gateway ? model.label.replace(/\s*(?:（网关）|\(网关\)|·\s*网关)\s*$/, '').trim() || model.label : model.label
}

export function ModelSettings() {
  const [models, setModels] = createSignal<PublicModel[]>([])
  const [gateways, setGateways] = createSignal<GatewayModel[]>([])
  const [usage, setUsage] = createSignal<UsageSummary | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [saving, setSaving] = createSignal('')
  const [notice, setNotice] = createSignal('')
  const [error, setError] = createSignal('')
  const [checks, setChecks] = createSignal<Record<string, ConnectionTest>>({})

  onMount(() => {
    fetchModels().then((list) => {
      setModels(list)
      if (list.some((item) => item.gateway)) {
        void fetchGateway().then(setGateways).catch(() => setGateways([]))
        void fetchSummary().then(setUsage).catch(() => setUsage(null))
      }
    }).catch((reason) => setError(readableError(reason, '模型列表加载失败'))).finally(() => setLoading(false))
  })

  const selectedModel = () => {
    const chosen = String(authUser()?.model || '')
    return models().some((item) => item.id === chosen) ? chosen : models()[0]?.id || ''
  }

  async function chooseModel(id: string) {
    const user = authUser()
    if (!user || saving() || id === selectedModel()) return
    const token = pb.authStore.token
    setSaving(id)
    setError('')
    setNotice('')
    try {
      const updated = await pb.collection('users').update(user.id, { model: id })
      if (pb.authStore.token !== token || authUser()?.id !== user.id) return
      pb.authStore.save(token, updated)
      setNotice('默认模型已保存，下次请求生效')
    } catch (reason) {
      setError(readableError(reason, '默认模型保存失败'))
    } finally {
      setSaving('')
    }
  }

  function reportTest(id: string, result: ConnectionTest) {
    setChecks((current) => ({ ...current, [id]: result }))
  }

  async function checkConnection(id: string) {
    reportTest(id, { state: 'pending', message: '正在测试连接' })
    try {
      const result = await testModel(id)
      reportTest(id, result.ok
        ? { state: 'ok', message: `已连通，${result.latencyMs} ms` }
        : { state: 'error', message: result.error || '连接失败' })
    } catch (reason) {
      reportTest(id, { state: 'error', message: readableError(reason, '连接失败') })
    }
  }

  const monthStat = (id: string) => usage()?.gatewayMonth?.models.find((item) => item.model === id)

  return (
    <section aria-labelledby="model-settings-title">
      <header class="settings-section-head">
        <h2 id="model-settings-title">模型偏好</h2>
        <p>选择数学助手默认使用的模型，查看各模型的连接状态。</p>
      </header>
      <Show when={error()}><p class="banner" role="alert">{error()}</p></Show>
      <Show when={!loading()} fallback={<p class="settings-feedback" role="status">正在读取可用模型…</p>}>
        <Show when={models().length} fallback={<p class="settings-feedback">当前没有可用的模型配置。</p>}>
          <div class="settings-row settings-default-model">
            <div>
              <label class="settings-row-title" for="settings-default-model">默认模型</label>
              <p id="settings-model-hint">新请求会使用这个模型。</p>
            </div>
            <select id="settings-default-model" aria-describedby="settings-model-hint" value={saving() || selectedModel()}
              disabled={Boolean(saving())} onChange={(event) => void chooseModel(event.currentTarget.value)}>
              <For each={models()}>{(item) => <option value={item.id}>{displayName(item)}{item.gateway ? ' · 网关' : ''}</option>}</For>
            </select>
          </div>
          <Show when={notice()}><p class="settings-feedback" role="status">{notice()}</p></Show>
          <div class="settings-group">
            <h3>可用模型</h3>
            <ul class="settings-list">
              <For each={models()}>{(model) => (
                <li class="settings-row">
                  <div class="settings-model">
                    <div><span class="settings-row-title">{displayName(model)}</span>
                      <Show when={model.gateway}><span class="settings-badge">网关</span></Show>
                    </div>
                    <Show when={checks()[model.id]}>
                      {(check) => <p class="settings-test-result" classList={{ failed: check().state === 'error' }} role="status">{check().message}</p>}
                    </Show>
                  </div>
                  <button class="btn ghost" type="button" aria-label={`测试连接 ${displayName(model)}`}
                    disabled={checks()[model.id]?.state === 'pending'} onClick={() => void checkConnection(model.id)}>
                    {checks()[model.id]?.state === 'pending' ? '测试中…' : '测试连接'}
                  </button>
                </li>
              )}</For>
            </ul>
          </div>
        </Show>
      </Show>
      <Show when={gateways().length}>
        <details class="settings-gateway">
          <summary>网关详情 <span>EdgeOne AI Gateway</span></summary>
          <For each={gateways()}>{(item) => (
            <dl class="settings-gateway-values">
              <div><dt>端点</dt><dd><code>{item.endpoint}</code></dd></div>
              <div><dt>模型 ID</dt><dd><code>{item.id}</code></dd></div>
              <div><dt>本月请求</dt><dd>{monthStat(item.id)?.requests ?? (usage() ? 0 : '—')}</dd></div>
              <div><dt>本月 Token</dt><dd>{monthStat(item.id)?.tokens ?? (usage() ? 0 : '—')}</dd></div>
            </dl>
          )}</For>
        </details>
      </Show>
    </section>
  )
}

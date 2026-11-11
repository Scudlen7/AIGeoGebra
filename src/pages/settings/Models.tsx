import { For, Show, createMemo, createSignal, onMount } from 'solid-js'
import { fetchGateway, fetchModels, fetchSummary, readableError, testModel, type GatewayModel, type PublicModel, type UsageSummary } from '../../api'
import { ModelPicker } from '../../ModelPicker'
import { authUser, pb } from '../../pb'
import { fetchProviders, personalModels, preferredModel, removeProvider, testPersonalModel, type ModelProvider } from '../../providers'
import { ProviderForm } from './ProviderForm'

type ConnectionTest = { id: string; pending: boolean; ok?: boolean; message: string }

function displayName(model: PublicModel) {
  return model.gateway ? model.label.replace(/\s*(?:（网关）|\(网关\)|·\s*网关)\s*$/, '').trim() || model.label : model.label
}

export function ModelSettings() {
  const [providers, setProviders] = createSignal<ModelProvider[]>([])
  const [platformModels, setPlatformModels] = createSignal<PublicModel[]>([])
  const [gateways, setGateways] = createSignal<GatewayModel[]>([])
  const [usage, setUsage] = createSignal<UsageSummary | null>(null)
  const [editing, setEditing] = createSignal<{ provider?: ModelProvider }>()
  const [loading, setLoading] = createSignal(true)
  const [saving, setSaving] = createSignal(false)
  const [removing, setRemoving] = createSignal('')
  const [notice, setNotice] = createSignal('')
  const [error, setError] = createSignal('')
  const [providerError, setProviderError] = createSignal('')
  const [check, setCheck] = createSignal<ConnectionTest>()

  onMount(async () => {
    const [personal, platform] = await Promise.allSettled([fetchProviders(), fetchModels()])
    if (personal.status === 'fulfilled') setProviders(personal.value)
    else setProviderError(readableError(personal.reason, '供应商列表加载失败'))
    if (platform.status === 'fulfilled') {
      setPlatformModels(platform.value)
      if (platform.value.some((item) => item.gateway)) {
        void fetchGateway().then(setGateways).catch(() => setGateways([]))
        void fetchSummary().then(setUsage).catch(() => setUsage(null))
      }
    }
    setLoading(false)
  })

  const models = createMemo(() => [...personalModels(providers()), ...platformModels()])
  const selected = () => preferredModel(models(), authUser()?.model)

  async function chooseModel(id: string) {
    const user = authUser()
    if (!user || saving() || selected()?.id === id || !models().some((model) => model.id === id)) return
    const token = pb.authStore.token
    setSaving(true)
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
      setSaving(false)
    }
  }

  async function checkConnection(model: PublicModel) {
    if (check()?.pending) return
    setCheck({ id: model.id, pending: true, message: '正在测试连接' })
    try {
      const result = model.connection ? await testPersonalModel(model.connection) : await testModel(model.id)
      setCheck({ id: model.id, pending: false, ok: result.ok, message: result.ok ? `已连通，${result.latencyMs} ms` : result.error || '连接失败' })
    } catch (reason) {
      setCheck({ id: model.id, pending: false, ok: false, message: readableError(reason, '连接失败') })
    }
  }

  function saved(provider: ModelProvider) {
    setProviders((items) => items.some((item) => item.id === provider.id)
      ? items.map((item) => item.id === provider.id ? provider : item)
      : [...items, provider])
    setEditing(undefined)
    setCheck(undefined)
    setError('')
    setProviderError('')
    setNotice('供应商已保存，可在默认模型中选择。')
  }

  async function remove(provider: ModelProvider) {
    if (removing() || !window.confirm(`移除「${provider.name}」和已保存的 API Key？`)) return
    setError('')
    setNotice('')
    setRemoving(provider.id)
    try {
      await removeProvider(provider.id)
      setProviders((items) => items.filter((item) => item.id !== provider.id))
      setCheck(undefined)
      setNotice('供应商已移除')
    } catch (reason) {
      setError(readableError(reason, '供应商移除失败'))
    } finally {
      setRemoving('')
    }
  }

  const monthStat = (id: string) => usage()?.gatewayMonth?.models.find((item) => item.model === id)

  return (
    <Show when={editing()} keyed fallback={
      <section aria-labelledby="model-settings-title">
        <header class="settings-section-head provider-heading">
          <div>
            <h2 id="model-settings-title">模型偏好</h2>
            <p>连接你的模型供应商，选择数学助手作图时使用的默认模型。</p>
          </div>
          <button class="btn" type="button" disabled={loading() || Boolean(removing())} onClick={() => setEditing({})}>
            <span aria-hidden="true">＋</span>添加供应商
          </button>
        </header>
        <Show when={error()}><p class="banner" role="alert">{error()}</p></Show>
        <Show when={notice()}><p class="settings-feedback" role="status">{notice()}</p></Show>
        <Show when={!loading()} fallback={<p class="settings-feedback" role="status">正在读取可用模型…</p>}>
          <div class="settings-row settings-default-model">
            <div>
              <h3 class="settings-row-title" id="settings-default-model">默认模型</h3>
              <p id="settings-model-hint">新请求使用此模型。测试连接会发送一次简短请求。</p>
            </div>
            <div class="provider-default-controls">
              <ModelPicker models={models()} selected={selected()} disabled={!models().length || saving() || Boolean(removing())}
                saving={saving()} labelledBy="settings-default-model" describedBy="settings-model-hint" onSelect={(id) => void chooseModel(id)} />
              <Show when={selected()}>
                {(model) => <button class="btn ghost" type="button" aria-label={`测试连接 ${displayName(model())}`}
                  disabled={saving() || check()?.pending || Boolean(removing())} onClick={() => void checkConnection(model())}>
                  {check()?.pending ? '测试中…' : '测试连接'}
                </button>}
              </Show>
            </div>
            <Show when={check()?.id === selected()?.id && check()}>
              {(result) => <p class="settings-test-result provider-test-result" classList={{ failed: result().ok === false }} role="status">{result().message}</p>}
            </Show>
          </div>

          <div class="settings-group">
            <h3>个人供应商</h3>
            <Show when={providerError()}><p class="settings-feedback" role="alert">{providerError()}</p></Show>
            <Show when={providers().length} fallback={<p class="provider-empty">添加一个供应商，获取它的模型列表。</p>}>
              <ul class="settings-list">
                <For each={providers()}>{(provider) => (
                  <li class="settings-row provider-row">
                    <div class="provider-summary">
                      <span class="settings-row-title">{provider.name}</span>
                      <span class="settings-badge">{provider.protocol === 'anthropic' ? 'Anthropic' : 'OpenAI 兼容'}</span>
                      <p>{provider.baseUrl}</p>
                      <p>{provider.models.length} 个模型 · 已保存 API Key</p>
                    </div>
                    <div class="provider-actions">
                      <button class="btn ghost" type="button" disabled={Boolean(removing())} aria-label={`编辑 ${provider.name}`}
                        onClick={() => setEditing({ provider })}>编辑</button>
                      <button class="btn ghost" type="button" disabled={Boolean(removing())} aria-label={`移除 ${provider.name}`}
                        onClick={() => void remove(provider)}>{removing() === provider.id ? '移除中…' : '移除'}</button>
                    </div>
                  </li>
                )}</For>
              </ul>
            </Show>
          </div>
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
    }>
      {(entry) => <ProviderForm provider={entry.provider} onCancel={() => setEditing(undefined)} onSaved={saved} />}
    </Show>
  )
}

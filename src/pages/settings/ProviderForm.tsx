import { For, Show, createSignal, onCleanup } from 'solid-js'
import { readableError } from '../../api'
import { discoverModels, providerPresets, saveProvider, type ModelProvider, type ProviderModel, type ProviderProtocol } from '../../providers'

export function ProviderForm(props: {
  provider?: ModelProvider
  onCancel: () => void
  onSaved: (provider: ModelProvider) => void
}) {
  const existing = props.provider
  const [preset, setPreset] = createSignal('')
  const [name, setName] = createSignal(existing?.name || '')
  const [baseUrl, setBaseUrl] = createSignal(existing?.baseUrl || '')
  const [protocol, setProtocol] = createSignal<ProviderProtocol>(existing?.protocol || 'openai')
  const [apiKey, setApiKey] = createSignal('')
  const [models, setModels] = createSignal<ProviderModel[]>(existing?.models || [])
  const [manualId, setManualId] = createSignal('')
  const [filter, setFilter] = createSignal('')
  const [busy, setBusy] = createSignal<'discover' | 'save' | ''>('')
  const [error, setError] = createSignal('')
  const [notice, setNotice] = createSignal('')
  let disposed = false
  onCleanup(() => { disposed = true })

  const keepsKey = () => existing?.baseUrl === baseUrl().trim().replace(/\/+$/, '') && existing?.protocol === protocol()
  const credentials = () => ({ baseUrl: baseUrl().trim(), protocol: protocol(), apiKey: apiKey().trim() })
  const visibleModels = () => {
    const query = filter().trim().toLowerCase()
    return models().filter((item) => item.id.toLowerCase().includes(query) || item.label.toLowerCase().includes(query))
  }

  function changeEndpoint(url: string, nextProtocol: ProviderProtocol) {
    if (url.trim().replace(/\/+$/, '') !== baseUrl().trim().replace(/\/+$/, '') || nextProtocol !== protocol()) {
      setApiKey('')
      setModels([])
      setFilter('')
      setNotice('')
    }
    setBaseUrl(url)
    setProtocol(nextProtocol)
  }

  function choosePreset(value: string) {
    setPreset(value)
    const item = providerPresets.find((item) => item.name === value)
    if (!item) return
    setName(item.name)
    changeEndpoint(item.baseUrl, item.protocol)
    setError('')
  }

  function addModel() {
    const id = manualId().trim()
    if (!id || busy()) return
    if (models().some((item) => item.id === id)) {
      setNotice('该模型已在列表中')
    } else if (models().length < 500) {
      setModels((items) => [...items, { id, label: id }])
      setNotice('')
    }
    setManualId('')
    setFilter('')
  }

  async function discover() {
    if (busy()) return
    setError('')
    setNotice('')
    setBusy('discover')
    try {
      const found = await discoverModels({ ...credentials(), id: existing?.id })
      if (disposed) return
      const ids = new Set(found.map((item) => item.id))
      setModels((items) => [...found, ...items.filter((item) => !ids.has(item.id))].slice(0, 500))
      setFilter('')
      setNotice(found.length ? `已获取 ${found.length} 个模型` : '供应商返回了空列表，可以手动添加模型 ID。')
    } catch (reason) {
      if (!disposed) setError(readableError(reason, '获取模型失败，可手动添加模型 ID'))
    } finally {
      if (!disposed) setBusy('')
    }
  }

  async function submit(event: Event) {
    event.preventDefault()
    if (busy()) return
    setError('')
    setBusy('save')
    try {
      const saved = await saveProvider({ ...credentials(), name: name().trim(), models: models() }, existing?.id)
      if (!disposed) {
        setApiKey('')
        props.onSaved(saved)
      }
    } catch (reason) {
      if (!disposed) setError(readableError(reason, '供应商保存失败'))
    } finally {
      if (!disposed) setBusy('')
    }
  }

  return (
    <section aria-labelledby="provider-form-title">
      <header class="settings-section-head">
        <button class="provider-back" type="button" disabled={Boolean(busy())} onClick={props.onCancel}>← 返回模型偏好</button>
        <h2 id="provider-form-title">{existing ? '编辑供应商' : '添加供应商'}</h2>
        <p>选用预设或填写兼容接口。添加模型后，就可以在模型偏好中设为默认。</p>
      </header>
      <form class="provider-form" onSubmit={(event) => void submit(event)}>
        <fieldset disabled={Boolean(busy())}>
          <Show when={!existing}>
            <label>供应商预设
              <select value={preset()} onChange={(event) => choosePreset(event.currentTarget.value)}>
                <option value="">自定义配置</option>
                <For each={providerPresets}>{(item) => <option value={item.name}>{item.name}</option>}</For>
              </select>
            </label>
          </Show>
          <div class="provider-fields">
            <label>供应商名称
              <input required maxlength={80} placeholder="例如 DeepSeek" value={name()} onInput={(event) => setName(event.currentTarget.value)} />
            </label>
            <label>API 协议
              <select value={protocol()} onChange={(event) => changeEndpoint(baseUrl(), event.currentTarget.value === 'anthropic' ? 'anthropic' : 'openai')}>
                <option value="openai">OpenAI 兼容</option>
                <option value="anthropic">Anthropic Messages</option>
              </select>
            </label>
          </div>
          <div class="provider-field">
            <label for="provider-base-url">API 基础地址</label>
            <input id="provider-base-url" aria-describedby="provider-url-hint" required type="url" maxlength={512} placeholder="https://api.example.com/v1" value={baseUrl()}
              onInput={(event) => changeEndpoint(event.currentTarget.value, protocol())} />
            <small id="provider-url-hint">填写供应商的公网 HTTPS API 基础地址，保留它需要的路径，例如 /v1。</small>
          </div>
          <div class="provider-field">
            <label for="provider-api-key">API Key</label>
            <input id="provider-api-key" aria-describedby="provider-key-hint" type="password" autocomplete="new-password" spellcheck={false} required={!keepsKey()} maxlength={4096}
              placeholder={keepsKey() ? '留空以保留已保存的 Key' : '粘贴供应商的 API Key'}
              value={apiKey()} onInput={(event) => setApiKey(event.currentTarget.value)} />
            <small id="provider-key-hint">Key 加密保存，仅用于这个供应商。更改地址或协议时请重新输入。</small>
          </div>
          <section class="provider-models" aria-labelledby="provider-model-list">
            <div class="provider-heading">
              <div>
                <h3 id="provider-model-list">模型列表</h3>
                <p class="settings-feedback">已添加 {models().length} 个。作图需要支持工具调用的模型。</p>
              </div>
              <button class="btn ghost" type="button" disabled={!baseUrl().trim() || (!apiKey().trim() && !keepsKey())}
                onClick={() => void discover()}>{busy() === 'discover' ? '正在获取…' : '获取模型列表'}</button>
            </div>
            <Show when={models().length > 0}>
              <Show when={models().length > 8}>
                <input type="search" aria-label="筛选已添加模型" placeholder="搜索模型名称或 ID" value={filter()} onInput={(event) => setFilter(event.currentTarget.value)} />
              </Show>
              <ul class="provider-model-list" aria-label="已添加模型">
                <For each={visibleModels()}>{(item) => (
                  <li>
                    <div><strong>{item.label}</strong><Show when={item.label !== item.id}><small>{item.id}</small></Show></div>
                    <button class="btn ghost" type="button" aria-label={`移除模型 ${item.id}`}
                      onClick={() => setModels((items) => items.filter((model) => model.id !== item.id))}>移除</button>
                  </li>
                )}</For>
              </ul>
            </Show>
            <div class="provider-manual">
              <input aria-label="手动添加的模型 ID" placeholder="手动输入模型 ID" maxlength={160}
                value={manualId()} onInput={(event) => setManualId(event.currentTarget.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addModel() } }} />
              <button class="btn ghost" type="button" disabled={!manualId().trim() || models().length >= 500} onClick={addModel}>添加模型</button>
            </div>
          </section>
          <Show when={notice()}><p class="settings-feedback" role="status">{notice()}</p></Show>
          <Show when={error()}><p class="banner" role="alert">{error()}</p></Show>
          <div class="provider-actions">
            <button class="btn ghost" type="button" onClick={props.onCancel}>取消</button>
            <button class="btn" type="submit" disabled={!models().length}>{busy() === 'save' ? '正在保存…' : '保存供应商'}</button>
          </div>
        </fieldset>
      </form>
    </section>
  )
}

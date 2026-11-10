import type { PublicModel } from './api'
import { authToken } from './pb'

export type ProviderProtocol = 'openai' | 'anthropic'
export type ProviderModel = { id: string; label: string }
export type PersonalConnection = { providerId: string; protocol: ProviderProtocol; modelId: string }
export type ModelProvider = {
  id: string
  name: string
  baseUrl: string
  protocol: ProviderProtocol
  models: ProviderModel[]
}
export type ProviderDraft = Omit<ModelProvider, 'id'> & { apiKey: string }

export const providerPresets = [
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', protocol: 'openai' },
  { name: 'Claude（Anthropic）', baseUrl: 'https://api.anthropic.com/v1', protocol: 'anthropic' },
  { name: 'Gemini（Google AI Studio）', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', protocol: 'openai' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', protocol: 'openai' },
  { name: 'Kimi（月之暗面）', baseUrl: 'https://api.moonshot.cn/v1', protocol: 'openai' },
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', protocol: 'openai' },
] satisfies Array<Pick<ModelProvider, 'name' | 'baseUrl' | 'protocol'>>

export function personalModels(providers: ModelProvider[]): PublicModel[] {
  return providers.flatMap((provider) => provider.models.map((model) => ({
    id: `personal:${provider.id}:${model.id}`,
    label: `${model.label} · ${provider.name}`,
    gateway: false,
    connection: { providerId: provider.id, protocol: provider.protocol, modelId: model.id },
  })))
}

export function preferredModel(models: PublicModel[], saved: unknown) {
  return models.find((item) => item.id === saved)
    ?? (models.some((item) => item.connection) || (typeof saved === 'string' && saved.startsWith('personal:')) ? undefined : models[0])
}

async function providerRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch('/api/providers' + path, {
    method,
    headers: { 'X-PB-Token': authToken(), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || data === null) throw new Error(data?.error || '个人供应商服务暂不可用')
  return data as T
}

export async function fetchProviders() {
  const items = await providerRequest<ModelProvider[]>('')
  if (!Array.isArray(items)) throw new Error('无法读取个人供应商列表')
  return items
}
export const discoverModels = (draft: Pick<ProviderDraft, 'apiKey' | 'baseUrl' | 'protocol'> & { id?: string }) =>
  providerRequest<ProviderModel[]>('/discover', 'POST', draft)
export const saveProvider = (draft: ProviderDraft, id?: string) =>
  providerRequest<ModelProvider>(id ? '/' + id : '', id ? 'PUT' : 'POST', draft)
export const removeProvider = (id: string) => providerRequest('/' + id, 'DELETE')
export const testPersonalModel = (connection: PersonalConnection) =>
  providerRequest<{ ok: boolean; latencyMs: number; error?: string }>('/' + connection.providerId + '/test', 'POST', { model: connection.modelId })

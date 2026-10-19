export function parseModels(env) {
  const raw = String(env.LLM_MODELS || '').trim()
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        const models = parsed.map(normalizeModel).filter(Boolean)
        if (models.length) return models
      }
    } catch {
      return []
    }
  }
  const baseUrl = String(env.LLM_BASE_URL || '').trim()
  const apiKey = String(env.LLM_API_KEY || '').trim()
  const id = String(env.LLM_MODEL || '').trim()
  if (!baseUrl || !apiKey || !id) return []
  return [{ id, label: id, baseUrl, apiKey, gateway: false }]
}

function normalizeModel(item) {
  if (!item || typeof item !== 'object') return null
  const id = String(item.id || '').trim()
  const baseUrl = String(item.baseUrl || '').trim()
  const apiKey = String(item.apiKey || '').trim()
  if (!id || !baseUrl || !apiKey) return null
  return {
    id,
    label: String(item.label || id).trim() || id,
    baseUrl: baseUrl.replace(/\/$/, ''),
    apiKey,
    gateway: Boolean(item.gateway),
  }
}

export function publicModels(env) {
  return parseModels(env).map((item) => ({ id: item.id, label: item.label, gateway: item.gateway }))
}

export function gatewayModels(env) {
  return parseModels(env)
    .filter((item) => item.gateway)
    .map((item) => ({ id: item.id, label: item.label, endpoint: item.baseUrl }))
}

export function resolveModel(env, requested) {
  const models = parseModels(env)
  if (!models.length) return null
  return models.find((item) => item.id === requested) || models[0]
}

export function statusBody(env) {
  const models = parseModels(env)
  return {
    configured: models.length > 0,
    model: models[0]?.id || '',
  }
}

const cache = { token: '', exp: 0, base: '', email: '' }

function pbUrl(env) {
  return String(env.PB_URL || '').trim().replace(/\/$/, '')
}

export async function superuserToken(env) {
  const base = pbUrl(env)
  const email = String(env.PB_SUPERUSER_EMAIL || '').trim()
  const password = String(env.PB_SUPERUSER_PASSWORD || '').trim()
  if (cache.base === base && cache.email === email && cache.token && cache.exp > Date.now() + 60_000) return cache.token
  if (!base || !email || !password) return ''
  const response = await fetch(`${base}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identity: email, password }),
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) {
    cache.token = ''
    cache.exp = 0
    return ''
  }
  const data = await response.json()
  cache.base = base
  cache.email = email
  cache.token = String(data.token || '')
  cache.exp = Date.now() + 6 * 60 * 60 * 1000
  return cache.token
}

export async function verifyUser(env, token) {
  const userToken = String(token || '').trim()
  if (!userToken) return null
  try {
    const superToken = await superuserToken(env)
    const base = pbUrl(env)
    if (!superToken || !base) return null
    const response = await fetch(`${base}/api/internal/verify-auth`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: superToken,
      },
      body: JSON.stringify({ token: userToken }),
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return null
    const data = await response.json()
    if (!data.valid || !data.id) return null
    return { id: String(data.id) }
  } catch {
    return null
  }
}

export async function recordUsage(env, event) {
  if (!event?.owner) return false
  try {
    const superToken = await superuserToken(env)
    const base = pbUrl(env)
    if (!superToken || !base) return false
    const response = await fetch(`${base}/api/collections/usage_events/records`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: superToken,
      },
      body: JSON.stringify({
        owner: event.owner,
        model: event.model,
        gateway: Boolean(event.gateway),
        tokensKnown: Boolean(event.tokensKnown),
        promptTokens: Number(event.promptTokens) || 0,
        completionTokens: Number(event.completionTokens) || 0,
      }),
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) console.warn('usage_write_failed', response.status)
    return response.ok
  } catch {
    console.warn('usage_write_failed', 'network')
    return false
  }
}

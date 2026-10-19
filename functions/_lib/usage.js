const cache = { token: '', exp: 0 }

function pbUrl(env) {
  return String(env.PB_URL || '').trim().replace(/\/$/, '')
}

export async function superuserToken(env) {
  if (cache.token && cache.exp > Date.now() + 60_000) return cache.token
  const base = pbUrl(env)
  const email = String(env.PB_SUPERUSER_EMAIL || '').trim()
  const password = String(env.PB_SUPERUSER_PASSWORD || '').trim()
  if (!base || !email || !password) return ''
  const response = await fetch(`${base}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identity: email, password }),
  })
  if (!response.ok) {
    cache.token = ''
    cache.exp = 0
    return ''
  }
  const data = await response.json()
  cache.token = String(data.token || '')
  cache.exp = Date.now() + 6 * 60 * 60 * 1000
  return cache.token
}

export async function verifyUser(env, token) {
  const userToken = String(token || '').trim()
  if (!userToken) return null
  const superToken = await superuserToken(env)
  const base = pbUrl(env)
  if (!superToken || !base) return null
  try {
    const response = await fetch(`${base}/api/internal/verify-auth`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: superToken,
      },
      body: JSON.stringify({ token: userToken }),
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
  if (!event?.owner) return
  try {
    const superToken = await superuserToken(env)
    const base = pbUrl(env)
    if (!superToken || !base) return
    await fetch(`${base}/api/collections/usage_events/records`, {
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
    })
  } catch {
    // 记用量失败不影响这次作图响应。
  }
}

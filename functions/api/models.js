import { envOf, modelsResponse } from '../_lib/llm.js'

export async function onRequest(context) {
  if (context.request.method !== 'GET') {
    return new Response(JSON.stringify({ error: '只支持 GET' }), { status: 405 })
  }
  return modelsResponse(envOf(context))
}

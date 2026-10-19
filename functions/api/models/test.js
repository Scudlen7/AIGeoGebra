import { envOf, testModel } from '../../_lib/llm.js'

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return new Response(JSON.stringify({ error: '只支持 POST' }), { status: 405 })
  }
  return testModel(context.request, envOf(context))
}

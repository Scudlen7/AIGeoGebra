import { envOf, proxyLlm } from '../_lib/llm.js'

export async function onRequest(context) {
  return proxyLlm(context.request, envOf(context))
}

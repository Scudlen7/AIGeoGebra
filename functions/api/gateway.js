import { envOf, gatewayResponse } from '../_lib/llm.js'

export async function onRequest(context) {
  return gatewayResponse(envOf(context))
}

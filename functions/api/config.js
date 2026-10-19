import { configResponse, envOf } from '../_lib/llm.js'

export async function onRequest(context) {
  return configResponse(envOf(context))
}

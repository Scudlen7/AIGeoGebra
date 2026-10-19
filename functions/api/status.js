import { envOf, statusResponse } from '../_lib/llm.js'

export async function onRequest(context) {
  return statusResponse(envOf(context))
}

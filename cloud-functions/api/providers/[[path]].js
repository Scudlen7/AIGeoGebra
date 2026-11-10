import { providersRequest } from '../../../server/model-providers.js'

export function onRequest(context) {
  return providersRequest(context.request, context.env)
}

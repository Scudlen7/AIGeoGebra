import PocketBase, { type RecordModel } from 'pocketbase'
import { createSignal } from 'solid-js'

export const pb = new PocketBase(window.location.origin)

const [authUser, setAuthUser] = createSignal<RecordModel | null>(null)
export { authUser }

export function initPb(url: string) {
  pb.baseURL = url
  pb.autoCancellation(false)
  setAuthUser(pb.authStore.isValid ? pb.authStore.record : null)
  pb.authStore.onChange(() => {
    setAuthUser(pb.authStore.isValid ? pb.authStore.record : null)
  })
}

export function loggedIn() {
  return Boolean(authUser() && pb.authStore.isValid)
}

export function authToken() {
  return pb.authStore.isValid ? pb.authStore.token : ''
}

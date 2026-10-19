import PocketBase, { type RecordModel } from 'pocketbase'
import { createSignal } from 'solid-js'

export let pb = new PocketBase('http://127.0.0.1:8090')

const [authUser, setAuthUser] = createSignal<RecordModel | null>(pb.authStore.record)
export { authUser }

export function initPb(url: string) {
  const base = url.trim() || 'http://127.0.0.1:8090'
  pb = new PocketBase(base)
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

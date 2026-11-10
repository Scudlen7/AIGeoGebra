import { lookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP } from 'node:net'
import { Readable } from 'node:stream'

const nonPublic = new BlockList()
for (const [prefix, length] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 3], ['168.63.129.16', 32],
]) nonPublic.addSubnet(prefix, length)

export class ProviderError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function providerBaseUrl(input) {
  let url
  try { url = new URL(input) } catch { throw new ProviderError(400, '请填写有效的 HTTPS API 地址') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port) {
    throw new ProviderError(400, 'API 地址须使用标准 HTTPS 端口，且不含账号、查询参数或片段')
  }
  if (isIP(url.hostname) || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(url.hostname)) {
    throw new ProviderError(400, 'API 地址须使用公网域名')
  }
  const path = url.pathname.replace(/\/+$/, '')
  return url.origin + path
}

export async function resolvePublicAddress(target, resolve = lookup) {
  let address
  try { ({ address } = await resolve(target.hostname, { family: 4 })) } catch {
    throw new ProviderError(422, '无法解析供应商的公网地址')
  }
  if (isIP(address) !== 4 || nonPublic.check(address)) throw new ProviderError(400, '供应商地址必须指向公网')
  return address
}

export async function providerFetch(target, { method, headers, body, signal }) {
  const address = await resolvePublicAddress(target)
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const request = httpsRequest(target, {
      method,
      headers,
      signal,
      agent: false,
      family: 4,
      // Pin the validated address. TLS still verifies the provider hostname.
      lookup: (_name, options, callback) => options.all
        ? callback(null, [{ address, family: 4 }])
        : callback(null, address, 4),
    }, (response) => {
      const status = response.statusCode || 502
      const type = response.headers['content-type'] || ''
      const empty = status === 204 || status === 205 || status === 304
      if (empty) response.resume()
      resolve(new Response(empty ? null : Readable.toWeb(response), { status, headers: { 'content-type': type } }))
    })
    request.on('error', reject)
    request.end(body)
  })
}

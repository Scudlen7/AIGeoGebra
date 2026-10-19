import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import solid from 'vite-plugin-solid'
import { configResponse, gatewayResponse, modelsResponse, proxyLlm, statusResponse, testModel } from './functions/_lib/llm.js'

function readBody(req: IncomingMessage) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function writeWebResponse(res: ServerResponse, response: Response) {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    if (key === 'transfer-encoding' || key === 'content-encoding' || key === 'content-length') return
    res.setHeader(key, value)
  })
  if (!response.body) {
    res.end()
    return
  }
  const reader = response.body.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!res.write(Buffer.from(value))) {
      await new Promise((resolve) => res.once('drain', resolve))
    }
  }
  res.end()
}

function serverApi(env: Record<string, string>): Plugin {
  return {
    name: 'server-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1')
        const path = url.pathname
        const handled =
          path === '/api/status' ||
          path === '/api/config' ||
          path === '/api/models' ||
          path === '/api/models/test' ||
          path === '/api/gateway' ||
          path === '/llm' ||
          path.startsWith('/llm/')
        if (!handled) {
          next()
          return
        }
        try {
          const headers = new Headers()
          for (const [key, value] of Object.entries(req.headers)) {
            if (value == null) continue
            headers.set(key, Array.isArray(value) ? value.join(', ') : value)
          }
          const method = req.method || 'GET'
          const raw = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req)
          const request = new Request(`http://127.0.0.1${req.url}`, {
            method,
            headers,
            body: raw,
          })
          let response: Response
          if (path === '/api/status') response = statusResponse(env)
          else if (path === '/api/config') response = configResponse(env)
          else if (path === '/api/models' && method === 'GET') response = modelsResponse(env)
          else if (path === '/api/gateway') response = gatewayResponse(env)
          else if (path === '/api/models/test') response = await testModel(request, env)
          else response = await proxyLlm(request, env)
          await writeWebResponse(res, response)
        } catch (reason) {
          if (!res.headersSent) {
            res.statusCode = 500
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ error: reason instanceof Error ? reason.message : '服务暂时不可用' }))
          } else {
            res.end()
          }
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [solid(), serverApi(env)],
    server: {
      host: true,
      port: 5173,
    },
  }
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTs } from './load-ts.mjs'

test('a canceled turn cannot execute a late model tool call on the board', async () => {
  const state = { executions: 0 }
  globalThis.__chatTest = state
  globalThis.window = { location: { origin: 'http://localhost' } }
  const { runTurn } = await loadTs('src/chat.ts', { mocks: {
    '@ai-sdk/openai-compatible': 'export const createOpenAICompatible = () => ({ chatModel: () => ({}) })',
    ai: `
      export const tool = options => options
      export const stepCountIs = () => () => false
      export const streamText = options => {
        globalThis.__chatTest.execute = options.tools.applyCommands.execute
        return { fullStream: (async function* () {})(), text: Promise.resolve('') }
      }
    `,
    './board': `
      export const listObjects = () => []
      export const executeCommands = () => { globalThis.__chatTest.executions++; return { results: [], objects: [], hint: '' } }
    `,
    './pb': 'export const authToken = () => ""',
  } })
  const controller = new AbortController()
  await runTurn({ mode: 'geometry', model: 'test', messages: [], signal: controller.signal, onText() {}, onReport() {} })
  controller.abort()
  await assert.rejects(() => state.execute({ commands: ['A=(0,0)'] }), { name: 'AbortError' })
  assert.equal(state.executions, 0)
  delete globalThis.__chatTest
})

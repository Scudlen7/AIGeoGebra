import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTs } from './load-ts.mjs'

async function chatFixture(replies) {
  const state = { requests: [], executions: [], texts: [], reports: [] }
  globalThis.__chatFixture = state
  globalThis.window = { location: { origin: 'http://localhost' } }
  const original = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    state.requests.push(JSON.parse(init.body))
    const reply = replies.shift()
    assert.ok(reply, 'unexpected extra model request')
    const deltas = reply.commands
      ? [{ tool_calls: [{ index: 0, id: `call_${state.requests.length}`, type: 'function', function: { name: 'applyCommands', arguments: JSON.stringify({ commands: reply.commands }) } }] }]
      : (reply.chunks || [reply.text]).map(content => ({ content }))
    const events = deltas.map(delta => ({ id: 'test', created: 1, model: 'test', choices: [{ index: 0, delta, finish_reason: null }] }))
    events.push({ id: 'test', created: 1, model: 'test', choices: [{ index: 0, delta: {}, finish_reason: reply.commands ? 'tool_calls' : 'stop' }] })
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
  }
  const { runTurn } = await loadTs('src/chat.ts', { mocks: {
    './pb': 'export const authToken = () => ""',
    './board': `export const listObjects = () => [{ name: 'A', type: 'point', definition: '(0,0)' }]
      export const executeCommands = commands => {
        globalThis.__chatFixture.executions.push(commands)
        return { results: commands.map(command => ({ command, status: 'ok', labels: [], error: null })), objects: [], hint: '' }
      }`,
  } })
  try {
    state.answer = await runTurn({ mode: 'geometry', model: 'test', messages: [{ role: 'user', content: '继续作图' }], signal: new AbortController().signal,
      onText: text => state.texts.push(text), onReport: report => state.reports.push(report) })
    return state
  } finally { globalThis.fetch = original }
}

test('the model can clarify a contradictory request without changing the board', async () => {
  const state = await chatFixture([{ text: '锐角三角形的外心在内部，请确认是否改为钝角三角形。' }])
  assert.equal(state.requests[0].tool_choice, 'auto')
  assert.match(state.requests[0].messages[0].content, /锐角三角形且外心在外部/)
  assert.equal(state.executions.length, 0)
  assert.match(state.answer, /请确认/)
})

test('successful commands do not disable subsequent corrections', async () => {
  const state = await chatFixture([{ commands: ['B=(4,0)'] }, { commands: ['C=(1,3)'] }, { text: '三角形已完成。' }])
  assert.deepEqual(state.executions, [['B=(4,0)'], ['C=(1,3)']])
  assert.equal(state.requests[1].tool_choice, 'auto')
  assert.equal(state.answer, '三角形已完成。')
})

test('split DSML is hidden and retried as a real tool call without repeating earlier commands', async () => {
  const state = await chatFixture([{ commands: ['B=(4,0)'] },
    { chunks: ['需要调整。<', '｜｜DS', 'ML｜｜ invoke name="applyCommands">Delete(A)</｜｜DSML｜｜ invoke>'] },
    { commands: ['C=(1,3)'] }, { text: '调整已完成。' }])
  assert.deepEqual(state.executions, [['B=(4,0)'], ['C=(1,3)']])
  assert.ok(state.texts.every(text => !/DSML|Delete\(A\)|<｜/.test(text)))
  assert.ok(state.requests[2].messages.some(message => message.role === 'tool'))
  assert.equal(state.answer, '调整已完成。')
})

test('repeated invalid tool markup fails clearly and is never executed', async () => {
  await assert.rejects(() => chatFixture([{ text: '<｜｜DSML｜｜ calls>Delete(A)' }, { text: '<tool_call>Delete(A)</tool_call>' }]), /未能返回有效的工具调用/)
  assert.equal(globalThis.__chatFixture.executions.length, 0)
})

test('legacy protocol markup is replaced by a readable notice without damaging ordinary math', async () => {
  const { assistantText } = await loadTs('src/assistant-text.ts')
  const visible = assistantText('准备调整。<｜｜DSML｜｜ calls>Delete(A)</｜｜DSML｜｜ calls>')
  assert.match(visible, /这部分操作未执行/)
  assert.doesNotMatch(visible, /DSML|Delete/)
  assert.equal(assistantText('当 $x < 3$ 时。'), '当 $x < 3$ 时。')
})

test('an empty response cannot claim that construction succeeded', async () => {
  await assert.rejects(() => chatFixture([{ text: '' }]), /本轮未执行作图/)
})

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
        return { fullStream: (async function* () {})(), text: Promise.resolve('请补充要求。') }
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

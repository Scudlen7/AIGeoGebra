import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { stepCountIs, streamText, tool, type ModelMessage } from 'ai'
import { z } from 'zod'
import { executeCommands, listObjects } from './board'
import { authToken } from './pb'
import { systemPrompt } from './prompt'
import { assistantText, toolMarkupStart } from './assistant-text'
import type { PersonalConnection } from './providers'
import type { AngleUnit, CalculatorMode, ChatTurn, CommandResult, ConstructionReport, LlmStatus } from './types'

export async function fetchLlmStatus(): Promise<LlmStatus> {
  const response = await fetch('/api/status')
  if (!response.ok) return { configured: false, model: '' }
  return response.json() as Promise<LlmStatus>
}

export async function runTurn(options: {
  mode: CalculatorMode
  angleUnit?: AngleUnit
  model: string
  connection?: PersonalConnection
  messages: ChatTurn[]
  onText: (text: string) => void
  onReport: (report: ConstructionReport) => void
  signal: AbortSignal
}) {
  const token = authToken()
  const modelId = options.connection?.modelId || options.model
  const path = options.connection ? '/api/providers/' + encodeURIComponent(options.connection.providerId) : '/llm'
  const baseURL = window.location.origin + path
  const isClaude = options.connection?.protocol === 'anthropic'
  const model = isClaude
    ? (await import('@ai-sdk/anthropic')).createAnthropic({ apiKey: 'proxy', baseURL }).chat(modelId)
    : createOpenAICompatible({
        name: 'llm',
        baseURL,
        apiKey: 'proxy',
        includeUsage: false,
        transformRequestBody: (body) => {
          // Use non-thinking mode for structured tool calls with this model family.
          return /deepseek-(flash|reasoner|v\d)/i.test(modelId) ? { ...body, thinking: { type: 'disabled' } } : body
        },
      }).chatModel(modelId)
  options.signal.throwIfAborted()

  let messages: ModelMessage[] = options.messages.map((message) => ({ ...message,
    content: message.role === 'assistant' ? assistantText(message.content) : message.content,
  }))
  let calls = 0
  let toolError = ''
  let latestReport: ConstructionReport | undefined
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let text = ''
    let invalidText = false
    const result = streamText({
      model,
      providerOptions: isClaude ? { anthropic: { thinking: { type: 'disabled' } } } : undefined,
      system: systemPrompt(options.mode, listObjects(), options.angleUnit ?? 'degree'),
      messages,
      abortSignal: options.signal,
      headers: token ? { 'X-PB-Token': token } : undefined,
      maxRetries: 1,
      stopWhen: stepCountIs(6),
      // Let the model clarify contradictory requirements, or correct a valid but wrong drawing.
      toolChoice: 'auto',
      tools: {
        applyCommands: tool({
          description:
            options.mode === '3d'
              ? '在当前 3D 计算器上按顺序执行英文命令。点使用三个坐标。遇到第一条失败会停止。修复时不要重复已成功的命令。'
              : options.mode === 'scientific'
                ? '在科学计算器中按顺序执行赋值算式，例如 a = sin(30°)。遇到第一条失败会停止。修复时不要重复已成功的算式。'
                : options.mode === 'probability'
                  ? '在概率计算器中按顺序执行分布命令，例如 p = Normal(0, 1, 1.96, true)。成功后分布菜单和曲线会一起更新。遇到第一条失败会停止。修复时不要重复已成功的命令。'
                  : '在当前 GeoGebra 画板上按顺序执行英文命令。遇到第一条失败会停止。修复时不要重复已成功的命令。',
          inputSchema: z.object({
            commands: z
              .array(z.string().min(1))
              .min(1)
              .max(24)
              .describe('有序的 GeoGebra 输入栏命令，英文命令名，一条命令一个字符串'),
          }),
          execute: async ({ commands }) => {
            options.signal.throwIfAborted()
            if (++calls > 5) throw new Error('本轮作图调整次数已达上限，请检查画板后补充要求。')
            const report = executeCommands(commands, options.mode, {
              angleUnit: options.angleUnit,
              enforceAngle: true,
            })
            options.onReport(report)
            latestReport = report
            toolError = ''
            return report
          },
        }),
      },
    })

    for await (const part of result.fullStream) {
      options.signal.throwIfAborted()
      if (part.type === 'start-step') {
        text = ''
        options.onText('')
      } else if (part.type === 'text-delta') {
        text += part.text
        invalidText ||= toolMarkupStart(text) >= 0
        options.onText(assistantText(text, true))
      } else if (part.type === 'error') {
        throw part.error instanceof Error ? part.error : new Error('模型请求失败')
      } else if (part.type === 'tool-error') {
        toolError = '工具调用未能完成，请检查命令记录或重试。'
      }
    }

    const finalText = (await result.text).trim() || text.trim()
    if (invalidText || toolMarkupStart(finalText) >= 0) {
      options.onText('')
      if (attempt === 1) throw new Error('模型未能返回有效的工具调用，请重试或切换模型。已执行的步骤保留在画板和命令记录中。')
      // Preserve actual tool results so a retry does not repeat successful mutations.
      const response = await result.response
      messages = [...messages, ...response.messages.map((message) => message.role === 'assistant' && Array.isArray(message.content)
        ? { ...message, content: message.content.filter((part) => part.type !== 'text') } : message),
        { role: 'user', content: '上一条回复包含无效的工具标记。不要输出 DSML/XML 或模拟工具调用。需要调整图形时请使用真正的 applyCommands 工具；已有成功操作不要重复。条件矛盾时先解释并提问。' }]
      continue
    }
    if (toolError) throw new Error(toolError)
    if (hasFailure(latestReport ?? null)) return `${finalText}\n\n部分命令未成功，作图尚未完成，请查看命令记录。`.trim()
    if (!finalText && calls) return '已执行部分作图步骤，请检查画板和命令记录；本轮未收到最终说明。'
    if (!finalText) throw new Error('模型未返回有效回复，本轮未执行作图，请重试。')
    return finalText
  }
  return ''
}

export function hasFailure(report: ConstructionReport | null) {
  return report?.results.some((item: CommandResult) => item.status === 'failed') ?? false
}

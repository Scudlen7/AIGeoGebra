import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { stepCountIs, streamText, tool } from 'ai'
import { z } from 'zod'
import { executeCommands, listObjects } from './board'
import { authToken } from './pb'
import { systemPrompt } from './prompt'
import type { AngleUnit, CalculatorMode, ChatTurn, CommandResult, ConstructionReport, LlmStatus } from './types'

export async function fetchLlmStatus(): Promise<LlmStatus> {
  const response = await fetch('/api/status')
  if (!response.ok) return { configured: false, model: '' }
  return response.json() as Promise<LlmStatus>
}

type StepLike = {
  toolResults?: Array<{ output?: unknown; result?: unknown }>
}

function reportOf(result: { output?: unknown; result?: unknown }) {
  const output = (result.output ?? result.result) as ConstructionReport | undefined
  if (!output || !Array.isArray(output.results)) return undefined
  return output
}

function stepFailed(steps: StepLike[]) {
  return steps.some((step) =>
    (step.toolResults ?? []).some((result) => reportOf(result)?.results.some((item) => item.status === 'failed')),
  )
}

function toolCallCount(steps: StepLike[]) {
  return steps.filter((step) => (step.toolResults?.length ?? 0) > 0).length
}

export async function runTurn(options: {
  mode: CalculatorMode
  angleUnit?: AngleUnit
  model: string
  messages: ChatTurn[]
  onText: (text: string) => void
  onReport: (report: ConstructionReport) => void
  signal: AbortSignal
}) {
  const provider = createOpenAICompatible({
    name: 'llm',
    baseURL: `${window.location.origin}/llm`,
    apiKey: 'proxy',
    includeUsage: false,
    transformRequestBody: (body) => {
      // deepseek-flash 默认开启思考模式，该模式拒绝指定具体工具。
      // 作图必须调用 applyCommands，因此对这类模型关闭思考。
      if (/deepseek-(flash|reasoner|v\d)/i.test(options.model)) {
        return { ...body, thinking: { type: 'disabled' } }
      }
      return body
    },
  })

  let text = ''
  const result = streamText({
    model: provider.chatModel(options.model),
    system: systemPrompt(options.mode, listObjects(), options.angleUnit ?? 'degree'),
    messages: options.messages,
    abortSignal: options.signal,
    headers: authToken() ? { 'X-PB-Token': authToken() } : undefined,
    maxRetries: 1,
    stopWhen: stepCountIs(3),
    prepareStep: ({ stepNumber, steps }) => {
      const forceTool = stepNumber === 0 || (stepFailed(steps as StepLike[]) && toolCallCount(steps as StepLike[]) < 2)
      if (forceTool) return { toolChoice: { type: 'tool' as const, toolName: 'applyCommands' } }
      return { toolChoice: 'none' as const }
    },
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
          const report = executeCommands(commands, options.mode, {
            angleUnit: options.angleUnit,
            enforceAngle: true,
          })
          options.onReport(report)
          return report
        },
      }),
    },
  })

  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') {
      text += part.text
      options.onText(text)
    } else if (part.type === 'error') {
      throw part.error instanceof Error ? part.error : new Error('模型请求失败')
    }
  }

  const finalText = (await result.text).trim()
  return finalText || text.trim()
}

export function hasFailure(report: ConstructionReport | null) {
  return report?.results.some((item: CommandResult) => item.status === 'failed') ?? false
}

export type CommandStatus = 'ok' | 'failed' | 'skipped'

export type CommandResult = {
  command: string
  status: CommandStatus
  labels: string[]
  error: string | null
  value?: string | null
}

export type GgbObject = {
  name: string
  type: string
  definition: string
}

export type ConstructionReport = {
  results: CommandResult[]
  objects: GgbObject[]
  hint: string
}

export type ChatTurn = {
  role: 'user' | 'assistant'
  content: string
}

export type LlmStatus = {
  configured: boolean
  model: string
}

export type CalculatorMode = 'geometry' | '3d' | 'probability' | 'scientific'

export type AngleUnit = 'degree' | 'radian'

export type ModeSession = {
  messages: ChatTurn[]
  input: string
  report: ConstructionReport | null
}

export type SessionMap = Record<CalculatorMode, ModeSession>

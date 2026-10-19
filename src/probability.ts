type DistributionSpec = {
  type: number
  count: number
}

const specs: Record<string, DistributionSpec> = {
  Normal: { type: 0, count: 2 },
  InverseNormal: { type: 0, count: 2 },
  TDistribution: { type: 1, count: 1 },
  InverseTDistribution: { type: 1, count: 1 },
  ChiSquared: { type: 2, count: 1 },
  InverseChiSquared: { type: 2, count: 1 },
  FDistribution: { type: 3, count: 2 },
  InverseFDistribution: { type: 3, count: 2 },
  Cauchy: { type: 4, count: 2 },
  InverseCauchy: { type: 4, count: 2 },
  Exponential: { type: 5, count: 1 },
  InverseExponential: { type: 5, count: 1 },
  BetaDist: { type: 6, count: 2 },
  InverseBeta: { type: 6, count: 2 },
  Gamma: { type: 7, count: 2 },
  InverseGamma: { type: 7, count: 2 },
  Weibull: { type: 8, count: 2 },
  InverseWeibull: { type: 8, count: 2 },
  Logistic: { type: 9, count: 2 },
  InverseLogistic: { type: 9, count: 2 },
  LogNormal: { type: 10, count: 2 },
  InverseLogNormal: { type: 10, count: 2 },
  BinomialDist: { type: 11, count: 2 },
  InverseBinomial: { type: 11, count: 2 },
  Pascal: { type: 12, count: 2 },
  InversePascal: { type: 12, count: 2 },
  HyperGeometric: { type: 13, count: 3 },
  InverseHyperGeometric: { type: 13, count: 3 },
  Poisson: { type: 14, count: 1 },
  InversePoisson: { type: 14, count: 1 },
}

const callPattern = new RegExp(`\\b(${Object.keys(specs).join('|')})\\s*\\(`, 'g')

export type ProbabilitySelection = {
  type: number
  parameters: string
  cumulative: boolean
  interval: { mode: string; low: string; high: string } | null
}

function topLevelParts(value: string) {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character === '(') depth += 1
    else if (character === ')') depth -= 1
    else if (character === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim())
      start = index + 1
    }
  }
  parts.push(value.slice(start).trim())
  return parts.filter(Boolean)
}

function readCall(command: string, openIndex: number) {
  let depth = 1
  for (let index = openIndex; index < command.length; index += 1) {
    if (command[index] === '(') depth += 1
    if (command[index] === ')') depth -= 1
    if (depth === 0) return command.slice(openIndex, index)
  }
  return null
}

function selectionFrom(command: string): ProbabilitySelection | null {
  let found: { name: string; args: string; index: number } | null = null
  for (const match of command.matchAll(callPattern)) {
    const args = readCall(command, (match.index ?? 0) + match[0].length)
    if (args == null) continue
    found = { name: match[1], args, index: match.index ?? 0 }
  }
  if (!found) return null
  const spec = specs[found.name]
  const numbers: string[] = []
  let cumulative: boolean | null = null
  for (const part of topLevelParts(found.args)) {
    if (part === 'true' || part === 'false') {
      cumulative = part === 'true'
      continue
    }
    if (part === 'x') continue
    if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(part)) return null
    numbers.push(part)
  }
  if (numbers.length < spec.count) return null
  const parameters = numbers.slice(0, spec.count)
  const extra = numbers.slice(spec.count)
  const inverse = found.name.startsWith('Inverse')
  const prefix = command.slice(0, found.index).replace(/\s+/g, '')
  const complemented = prefix.endsWith('1-')
  let interval: ProbabilitySelection['interval'] = null
  if (!inverse && extra.length === 2 && cumulative == null) {
    interval = { mode: '0', low: extra[0], high: extra[1] }
  } else if (!inverse && extra.length === 1 && cumulative === false) {
    interval = { mode: '0', low: extra[0], high: extra[0] }
  } else if (!inverse && extra.length === 1 && cumulative === true) {
    interval = complemented
      ? { mode: '2', low: extra[0], high: extra[0] }
      : { mode: '1', low: extra[0], high: extra[0] }
  }
  return {
    type: spec.type,
    parameters: parameters.join(','),
    cumulative: cumulative === true && !complemented,
    interval,
  }
}

export function probabilitySelection(commands: string[]): ProbabilitySelection | null {
  let fallback: ProbabilitySelection | null = null
  for (let index = commands.length - 1; index >= 0; index -= 1) {
    const selection = selectionFrom(commands[index])
    if (!selection) continue
    if (selection.interval) return selection
    if (!fallback) fallback = selection
  }
  return fallback
}

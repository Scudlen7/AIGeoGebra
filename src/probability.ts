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
  return parts
}

type ValueResolver = (name: string) => number | null | undefined

// Parse only numeric arithmetic. Never evaluate model text as JavaScript or as a new board command.
function numericValue(expression: string, resolveValue?: ValueResolver): number | null {
  let index = 0
  let depth = 0
  const skip = () => { while (/\s/.test(expression[index] ?? '') && index < expression.length) index += 1 }
  const take = (symbol: string) => {
    skip()
    if (expression[index] !== symbol) return false
    index += 1
    return true
  }
  function primary(): number {
    skip()
    if (++depth > 64) throw new Error('Expression too deep')
    let value: number
    if (take('(')) {
      value = sum()
      if (!take(')')) throw new Error('Unmatched bracket')
    } else {
      const number = expression.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/)
      const name = expression.slice(index).match(/^[A-Za-z][A-Za-z0-9_]*/)
      if (number) {
        index += number[0].length
        value = Number(number[0])
      } else if (name) {
        index += name[0].length
        value = name[0] === 'pi' ? Math.PI : name[0] === 'e' ? Math.E : resolveValue?.(name[0]) ?? NaN
      } else throw new Error('Not a number')
    }
    depth -= 1
    return value
  }
  function unary(): number {
    if (take('+')) return unary()
    if (take('-')) return -unary()
    const value = primary()
    return take('^') ? value ** unary() : value
  }
  function product(): number {
    let value = unary()
    while (true) {
      if (take('*')) value *= unary()
      else if (take('/')) value /= unary()
      else return value
    }
  }
  function sum(): number {
    let value = product()
    while (true) {
      if (take('+')) value += product()
      else if (take('-')) value -= product()
      else return value
    }
  }
  try {
    const value = sum()
    skip()
    return index === expression.length && Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

function closingBracket(expression: string, open: number) {
  let depth = 0
  for (let index = open; index < expression.length; index += 1) {
    if (expression[index] === '(') depth += 1
    if (expression[index] === ')' && --depth === 0) return index
  }
  return -1
}

function unwrapped(expression: string) {
  let value = expression.trim()
  while (value.startsWith('(') && closingBracket(value, 0) === value.length - 1) value = value.slice(1, -1).trim()
  return value
}

function distributionCall(expression: string, resolveValue?: ValueResolver) {
  const value = unwrapped(expression)
  const match = value.match(/^([A-Za-z][A-Za-z0-9_]*)\s*\(/)
  if (!match || !Object.hasOwn(specs, match[1])) return null
  const open = match[0].length - 1
  if (closingBracket(value, open) !== value.length - 1) return null
  const spec = specs[match[1]]
  const parts = topLevelParts(value.slice(open + 1, -1))
  const last = parts.at(-1)
  const cumulative = last === 'true' ? true : last === 'false' ? false : null
  if (cumulative != null) parts.pop()
  const parameters = parts.slice(0, spec.count).map((part) => numericValue(part, resolveValue))
  if (parameters.length !== spec.count || parameters.some((part) => part == null)) return null
  const extra = parts.slice(spec.count)
  const variable = extra.length === 1 && extra[0] === 'x'
  const values = variable ? [] : extra.map((part) => numericValue(part, resolveValue))
  if (values.some((part) => part == null) || values.length > 2) return null
  return {
    name: match[1], spec, parameters: parameters.join(','), cumulative,
    values: values as number[], variable,
    discrete: spec.type >= 11,
  }
}

function subtraction(expression: string) {
  let depth = 0
  for (let index = 0; index < expression.length; index += 1) {
    if (expression[index] === '(') depth += 1
    else if (expression[index] === ')') depth -= 1
    else if (expression[index] === '-' && depth === 0 && index > 0) {
      return [expression.slice(0, index), expression.slice(index + 1)]
    }
  }
  return null
}

function selectionFrom(command: string, resolveValue?: ValueResolver): ProbabilitySelection | null {
  const expression = unwrapped(command.replace(/^\s*[A-Za-z][A-Za-z0-9_]*(?:\s*\([^)]*\))?\s*=\s*/, ''))
  const difference = subtraction(expression)
  if (difference) {
    const right = distributionCall(difference[1], resolveValue)
    if (!right || right.name.startsWith('Inverse') || right.cumulative !== true || right.values.length !== 1) return null
    const left = distributionCall(difference[0], resolveValue)
    if (left) {
      if (left.name !== right.name || left.parameters !== right.parameters || left.cumulative !== true || left.values.length !== 1) return null
      const low = right.discrete ? Math.floor(right.values[0]) + 1 : right.values[0]
      const high = right.discrete ? Math.floor(left.values[0]) : left.values[0]
      if (low > high) return null
      return { type: right.spec.type, parameters: right.parameters, cumulative: false,
        interval: { mode: '0', low: String(low), high: String(high) } }
    }
    if (numericValue(difference[0]) !== 1) return null
    // GeoGebra's discrete right-tail UI includes its lower bound: 1 - F(k) starts at k + 1.
    const low = right.discrete ? Math.floor(right.values[0]) + 1 : right.values[0]
    return { type: right.spec.type, parameters: right.parameters, cumulative: false,
      interval: { mode: '2', low: String(low), high: String(low) } }
  }

  const call = distributionCall(expression, resolveValue)
  if (!call) return null
  let interval: ProbabilitySelection['interval'] = null
  if (!call.name.startsWith('Inverse')) {
    const [low, high] = call.values
    if (call.values.length === 2 && call.name === 'Normal' && call.cumulative == null && low <= high) {
      interval = { mode: '0', low: String(low), high: String(high) }
    } else if (call.values.length === 1 && call.cumulative === true) {
      interval = { mode: '1', low: String(low), high: String(low) }
    } else if (call.values.length === 1 && call.cumulative === false && call.discrete) {
      interval = { mode: '0', low: String(low), high: String(low) }
    }
  }
  return { type: call.spec.type, parameters: call.parameters, cumulative: call.cumulative === true, interval }
}

export function probabilitySelection(commands: string[], resolveValue?: ValueResolver): ProbabilitySelection | null {
  for (let index = commands.length - 1; index >= 0; index -= 1) {
    const selection = selectionFrom(commands[index], resolveValue)
    if (selection) return selection
  }
  return null
}

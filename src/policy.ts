import type { AngleUnit, CalculatorMode } from './types'

const threeDCommands = [
  'Segment',
  'Line',
  'Polygon',
  'Plane',
  'Sphere',
  'Prism',
  'Pyramid',
  'Cylinder',
  'Cone',
  'Intersect',
  'Midpoint',
]

const threeDCommandSet = new Set(threeDCommands)

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

function isSurface(command: string) {
  return /^\s*[A-Za-z][A-Za-z0-9_]*\s*\(\s*[A-Za-z][A-Za-z0-9_]*\s*,\s*[A-Za-z][A-Za-z0-9_]*\s*\)\s*[:=]/.test(command)
}

function pointParts(command: string) {
  const match = command.match(/^\s*[A-Za-z][A-Za-z0-9_]*\s*[:=]\s*\((.*)\)\s*$/)
  if (!match) return null
  return topLevelParts(match[1])
}

function callName(command: string) {
  const assigned = command.match(/^\s*[A-Za-z][A-Za-z0-9_]*\s*[:=]\s*([A-Za-z][A-Za-z0-9_]*)\s*\(/)
  if (assigned) return assigned[1]
  return command.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*\(/)?.[1] ?? null
}

function threeDProblem(command: string) {
  if (isSurface(command)) return null

  const point = pointParts(command)
  if (point) {
    if (point.length === 3) return null
    return '3D 点需要三个坐标，例如 A = (0, 0, 2)。'
  }

  const name = callName(command)
  if (name && threeDCommandSet.has(name)) return null
  return `3D 计算器只接受三个坐标的点、曲面 f(x, y) = ...，以及这些命令：${threeDCommands.join('、')}。`
}

const scientificFunctions = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'ln', 'log', 'exp', 'sqrt', 'abs', 'floor', 'ceil']
const scientificConstants = ['pi', 'e']
const scientificFunctionSet = new Set(scientificFunctions)
const scientificConstantSet = new Set(scientificConstants)
const scientificReserved = new Set([...scientificFunctions, ...scientificConstants])

function readCallArgument(expression: string, openIndex: number) {
  let depth = 1
  for (let index = openIndex; index < expression.length; index += 1) {
    const character = expression[index]
    if (character === '(') depth += 1
    if (character === ')') depth -= 1
    if (depth === 0) return expression.slice(openIndex, index)
  }
  return null
}

function angleProblem(expression: string, angleUnit: AngleUnit, known: Set<string>) {
  const pattern = /\b(sin|cos|tan)\s*\(/g
  for (const match of expression.matchAll(pattern)) {
    const start = (match.index ?? 0) + match[0].length
    const argument = readCallArgument(expression, start)
    if (argument == null) return '括号不匹配。'
    if (angleUnit === 'radian') {
      if (argument.includes('°')) return '弧度模式下不要写 °，例如 sin(pi/6)。'
      continue
    }
    const names = argument.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? []
    const usesKnown = names.some((name) => known.has(name))
    if (!argument.includes('°') && !usesKnown) return '角度模式下，sin、cos、tan 的角度要带 °，例如 sin(30°)。'
  }
  return null
}

function scientificExpressionProblem(expression: string, known: Set<string>) {
  let index = 0
  while (index < expression.length) {
    const character = expression[index]
    if (character === ' ' || character === '\t') {
      index += 1
      continue
    }
    if (character === '°' || '+-*/^!(),'.includes(character)) {
      index += 1
      continue
    }
    if (character >= '0' && character <= '9') {
      const number = expression.slice(index).match(/^\d+(\.\d+)?([eE][+-]?\d+)?/)
      if (!number) return '数字格式不正确。'
      index += number[0].length
      continue
    }
    if (/[A-Za-z]/.test(character)) {
      const name = expression.slice(index).match(/^[A-Za-z][A-Za-z0-9_]*/)?.[0]
      if (!name) return '名字格式不正确。'
      index += name.length
      if (scientificFunctionSet.has(name)) {
        const rest = expression.slice(index).trimStart()
        if (!rest.startsWith('(')) return `${name} 需要括号，例如 ${name}(...)。`
        continue
      }
      if (scientificConstantSet.has(name) || known.has(name)) continue
      return `表达式里的 ${name} 不能使用。可以用四则运算、^、!、括号，以及 ${scientificFunctions.join('、')}、pi、e。`
    }
    return `表达式里有不能使用的符号 ${character}。`
  }
  return null
}

function scientificProblem(command: string, known: Set<string>, angleUnit: AngleUnit, enforceAngle: boolean) {
  const match = command.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+)$/)
  if (!match) return '科学计算要写成赋值，例如 a = sin(30°) + log(100)。'
  const name = match[1]
  const expression = match[2].trim()
  if (scientificReserved.has(name)) return `不能用 ${name} 作为结果名字。`
  const expressionProblem = scientificExpressionProblem(expression, known)
  if (expressionProblem) return expressionProblem
  if (!enforceAngle) return null
  return angleProblem(expression, angleUnit, known)
}

const probabilityCommands = [
  'Normal',
  'TDistribution',
  'ChiSquared',
  'FDistribution',
  'Exponential',
  'Cauchy',
  'Weibull',
  'Gamma',
  'BetaDist',
  'LogNormal',
  'Logistic',
  'BinomialDist',
  'Pascal',
  'Poisson',
  'HyperGeometric',
  'InverseNormal',
  'InverseTDistribution',
  'InverseChiSquared',
  'InverseFDistribution',
  'InverseExponential',
  'InverseCauchy',
  'InverseWeibull',
  'InverseGamma',
  'InverseBeta',
  'InverseLogNormal',
  'InverseLogistic',
  'InverseBinomial',
  'InversePascal',
  'InversePoisson',
  'InverseHyperGeometric',
]

const probabilityCommandSet = new Set(probabilityCommands)
const probabilityWords = new Set(['true', 'false', 'x', 'pi', 'e'])

function probabilityExpressionProblem(expression: string, known: Set<string>) {
  let index = 0
  let usedDistribution = false
  let usedKnown = false
  while (index < expression.length) {
    const character = expression[index]
    if (character === ' ' || character === '\t') {
      index += 1
      continue
    }
    if ('+-*/^!(),.{}'.includes(character)) {
      index += 1
      continue
    }
    if (character >= '0' && character <= '9') {
      const number = expression.slice(index).match(/^\d+(\.\d+)?([eE][+-]?\d+)?/)
      if (!number) return '数字格式不正确。'
      index += number[0].length
      continue
    }
    if (/[A-Za-z]/.test(character)) {
      const name = expression.slice(index).match(/^[A-Za-z][A-Za-z0-9_]*/)?.[0]
      if (!name) return '名字格式不正确。'
      index += name.length
      if (probabilityCommandSet.has(name)) {
        usedDistribution = true
        const rest = expression.slice(index).trimStart()
        if (!rest.startsWith('(')) return `${name} 需要括号，例如 ${name}(...)。`
        continue
      }
      if (probabilityWords.has(name)) continue
      if (known.has(name)) {
        usedKnown = true
        continue
      }
      return `概率计算器不能使用 ${name}。请改用正态分布、t 分布、卡方分布、F 分布、指数分布、柯西分布、威布尔分布、伽马分布、Beta 分布、对数正态分布、逻辑斯蒂分布、二项分布、帕斯卡分布、泊松分布或超几何分布的命令。`
    }
    return `表达式里有不能使用的符号 ${character}。`
  }
  if (!usedDistribution && !usedKnown) return '请写出分布命令，例如 p = Normal(0, 1, 1.96, true)。'
  return null
}

function probabilityProblem(command: string, known: Set<string>) {
  const assigned = command.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*(?:\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\))?\s*=\s*(.+)$/)
  if (assigned) {
    const name = assigned[1]
    const expression = assigned[3].trim()
    if (name === 'x' && !assigned[2] && /^-?\d+(\.\d+)?$/.test(expression)) return null
    if (probabilityCommandSet.has(name) || probabilityWords.has(name)) return `不能用 ${name} 作为结果名字。`
    const locals = new Set(known)
    if (assigned[2]) locals.add(assigned[2])
    return probabilityExpressionProblem(assigned[3], locals)
  }
  const call = command.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*\(/)
  if (!call || !probabilityCommandSet.has(call[1])) {
    return '概率计算器只接受分布命令，例如 p = Normal(0, 1, 1.96, true) 或 BinomialDist(10, 0.5, false)。'
  }
  return probabilityExpressionProblem(command, known)
}

export function commandProblem(
  mode: CalculatorMode | undefined,
  command: string,
  options?: { angleUnit?: AngleUnit; known?: Set<string>; enforceAngle?: boolean },
) {
  if (mode === '3d') return threeDProblem(command)
  if (mode === 'scientific') {
    return scientificProblem(
      command,
      options?.known ?? new Set(),
      options?.angleUnit === 'radian' ? 'radian' : 'degree',
      options?.enforceAngle !== false,
    )
  }
  if (mode === 'probability') return probabilityProblem(command, options?.known ?? new Set())
  return null
}

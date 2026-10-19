import type { BoardOptions } from './board'
import type { CalculatorMode } from './types'

export type ModeDefinition = {
  id: CalculatorMode
  label: string
  ready: boolean
  eyebrow: string
  title: string
  lede: string
  placeholder: string
  empty: string
  examples: string[]
  applet?: BoardOptions
  submitLabel: string
  logLabel: string
}

export const modeList: ModeDefinition[] = [
  {
    id: 'geometry',
    label: '几何',
    ready: true,
    eyebrow: '几何',
    title: 'AI 几何画板',
    lede: '说一句话，生成 GeoGebra 命令，并在几何画板上执行。失败的命令会停下来，并自动再改一次。Ctrl+Enter 提交 · Esc 停止 · 每个模式分开保存。',
    placeholder: '例如：画一个等腰三角形，并标出底边上的中线',
    empty: '从上面的例子开始，或直接描述要画的图形。',
    examples: [
      '画三角形 ABC，A(0,0)、B(4,0)、C(1,3)，并作出 AB 边上的高',
      '画一个圆和圆外一点，过该点作圆的两条切线',
      '画出函数 f(x)=x^2-2 与直线 y=x，并标出交点',
      '画一个平行四边形，并作出它的两条对角线',
    ],
    applet: {
      appName: 'geometry',
      showToolBar: true,
      showAlgebraInput: true,
    },
    submitLabel: '作图',
    logLabel: '命令',
  },
  {
    id: '3d',
    label: '3D',
    ready: true,
    eyebrow: '3D',
    title: '3D 计算器',
    lede: '说一句话，生成空间作图命令，并在 3D 计算器里执行。可以旋转查看。失败的命令会停下来，并自动再改一次。',
    placeholder: '例如：画一个棱锥，底面在水平面上，顶点在上方',
    empty: '从上面的例子开始，或直接描述要画的空间图形。',
    examples: [
      '画棱锥 ABCD，底面 A(0,0,0)、B(3,0,0)、C(1,2,0)，顶点 D(1,1,3)',
      '画球心 O(0,0,0)、半径为 2 的球',
      '画平面 ABC，A(0,0,0)、B(2,0,0)、C(0,2,1)，以及直线 PQ，P(0,0,2)、Q(2,2,0)，并标出交点',
      '画出曲面 f(x, y) = x^2 + y^2',
    ],
    applet: {
      appName: '3d',
      showToolBar: true,
      showAlgebraInput: true,
    },
    submitLabel: '作图',
    logLabel: '命令',
  },
  {
    id: 'probability',
    label: '概率',
    ready: true,
    eyebrow: '概率',
    title: '概率计算器',
    lede: '说一句话，计算概率分布。失败的命令会停下来，并自动再改一次。',
    placeholder: '例如：标准正态分布，求小于 1.96 的概率',
    empty: '从上面的例子开始，或直接描述分布和要计算的概率。',
    examples: [
      '标准正态分布，求小于 1.96 的概率',
      '二项分布：10 次独立试验，每次成功概率 0.5，求恰好成功 6 次的概率',
      '泊松分布，平均次数为 3，求次数不超过 2 的概率',
      '画出自由度为 5 的卡方分布密度曲线',
    ],
    applet: {
      appName: 'classic',
      perspective: 'B',
      showToolBar: false,
      showAlgebraInput: false,
    },
    submitLabel: '计算',
    logLabel: '命令',
  },
  {
    id: 'scientific',
    label: '科学',
    ready: true,
    eyebrow: '科学计算',
    title: '科学计算器',
    lede: '说一句话，生成算式并求出结果。右上角可以切换角度和弧度。失败的算式会停下来，并自动再改一次。',
    placeholder: '例如：计算 30 度的正弦，再加上 log(100)',
    empty: '从上面的例子开始，或直接说出要计算的内容。',
    examples: [
      '计算 30 度的正弦，再加上 log(100)',
      '计算 5 的阶乘与根号 2 的和',
      '计算 2.5 乘以 10 的 3 次方，再乘以 3.2 乘以 10 的 -1 次方',
      '计算 e 的平方，再向下取整',
    ],
    applet: {
      appName: 'scientific',
      showToolBar: false,
      showAlgebraInput: false,
    },
    submitLabel: '计算',
    logLabel: '算式',
  },
]

const modeIds = new Set<string>(modeList.map((item) => item.id))

export function isCalculatorMode(value: unknown): value is CalculatorMode {
  return typeof value === 'string' && modeIds.has(value)
}

export function modeDefinition(id: CalculatorMode) {
  return modeList.find((item) => item.id === id) ?? modeList[0]
}

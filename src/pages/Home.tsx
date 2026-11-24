import { A, Navigate, useSearchParams } from '@solidjs/router'
import { For, Show, createMemo, createSignal } from 'solid-js'
import { Icon } from '../Icon'
import { workspacePath } from '../api'
import { modeList } from '../modes'
import { loggedIn } from '../pb'

const modeIntro = {
  geometry: { title: '平面几何', description: '构造点、线与圆，检验垂直、相切等位置关系。' },
  '3d': { title: '空间几何', description: '建立曲面与立体模型，旋转考察空间中的点、线与面。' },
  probability: { title: '概率分布', description: '计算分布的概率与分位数，观察概率区间。' },
  scientific: { title: '科学计算', description: '计算根式、对数与三角函数，按需切换角度或弧度。' },
  graphing: { title: '函数绘图', description: '绘制函数与方程的图像，比较曲线并确定交点。' },
  cas: { title: '符号计算', description: '求方程的精确解，并进行化简、求导与积分。' },
}

function CircleExample() {
  const [angle, setAngle] = createSignal(54)
  const center = { x: 280, y: 164 }
  const radius = 126
  const ax = center.x - radius
  const bx = center.x + radius
  const radians = () => angle() * Math.PI / 180
  const onCircle = (r: number, t: number) => ({ x: center.x + r * Math.cos(t), y: center.y - r * Math.sin(t) })
  const point = createMemo(() => onCircle(radius, radians()))
  const sector = createMemo(() => onCircle(33, radians()))
  const angleLabel = createMemo(() => onCircle(48, radians() / 2))
  const rightAngle = createMemo(() => {
    const { x, y } = point()
    const alongSide = (end: number) => {
      const length = Math.hypot(end - x, center.y - y)
      return { x: 12 * (end - x) / length, y: 12 * (center.y - y) / length }
    }
    const a = alongSide(ax)
    const b = alongSide(bx)
    return `M${x + a.x} ${y + a.y} L${x + a.x + b.x} ${y + a.y + b.y} L${x + b.x} ${y + b.y}`
  })

  return (
    <figure class="landing-preview" id="example" aria-labelledby="example-title">
      <figcaption>
        <h2 id="example-title">直径所对的圆周角</h2>
        <span class="landing-theorem">∠APB = 90°</span>
      </figcaption>
      <svg viewBox="0 0 560 322" role="img" aria-label="以 AB 为直径的圆。圆周点 P 与 A、B 构成直角三角形，直角在 P 点。">
        <defs>
          <pattern id="landing-grid" x="280" y="164" width="21" height="21" patternUnits="userSpaceOnUse">
            <path class="landing-plot-grid" d="M21 0H0V21" fill="none" />
          </pattern>
        </defs>
        <rect width="560" height="322" fill="url(#landing-grid)" />
        <path class="landing-plot-axes" d="M28 164H529m-7-4 7 4-7 4M280 305V20m-4 7 4-7 4 7" />
        <path class="landing-plot-guide" d={`M${ax} ${center.y} A${radius} ${radius} 0 0 0 ${bx} ${center.y}`} />
        <polygon class="landing-plot-fill" points={`${ax},${center.y} ${point().x},${point().y} ${bx},${center.y}`} />
        <path class="landing-plot-arc" pathLength="1" d={`M${ax} ${center.y} A${radius} ${radius} 0 0 1 ${bx} ${center.y}`} />
        <path class="landing-plot-segments" pathLength="1" d={`M${ax} ${center.y} L${point().x} ${point().y} L${bx} ${center.y} Z`} />
        <path class="landing-plot-guide" d={`M${center.x} ${center.y} L${point().x} ${point().y}`} />
        <path class="landing-plot-angle" d={`M${center.x + 33} ${center.y} A33 33 0 0 0 ${sector().x} ${sector().y} ${rightAngle()}`} />
        <g class="landing-plot-labels">
          <text x="536" y="169">x</text><text x="290" y="27">y</text>
          <text x={ax - 8} y={center.y + 22}>A</text><text x={bx - 7} y={center.y + 22}>B</text>
          <text x={center.x - 7} y={center.y + 22}>O</text>
          <text x={angleLabel().x} y={angleLabel().y + 5} text-anchor="middle">θ</text>
          <text x={point().x} y={point().y - 14} text-anchor="middle">P</text>
        </g>
        <g class="landing-plot-points">
          <circle cx={ax} cy={center.y} r="4" /><circle cx={bx} cy={center.y} r="4" />
          <circle cx={center.x} cy={center.y} r="3" />
          <circle cx={point().x} cy={point().y} r="9" fill="none" opacity=".5" />
          <circle cx={point().x} cy={point().y} r="5" />
        </g>
      </svg>
      <div class="landing-plot-controls">
        <label for="landing-angle">调整圆心角 ∠BOP</label>
        <span class="landing-angle-value" aria-hidden="true">θ = {angle()}°</span>
        <input id="landing-angle" type="range" min="15" max="165" value={angle()}
          aria-valuetext={`${angle()} 度`} onInput={(event) => setAngle(event.currentTarget.valueAsNumber)} />
      </div>
    </figure>
  )
}

function Landing() {
  return (
    <div class="landing">
      <a class="skip-link" href="#main-content">跳到主要内容</a>
      <header class="landing-nav">
        <A href="/" class="brand" aria-label="AI GeoGebra 首页"><img src="/design/mark.svg" alt="" /><span>AI GeoGebra</span></A>
        <nav class="landing-nav-links" aria-label="首页导航">
          <a href="#example">交互示例</a><a href="#modules">数学工作区</a>
        </nav>
        <nav class="landing-actions" aria-label="账户导航">
          <Show when={loggedIn()} fallback={<><A href="/login" class="landing-text-link">登录</A><A href="/register" class="btn ghost">注册</A></>}>
            <A href="/dashboard" class="btn">进入工作台 <Icon name="arrow-right" /></A>
          </Show>
        </nav>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section class="landing-hero" aria-labelledby="home-title">
          <div class="landing-intro">
            <p class="landing-discipline">交互式数学探索</p>
            <h1 id="home-title">从问题出发，<span>构造数学模型</span></h1>
            <p class="landing-lede">用中文描述数学问题，在 GeoGebra 中执行 AI 生成的作图与计算命令，观察图形、检验条件、探索结论。</p>
            <div class="landing-actions">
              <Show when={loggedIn()} fallback={<A href="/try" class="btn">游客试用 <Icon name="arrow-right" /></A>}>
                <A href="/dashboard" class="btn">打开我的工作台 <Icon name="arrow-right" /></A>
              </Show>
              <a href="#modules" class="landing-text-link">浏览数学模块</a>
            </div>
          </div>
          <CircleExample />
        </section>

        <section class="landing-modes" id="modules" aria-labelledby="landing-modes-title">
          <h2 id="landing-modes-title">数学工作区</h2>
          <div class="module-grid">
            <For each={modeList}>{(mode) => (
              <A class="module-card" href={`${loggedIn() ? '/dashboard' : '/try'}?mode=${mode.id}`}>
                <Icon name={mode.icon} />
                <div>
                  <h3>{modeIntro[mode.id].title}</h3>
                  <p>{modeIntro[mode.id].description}</p>
                </div>
                <Icon name="arrow-right" />
              </A>
            )}</For>
          </div>
        </section>
      </main>
      <footer class="landing-footer"><span>AI GeoGebra</span><div class="legal-links"><A href="/privacy">隐私政策</A><A href="/terms">用户协议</A></div></footer>
    </div>
  )
}

export function Home() {
  const [params] = useSearchParams()
  return (
    <Show when={typeof params.session === 'string' && params.session} keyed fallback={<Landing />}>
      {(id) => <Navigate href={workspacePath(id)} />}
    </Show>
  )
}

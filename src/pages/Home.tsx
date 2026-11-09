import { A, Navigate, useSearchParams } from '@solidjs/router'
import { For, Show } from 'solid-js'
import { Icon } from '../Icon'
import { workspacePath } from '../api'
import { modeList } from '../modes'
import { loggedIn } from '../pb'

const modeIntro = {
  geometry: '从点、线、圆到函数图像，用自然语言建立平面图形。',
  '3d': '画出空间图形，旋转观察点、线、面的位置关系。',
  probability: '计算分布和区间概率，在曲线上查看对应的范围。',
  scientific: '计算根式、对数和三角函数，查看算式与结果。',
}

function Landing() {
  return (
    <div class="landing">
      <a class="skip-link" href="#main-content">跳到主要内容</a>
      <header class="landing-nav">
        <A href="/" class="brand"><img src="/design/mark.svg" alt="" /><span>AI GeoGebra<small>AI 几何画板</small></span></A>
        <nav class="landing-actions" aria-label="首页导航">
          <Show when={loggedIn()} fallback={<><A href="/login" class="btn ghost">登录</A><A href="/register" class="btn">注册</A></>}>
            <A href="/dashboard" class="btn">进入工作台 <Icon name="arrow-right" /></A>
          </Show>
        </nav>
      </header>

      <main id="main-content">
        <section class="landing-hero" aria-labelledby="home-title">
          <div class="landing-intro">
            <p class="eyebrow">AI 助手 · GeoGebra 画板</p>
            <h1 id="home-title">一句话，让数学<br />看得见</h1>
            <p>用中文描述问题，AI 会在 GeoGebra 里作图或计算，并解释每一步。登录后，你可以回到自己的会话，接着上次的图形继续探索。</p>
            <div class="landing-actions">
              <Show when={loggedIn()} fallback={<><A href="/register" class="btn">创建账户 <Icon name="arrow-right" /></A><A href="/try" class="btn ghost">游客试用</A></>}>
                <A href="/dashboard" class="btn">打开我的工作台 <Icon name="arrow-right" /></A>
              </Show>
            </div>
          </div>
          <figure class="landing-preview">
            <figcaption><span><Icon name="triangle" /> 几何画板</span><small>作图示意</small></figcaption>
            <svg viewBox="0 0 480 286" role="img" aria-label="三角形 ABC 及从 C 到 AB 的垂线 CH">
              <defs>
                <pattern id="landing-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                  <path d="M24 0H0V24" fill="none" stroke="var(--border)" />
                </pattern>
              </defs>
              <rect width="480" height="286" fill="url(#landing-grid)" />
              <path d="M38 244H445M62 260V26" fill="none" stroke="var(--muted)" />
              <path d="M110 220L382 220L225 64Z" fill="var(--soft)" stroke="var(--accent)" stroke-width="3" />
              <path d="M225 64V220" stroke="var(--accent)" stroke-width="2" stroke-dasharray="6 5" />
              <path d="M225 206H239V220" fill="none" stroke="var(--accent)" stroke-width="2" />
              <g fill="var(--accent)">
                <circle cx="110" cy="220" r="4" /><circle cx="382" cy="220" r="4" /><circle cx="225" cy="64" r="4" /><circle cx="225" cy="220" r="4" />
                <text x="93" y="214">A</text><text x="391" y="214">B</text><text x="224" y="49">C</text><text x="216" y="239">H</text>
              </g>
            </svg>
            <p><Icon name="chat-circle-text" /> 画三角形 ABC，并作出 AB 边上的高。</p>
          </figure>
        </section>

        <section class="landing-modes" aria-labelledby="landing-modes-title">
          <h2 id="landing-modes-title">四种数学工作区</h2>
          <div class="module-grid">
            <For each={modeList}>{(mode) => (
              <article class="module-card">
                <span class="module-symbol"><Icon name={mode.icon} /></span>
                <h3>{mode.label}</h3>
                <p>{modeIntro[mode.id]}</p>
              </article>
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

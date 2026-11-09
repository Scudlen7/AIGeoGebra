import { A } from '@solidjs/router'
import { Show, type JSX } from 'solid-js'

export function AuthLayout(props: { title: string; description: string; alternate?: { href: string; label: string }; children: JSX.Element }) {
  return (
    <div class="auth-layout">
      <section class="auth-story" aria-label="关于 AI GeoGebra">
        <A class="auth-brand" href="/" aria-label="AI GeoGebra 首页">
          <img src="/design/mark.svg" alt="" width="32" height="32" />
          <span>AI GeoGebra</span>
        </A>
        <svg class="auth-art" viewBox="0 0 420 320" aria-hidden="true">
          <defs>
            <pattern id="auth-grid" width="28" height="28" patternUnits="userSpaceOnUse">
              <path d="M28 0H0V28" fill="none" stroke="currentColor" stroke-opacity=".15" />
            </pattern>
          </defs>
          <rect width="420" height="320" rx="12" fill="url(#auth-grid)" />
          <path d="M62 252H358L178 64Z" fill="currentColor" fill-opacity=".08" stroke="currentColor" stroke-width="2" />
          <path d="M178 64V252" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 5" />
          <path d="M178 239h13v13" fill="none" stroke="currentColor" stroke-width="1.5" />
          <g fill="currentColor">
            <circle cx="62" cy="252" r="4" /><circle cx="358" cy="252" r="4" />
            <circle cx="178" cy="64" r="4" /><circle cx="178" cy="252" r="4" />
            <text x="44" y="274">A</text><text x="365" y="274">B</text>
            <text x="173" y="49">C</text><text x="174" y="274">H</text>
          </g>
        </svg>
        <div class="auth-story-copy">
          <h2>让数学看得见</h2>
          <p>用中文提出问题，在 GeoGebra 画板上探索几何、3D、概率与科学计算。登录后可以继续之前保存的会话和图形。</p>
        </div>
      </section>
      <nav class="auth-nav" aria-label="认证导航">
        <A class="auth-home-link" href="/">返回首页</A>
        <Show when={props.alternate}>{(link) => <A class="btn ghost" href={link().href}>{link().label}</A>}</Show>
      </nav>
      <main id="main-content" class="auth-card">
        <header class="auth-card-head">
          <h1>{props.title}</h1>
          <p>{props.description}</p>
        </header>
        {props.children}
      </main>
    </div>
  )
}

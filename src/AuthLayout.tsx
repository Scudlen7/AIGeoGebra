import { A } from '@solidjs/router'
import type { JSX } from 'solid-js'
export function AuthLayout(props: { children: JSX.Element }) {
  return <div class="auth-layout"><section class="auth-story"><h2>让抽象的数学<br />变成看得见的理解</h2><p>从一句提问，到一个图形。<br />给每一个数学想法，留一块探索的空间。</p><svg viewBox="0 0 560 320" role="img" aria-label="三角形与高线的数学插图"><path d="M80 260 460 260 220 40Z" fill="var(--soft)" stroke="var(--accent)" stroke-width="2" /><path d="M220 40V260 M220 244h16v16" fill="none" stroke="var(--accent)" stroke-dasharray="6 6" /><g fill="var(--accent)"><text x="60" y="285">A</text><text x="470" y="285">B</text><text x="215" y="25">C</text><text x="210" y="285">H</text></g></svg><p class="meta">几何 · 空间 · 概率 · 科学计算</p></section><main id="main-content" class="auth-card"><A class="back-link" href="/">← 返回首页</A>{props.children}</main></div>
}

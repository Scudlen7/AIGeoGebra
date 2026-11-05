import { A } from '@solidjs/router'
import { AccountBar } from '../AccountBar'

export function NotFound() {
  return <div class="subpage"><AccountBar /><main id="main-content" class="page empty-panel"><p class="meta">404</p><h1>这次探索，暂时走到了边界</h1><p>没有找到这个页面，返回工作区继续你的数学问题。</p><p><A class="btn" href="/">返回工作区</A></p></main></div>
}

import { A, Navigate, useLocation } from '@solidjs/router'
import { For, Show, createSignal, onCleanup, onMount, type ParentProps } from 'solid-js'
import { AccountBar } from '../AccountBar'
import { Icon } from '../Icon'

const categories = [
  { href: '/settings/models', label: '模型偏好', description: '管理供应商并选择默认模型' },
  { href: '/settings/security', label: '账户安全', description: '管理昵称、邮箱和密码' },
  { href: '/settings/data', label: '数据管理', description: '导出会话、清理缓存或删除账号' },
]

const legacySections: Record<string, string> = {
  '#model': '/settings/models',
  '#account': '/settings/security',
  '#data': '/settings/data',
}

export function SettingsIndex() {
  const location = useLocation()
  const media = window.matchMedia('(max-width: 860px)')
  const [mobile, setMobile] = createSignal(media.matches)
  const update = () => setMobile(media.matches)
  onMount(() => {
    media.addEventListener('change', update)
    onCleanup(() => media.removeEventListener('change', update))
  })
  const destination = () => legacySections[location.hash] || (mobile() ? '' : '/settings/models')
  return <Show when={destination()} keyed>{(href) => <Navigate href={href} />}</Show>
}

export function Settings(props: ParentProps) {
  const location = useLocation()
  return (
    <div class="subpage">
      <AccountBar />
      <main id="main-content" class="settings-page" data-overview={location.pathname.replace(/\/$/, '') === '/settings'}>
        <header class="settings-header">
          <h1>设置</h1>
          <p>管理模型、账户和会话数据。</p>
        </header>
        <div class="settings-layout">
          <nav class="settings-nav" aria-label="设置分类">
            <For each={categories}>{(category) => (
              <A href={category.href} end activeClass="active" aria-label={category.label}>
                <span>{category.label}<small>{category.description}</small></span>
                <Icon name="arrow-right" />
              </A>
            )}</For>
          </nav>
          <div class="settings-content">
            <A class="back-link settings-back" href="/settings"><span aria-hidden="true">←</span> 返回设置</A>
            {props.children}
          </div>
        </div>
      </main>
    </div>
  )
}

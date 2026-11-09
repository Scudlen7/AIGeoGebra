import { Show, createSignal, onCleanup } from 'solid-js'
import { postAuth, readableError, retryAfterOf } from '../../api'
import { authUser, pb } from '../../pb'

type Editor = 'name' | 'email' | 'password'

export function SecuritySettings() {
  const [editing, setEditing] = createSignal<Editor | null>(null)
  const [name, setName] = createSignal('')
  const [email, setEmail] = createSignal('')
  const [code, setCode] = createSignal('')
  const [oldPassword, setOldPassword] = createSignal('')
  const [password, setPassword] = createSignal('')
  const [passwordConfirm, setPasswordConfirm] = createSignal('')
  const [notice, setNotice] = createSignal('')
  const [error, setError] = createSignal('')
  const [saving, setSaving] = createSignal(false)
  const [sending, setSending] = createSignal(false)
  const [wait, setWait] = createSignal(0)
  const busy = () => saving() || sending()
  let timer: number | undefined
  let active = true
  onCleanup(() => {
    active = false
    window.clearInterval(timer)
  })

  function edit(next: Editor | null) {
    setError('')
    setNotice('')
    setName(String(authUser()?.name || ''))
    setEmail('')
    setCode('')
    setOldPassword('')
    setPassword('')
    setPasswordConfirm('')
    setEditing(next)
  }

  async function saveChange(action: () => Promise<void>, success: string, failure: string) {
    if (busy()) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await action()
      if (!active) return
      edit(null)
      setNotice(success)
    } catch (reason) {
      if (active) setError(readableError(reason, failure))
    } finally {
      setSaving(false)
    }
  }

  function saveName(event: Event) {
    event.preventDefault()
    const user = authUser()
    if (!user) return
    const nextName = name().trim()
    if ([...nextName].length < 2) {
      setError('昵称至少 2 个字符')
      return
    }
    const token = pb.authStore.token
    void saveChange(async () => {
      const updated = await pb.collection('users').update(user.id, { name: nextName })
      if (pb.authStore.token === token && authUser()?.id === user.id) pb.authStore.save(token, updated)
    }, '昵称已更新', '昵称更新失败')
  }

  function startWait(seconds: number) {
    window.clearInterval(timer)
    setWait(seconds)
    timer = window.setInterval(() => {
      setWait((value) => {
        if (value <= 1) {
          window.clearInterval(timer)
          return 0
        }
        return value - 1
      })
    }, 1000)
  }

  async function sendEmailCode() {
    if (busy() || wait() > 0) return
    setSending(true)
    setError('')
    setNotice('')
    try {
      await postAuth('/api/auth/request-code', { email: email().trim().toLowerCase(), purpose: 'email_change' }, true)
      if (!active) return
      startWait(60)
      setNotice('验证码已发到新邮箱')
    } catch (reason) {
      if (!active) return
      const retry = retryAfterOf(reason)
      if (retry) startWait(retry)
      setError(readableError(reason, '验证码发送失败'))
    } finally {
      setSending(false)
    }
  }

  function changeEmail(event: Event) {
    event.preventDefault()
    const token = pb.authStore.token
    void saveChange(async () => {
      await postAuth('/api/auth/change-email', { email: email().trim().toLowerCase(), code: code().trim() }, true)
      if (pb.authStore.token === token) await pb.collection('users').authRefresh()
    }, '邮箱已更新', '邮箱更新失败')
  }

  function changePassword(event: Event) {
    event.preventDefault()
    const user = authUser()
    if (!user) return
    const nextPassword = password()
    if (nextPassword.length < 8) {
      setError('密码至少 8 位')
      return
    }
    if (nextPassword !== passwordConfirm()) {
      setError('两次输入的密码不一致')
      return
    }
    const token = pb.authStore.token
    void saveChange(async () => {
      await pb.collection('users').update(user.id, {
        oldPassword: oldPassword(),
        password: nextPassword,
        passwordConfirm: passwordConfirm(),
      })
      if (pb.authStore.token === token && authUser()?.id === user.id) {
        await pb.collection('users').authWithPassword(String(user.email || ''), nextPassword)
      }
    }, '密码已更新', '密码更新失败')
  }

  const formActions = (label: string) => (
    <div class="settings-form-actions">
      <button class="btn" type="submit" disabled={busy()}>{saving() ? '保存中…' : label}</button>
      <button class="btn ghost" type="button" disabled={busy()} onClick={() => edit(null)}>取消</button>
    </div>
  )

  return (
    <section aria-labelledby="security-settings-title">
      <header class="settings-section-head">
        <h2 id="security-settings-title">账户安全</h2>
        <p>管理个人资料、登录邮箱和密码。</p>
      </header>
      <Show when={notice()}><p class="settings-feedback" role="status">{notice()}</p></Show>
      <Show when={error()}><p class="banner" role="alert">{error()}</p></Show>
      <div class="settings-row">
        <div><h3 class="settings-row-title">昵称</h3><p>{String(authUser()?.name || '尚未设置')}</p></div>
        <button class="btn ghost" type="button" aria-expanded={editing() === 'name'} disabled={busy()} onClick={() => edit(editing() === 'name' ? null : 'name')}>编辑昵称</button>
      </div>
      <Show when={editing() === 'name'}>
        <form class="stack-form settings-editor" onSubmit={saveName}>
          <label>昵称<input value={name()} onInput={(event) => setName(event.currentTarget.value)} /></label>
          {formActions('保存昵称')}
        </form>
      </Show>
      <div class="settings-row">
        <div><h3 class="settings-row-title">邮箱</h3><p>{String(authUser()?.email || '尚未设置')}</p></div>
        <button class="btn ghost" type="button" aria-expanded={editing() === 'email'} disabled={busy()} onClick={() => edit(editing() === 'email' ? null : 'email')}>更换邮箱</button>
      </div>
      <Show when={editing() === 'email'}>
        <form class="stack-form settings-editor" onSubmit={changeEmail}>
          <div class="form-field">
            <label for="settings-new-email">新邮箱</label>
            <div class="code-row">
              <input id="settings-new-email" type="email" autocomplete="email" value={email()} onInput={(event) => setEmail(event.currentTarget.value)} />
              <button class="btn ghost" type="button" disabled={busy() || wait() > 0} onClick={() => void sendEmailCode()}>
                {wait() > 0 ? `${wait()} 秒后重发` : sending() ? '发送中…' : '发送验证码'}
              </button>
            </div>
          </div>
          <label>新邮箱验证码<input inputMode="numeric" autocomplete="one-time-code" maxlength={4} value={code()} onInput={(event) => setCode(event.currentTarget.value)} /></label>
          {formActions('更新邮箱')}
        </form>
      </Show>
      <div class="settings-row">
        <div><h3 class="settings-row-title">密码</h3><p>使用当前密码验证后，可以设置新的登录密码。</p></div>
        <button class="btn ghost" type="button" aria-expanded={editing() === 'password'} disabled={busy()} onClick={() => edit(editing() === 'password' ? null : 'password')}>修改密码</button>
      </div>
      <Show when={editing() === 'password'}>
        <form class="stack-form settings-editor" onSubmit={changePassword}>
          <label>当前密码<input type="password" autocomplete="current-password" value={oldPassword()} onInput={(event) => setOldPassword(event.currentTarget.value)} /></label>
          <label>新密码<input type="password" autocomplete="new-password" value={password()} onInput={(event) => setPassword(event.currentTarget.value)} /></label>
          <label>确认新密码<input type="password" autocomplete="new-password" value={passwordConfirm()} onInput={(event) => setPasswordConfirm(event.currentTarget.value)} /></label>
          {formActions('更新密码')}
        </form>
      </Show>
    </section>
  )
}

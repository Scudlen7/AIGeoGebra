import { useNavigate } from '@solidjs/router'
import { Show, createSignal } from 'solid-js'
import { downloadJson, readableError, sessionExport } from '../../api'
import { authUser, pb } from '../../pb'
import { clearLocalAiggbCache } from '../../session'

export function DataSettings() {
  const navigate = useNavigate()
  const [exporting, setExporting] = createSignal(false)
  const [deleting, setDeleting] = createSignal(false)
  const [notice, setNotice] = createSignal('')
  const [error, setError] = createSignal('')

  async function exportAll() {
    if (exporting()) return
    setExporting(true)
    setError('')
    setNotice('')
    try {
      const list = await pb.collection('sessions').getFullList({ sort: '-updated' })
      downloadJson('aiggb-sessions.json', list.map((item) => sessionExport(item)))
      setNotice('已导出全部会话')
    } catch (reason) {
      setError(readableError(reason, '会话导出失败'))
    } finally {
      setExporting(false)
    }
  }

  function clearCache() {
    if (!window.confirm('清空此浏览器上的草稿、缓存和界面偏好？云端会话与登录状态会保留。')) return
    clearLocalAiggbCache()
    window.location.reload()
  }

  async function deleteAccount() {
    const user = authUser()
    if (!user || deleting()) return
    if (!window.confirm('删除账号会永久移除你的云端会话和用量记录。确定删除？')) return
    const token = pb.authStore.token
    setDeleting(true)
    setError('')
    setNotice('')
    try {
      await pb.collection('users').delete(user.id)
      if (pb.authStore.token === token && authUser()?.id === user.id) {
        pb.authStore.clear()
        navigate('/', { replace: true })
      }
    } catch (reason) {
      setError(readableError(reason, '删除账号失败'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section aria-labelledby="data-settings-title">
      <header class="settings-section-head">
        <h2 id="data-settings-title">数据管理</h2>
        <p>导出云端会话，或管理保存在此浏览器中的数据。</p>
      </header>
      <Show when={notice()}><p class="settings-feedback" role="status">{notice()}</p></Show>
      <Show when={error()}><p class="banner" role="alert">{error()}</p></Show>
      <div class="settings-row">
        <div><h3 class="settings-row-title">云端会话</h3><p>把对话、草稿和保存的图形打包成 JSON 文件。</p></div>
        <button class="btn ghost" type="button" disabled={exporting()} onClick={() => void exportAll()}>{exporting() ? '导出中…' : '导出全部会话'}</button>
      </div>
      <div class="settings-row">
        <div><h3 class="settings-row-title">本机缓存</h3><p>清理这个浏览器保存的草稿与偏好。云端会话和登录状态会保留。</p></div>
        <button class="btn ghost" type="button" onClick={clearCache}>清空本机缓存</button>
      </div>
      <div class="settings-danger">
        <h3>危险操作</h3>
        <div class="settings-row">
          <div><h4 class="settings-row-title">永久删除账号</h4><p>删除后，你的云端会话和用量记录会永久移除。</p></div>
          <button class="btn danger" type="button" disabled={deleting()} onClick={() => void deleteAccount()}>{deleting() ? '删除中…' : '删除账号'}</button>
        </div>
      </div>
    </section>
  )
}

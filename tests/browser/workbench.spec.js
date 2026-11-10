import { test, expect } from '@playwright/test'

const owner = { id: 'workbench-user', name: '测试用户', model: 'test', collectionId: 'users', collectionName: 'users' }
const token = `x.${Buffer.from(JSON.stringify({ exp: 4102444800 })).toString('base64url')}.x`
const auth = { token, record: owner }
const xml = (label) => `<geogebra><construction><element label="${label}"/></construction></geogebra>`

async function mockServices(page) {
  const records = [
    ['geometry-a', '几何甲', 'geometry', 'A'],
    ['geometry-b', '几何乙', 'geometry', 'B'],
    ['space-a', '空间题', '3d', 'C'],
    ['probability-a', '分布题', 'probability', 'D'],
    ['calculator-a', '对数题', 'scientific', 'E'],
  ].map(([id, name, mode, label]) => ({
    id, name, mode, owner: owner.id, updated: '2026-11-06 08:15:00.000Z',
    input: '', messages: [{ role: 'user', content: `${name}的问题` }],
    report: { boardXml: xml(label), objects: [], results: [], hint: '' },
  }))
  const state = { records, failSave: '', usage: { requests: 0, tokens: 0, days: [], models: [] } }
  await page.route('**/api/config', route => route.fulfill({ json: { pbUrl: 'http://pb.test' } }))
  await page.route('**/api/status', route => route.fulfill({ json: { configured: true, model: 'test' } }))
  await page.route('**/api/models', route => route.fulfill({ json: [{ id: 'test', label: '数学模型', gateway: false }] }))
  await page.route('http://pb.test/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path.endsWith('/auth-with-password') || path.endsWith('/auth-refresh') || path === '/api/auth/register') {
      return route.fulfill({ json: auth })
    }
    if (path === '/api/auth/request-code' || path === '/api/auth/reset-password') return route.fulfill({ json: { ok: true } })
    if (request.headers().authorization !== token) return route.fulfill({ status: 403, json: { message: '登录后查看会话' } })
    if (path === '/api/usage/summary') return route.fulfill({ json: { ...state.usage, sessions: records.length } })
    const base = '/api/collections/sessions/records'
    if (path === base && request.method() === 'POST') {
      const record = { ...request.postDataJSON(), id: 'new-session' }
      records.push(record)
      return route.fulfill({ json: record })
    }
    if (path === base) return route.fulfill({ json: { page: 1, perPage: 100, totalItems: records.length, totalPages: 1, items: records } })
    const record = records.find(item => path === `${base}/${item.id}`)
    if (!record) return route.fulfill({ status: 404, json: { message: '会话不存在' } })
    if (request.method() === 'PATCH') {
      if (state.failSave === record.id) return route.fulfill({ status: 503, json: { message: '暂时无法保存' } })
      Object.assign(record, request.postDataJSON())
    }
    if (request.method() === 'DELETE') {
      records.splice(records.indexOf(record), 1)
      return route.fulfill({ status: 204 })
    }
    return route.fulfill({ json: record })
  })
  await page.route('**/deployggb.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.GGBApplet = class {
      constructor(options) { this.options = options }
      setHTML5Codebase() {}
      inject() {
        let notify
        window.boardMounts = (window.boardMounts || 0) + 1
        window.boardXml = '<geogebra><construction/></geogebra>'
        window.editBoard = xml => { window.boardXml = xml; notify?.() }
        this.options.appletOnLoad({
          setErrorDialogsActive() {}, setSize(width) { window.boardWidth = width }, setAxesVisible() {}, setGridVisible() {},
          getAllObjectNames() { return [] }, getXML() { return window.boardXml },
          setXML(xml) { window.boardXml = xml }, registerUpdateListener(listener) { notify = listener },
          unregisterUpdateListener() { notify = undefined },
        })
      }
    }`,
  }))
  return state
}

async function signIn(page) {
  await page.getByLabel('邮箱', { exact: true }).fill('test@example.test')
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
}

test('homepage and trial are public; a legacy history link requires login and opens the same session', async ({ page }) => {
  await mockServices(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('看得见')
  await expect(page.locator('.board-host')).toHaveCount(0)
  await page.getByRole('link', { name: '游客试用' }).click()
  await expect(page).toHaveURL(/\/try$/)
  await expect(page.getByLabel('描述你的问题')).toBeEnabled()
  await page.getByLabel('描述你的问题').fill('游客草稿')
  await page.goto('/?session=geometry-b')
  await expect(page).toHaveURL(/\/login\?redirect=/)
  await expect(page.locator('.board-host')).toHaveCount(0)
  await signIn(page)
  await expect(page).toHaveURL(/\/workspace\?session=geometry-b$/)
  await expect(page.locator('.transcript')).toContainText('几何乙的问题')
  await expect(page.getByLabel('描述你的问题')).toHaveValue('')
  await expect.poll(() => page.evaluate(() => window.boardXml)).toBe(xml('B'))
})

test('login and registration both land on the personal workbench', async ({ page }) => {
  await mockServices(page)
  await page.goto('/')
  await page.getByRole('link', { name: '登录', exact: true }).click()
  await signIn(page)
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('heading', { name: '我的工作台' })).toBeVisible()
  await page.getByRole('button', { name: owner.name }).click()
  await page.getByRole('button', { name: '退出登录' }).click()
  await expect(page).toHaveURL(/\/$/)
  await page.getByRole('link', { name: '注册', exact: true }).click()
  await page.getByLabel('昵称').fill('新的用户')
  await page.getByLabel('邮箱', { exact: true }).fill('test@example.test')
  await page.getByRole('button', { name: '发送验证码' }).click()
  await page.getByLabel('验证码').fill('1234')
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByLabel('确认密码').fill('test-password')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: '注册', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('heading', { name: '我的工作台' })).toBeVisible()
})

test('password recovery preserves the original private settings destination', async ({ page }) => {
  await mockServices(page)
  await page.goto('/settings#account')
  await expect(page).toHaveURL(/\/login\?redirect=/)
  await page.getByRole('link', { name: '忘记密码' }).click()
  await page.getByLabel('邮箱', { exact: true }).fill('test@example.test')
  await page.getByRole('button', { name: '发送验证码' }).click()
  await page.getByLabel('验证码').fill('1234')
  await page.getByLabel('新密码', { exact: true }).fill('test-password')
  await page.getByLabel('确认新密码').fill('test-password')
  await page.getByRole('button', { name: '重置密码' }).click()
  await expect(page.getByText('密码已更新。请用新密码登录。')).toBeVisible()
  await page.getByRole('link', { name: '去登录' }).click()
  await signIn(page)
  await expect(page).toHaveURL(/\/settings\/security$/)
  await expect(page.getByRole('heading', { name: '账户安全' })).toBeVisible()
})

test('workbench groups history and restores the selected drawing through a failed save and reload', async ({ page }) => {
  const state = await mockServices(page)
  await page.goto('/login')
  await signIn(page)
  const modules = page.getByRole('navigation', { name: '会话模块' })
  const history = page.locator('.session-list')
  for (const [mode, name] of [['3D', '空间题'], ['概率', '分布题'], ['计算器', '对数题']]) {
    await modules.getByRole('button', { name: new RegExp(`^${mode}`) }).click()
    await expect(history.getByRole('listitem')).toHaveCount(1)
    await expect(history).toContainText(name)
  }
  await modules.getByRole('button', { name: /^几何/ }).click()
  await expect(history.getByRole('listitem')).toHaveCount(2)
  const open = (name) => history.getByRole('listitem').filter({ hasText: name }).getByRole('link', { name: '打开' }).click()
  const goToWorkbench = () => page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '工作台', exact: true }).click()
  await open('几何甲')
  await expect.poll(() => page.evaluate(() => window.boardXml)).toBe(xml('A'))
  state.failSave = 'geometry-a'
  await page.evaluate((edited) => window.editBoard(edited), xml('A-edited'))
  await goToWorkbench()
  await open('几何乙')
  await expect.poll(() => page.evaluate(() => window.boardXml)).toBe(xml('B'))
  await expect(page.locator('.transcript')).toContainText('几何乙的问题')
  await expect(page.getByRole('button', { name: '重试同步' })).toHaveCount(0)
  await goToWorkbench()
  await open('几何甲')
  await page.reload()
  await expect.poll(() => page.evaluate(() => window.boardXml)).toBe(xml('A-edited'))
  state.failSave = ''
  await page.getByRole('button', { name: '重试同步' }).click()
  await expect(page.getByText('已同步到云端', { exact: true })).toBeVisible()
  expect(state.records.find(item => item.id === 'geometry-a').report.boardXml).toBe(xml('A-edited'))
  expect(state.records.find(item => item.id === 'geometry-b').report.boardXml).toBe(xml('B'))
  await goToWorkbench()
  await modules.getByRole('button', { name: /^3D/ }).click()
  const create = page.getByRole('main').getByRole('button', { name: '新建会话', exact: true })
  await expect(page.getByLabel('会话名称')).toBeHidden()
  await create.click()
  const dialog = page.getByRole('dialog', { name: '新建会话' })
  await expect(dialog.getByLabel('数学模块')).toHaveValue('3d')
  await dialog.getByLabel('会话名称').fill('不会保存的名称')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(create).toBeFocused()
  await create.click()
  await expect(dialog.getByLabel('会话名称')).toHaveValue('')
  await dialog.getByLabel('会话名称').fill('新的空间会话')
  await dialog.getByRole('button', { name: '创建会话' }).click()
  await expect(page).toHaveURL(/\/workspace\?session=new-session$/)
  await expect(page.getByText('当前会话 新的空间会话')).toBeVisible()
  await expect(page.getByLabel('描述你的问题')).toBeEnabled()
  expect(state.records.find(item => item.id === 'new-session')).toMatchObject({ mode: '3d', messages: [] })
  await expect.poll(() => page.evaluate(() => window.boardXml)).toBe('<geogebra><construction/></geogebra>')
})

test('dashboard shows usage and a compact paginated history with session actions', async ({ page }) => {
  const state = await mockServices(page)
  state.usage = {
    requests: 15,
    tokens: 2536,
    days: [0, 3, 1, 0, 2, 0, 4].map((requests, index) => ({ date: `2026-11-0${index + 1}`, requests })),
    models: [{ model: 'test', requests: 15, tokens: 2536 }],
  }
  for (let index = 1; index <= 4; index++) {
    state.records.push({ ...state.records[0], id: `extra-${index}`, name: `历史几何题 ${index}` })
  }
  await page.goto('/login')
  await signIn(page)

  const main = page.getByRole('main')
  const metrics = main.getByRole('region', { name: '用量概况' }).getByRole('article')
  await expect(metrics).toHaveCount(4)
  for (const [label, value] of [['累计请求数', '15'], ['云端会话', '9'], ['Token 总量', '2,536'], ['近 7 天活跃天数', '4']]) {
    await expect(metrics.filter({ hasText: label }).locator('strong')).toHaveText(value)
  }
  const chart = main.getByRole('region', { name: '近 7 天请求' })
  await expect(chart.getByRole('listitem', { name: '2026-11-07，4 次请求' })).toBeVisible()
  await chart.getByText('按模型查看请求数', { exact: true }).click()
  await expect(chart.getByText('test', { exact: true })).toBeVisible()

  const history = main.getByRole('region', { name: '历史会话' })
  const rows = history.locator('.session-list').getByRole('listitem')
  await expect(rows).toHaveCount(5)
  await expect(rows.first().locator('time')).toHaveAttribute('datetime', '2026-11-06T08:15:00.000Z')
  await history.getByRole('button', { name: '下一页' }).click()
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('历史几何题 4')
  await history.getByRole('searchbox', { name: '搜索会话' }).fill('几何乙')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('几何乙')
  await expect(history.getByRole('button', { name: '导出', exact: true })).toBeHidden()
  await rows.first().getByRole('button', { name: /更多操作/ }).click()
  const download = page.waitForEvent('download')
  await history.getByRole('button', { name: '导出', exact: true }).click()
  expect((await download).suggestedFilename()).toBe('session-几何乙.json')
  await history.getByRole('button', { name: '重命名', exact: true }).click()
  await history.getByLabel('新会话名称').fill('新的几何标题')
  await history.getByRole('button', { name: '保存', exact: true }).click()
  await expect(history.getByText('没有找到相关会话')).toBeVisible()
  await history.getByRole('searchbox', { name: '搜索会话' }).fill('新的几何标题')
  await expect(rows.first()).toContainText('新的几何标题')
  await rows.first().getByRole('button', { name: /更多操作/ }).click()
  page.once('dialog', dialog => dialog.accept())
  await history.getByRole('button', { name: '删除', exact: true }).click()
  await expect(rows).toHaveCount(0)
  await expect(metrics.filter({ hasText: '云端会话' }).locator('strong')).toHaveText('8')

  await page.route('http://pb.test/api/usage/summary', route => route.fulfill({ status: 503, json: { message: '用量暂不可用' } }))
  await page.reload()
  await expect(chart.getByRole('alert')).toHaveText('用量暂不可用')
  await expect(metrics.filter({ hasText: '累计请求数' }).locator('strong')).toHaveText('—')
  await expect(metrics.filter({ hasText: '云端会话' }).locator('strong')).toHaveText('8')
  await expect(rows.first()).toContainText('几何甲')
})

async function openGeometrySession(page) {
  await page.goto('/workspace?session=geometry-a')
  await signIn(page)
  await expect(page.getByLabel('描述你的问题')).toBeEnabled()
  await expect.poll(() => page.evaluate(() => window.boardXml)).toBe(xml('A'))
}

test('conversation displays saved user and assistant messages after reload and session switching', async ({ page }) => {
  const state = await mockServices(page)
  state.records[0].messages.push({ role: 'assistant', content: '已完成平行四边形，**对边平行**。' })
  await openGeometrySession(page)
  const transcript = page.locator('.transcript')
  const checkMessages = async () => {
    await expect(transcript.locator('article.user')).toHaveText('几何甲的问题')
    await expect(transcript.locator('article.assistant')).toContainText('已完成平行四边形')
    for (const role of ['user', 'assistant']) {
      await expect(transcript.locator(`article.${role}`)).toBeVisible()
      await expect(transcript.locator(`article.${role}`)).toHaveCSS('opacity', '1')
    }
  }
  await checkMessages()
  await page.reload()
  await checkMessages()
  const sessions = page.getByRole('region', { name: '侧栏会话' })
  await sessions.getByRole('link', { name: '几何乙' }).click()
  await expect(transcript.locator('article.user')).toHaveText('几何乙的问题')
  await expect(transcript.locator('article.assistant')).toHaveCount(0)
  await sessions.getByRole('link', { name: '几何甲' }).click()
  await checkMessages()
})

test('conversation remains readable when animation frames are paused', async ({ page }) => {
  await page.addInitScript(() => {
    // Background/embedded browsers may suspend animation frames while data keeps loading.
    window.requestAnimationFrame = () => 0
    window.cancelAnimationFrame = () => {}
  })
  const state = await mockServices(page)
  state.records[0].messages.push({ role: 'assistant', content: '平行四边形已完成。' })
  await openGeometrySession(page)
  for (const role of ['user', 'assistant']) {
    const message = page.locator(`.transcript article.${role}`)
    await expect(message).toBeVisible()
    await expect(message).toHaveCSS('opacity', '1')
  }
})

test('collapsing the sidebar widens the conversation and preserves the board and draft', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockServices(page)
  await openGeometrySession(page)
  const width = () => page.locator('.conversation').evaluate(el => el.clientWidth)
  const original = await width()
  const mounts = await page.evaluate(() => window.boardMounts)
  const draft = page.getByLabel('描述你的问题')
  await draft.fill('仍在编辑的草稿')
  await page.getByRole('button', { name: '折叠侧栏' }).click()
  await expect.poll(width).toBeGreaterThan(original + 60)
  await expect.poll(() => page.locator('.board-frame').evaluate(el => window.boardWidth === el.clientWidth)).toBe(true)
  await expect(draft).toHaveValue('仍在编辑的草稿')
  expect(await page.evaluate(() => window.boardMounts)).toBe(mounts)
  expect(await page.evaluate(() => window.boardXml)).toBe(xml('A'))
  await page.getByRole('button', { name: '展开侧栏' }).click()
  await expect.poll(width).toBe(original)
  await page.getByRole('button', { name: '折叠侧栏' }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: '展开侧栏' })).toBeVisible()
  await expect.poll(width).toBeGreaterThan(original + 60)
})

test('sidebar switches directly between drawings and creates a blank session in the chosen module', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const state = await mockServices(page)
  await openGeometrySession(page)
  const sessions = page.getByRole('region', { name: '侧栏会话' })
  await expect(sessions.getByRole('link', { name: '几何甲' })).toHaveAttribute('aria-current', 'page')
  state.failSave = 'geometry-a'
  await page.evaluate((edited) => window.editBoard(edited), xml('A-sidebar-edit'))
  await sessions.getByRole('link', { name: '几何乙' }).click()
  await expect(page).toHaveURL(/session=geometry-b$/)
  await expect.poll(() => page.evaluate(() => window.boardXml)).toBe(xml('B'))
  await expect(page.locator('.transcript')).toContainText('几何乙的问题')
  await expect(sessions.getByRole('link', { name: '几何乙' })).toHaveAttribute('aria-current', 'page')
  expect(await page.evaluate(() => window.boardMounts)).toBeGreaterThan(1)
  await sessions.getByRole('link', { name: '几何甲' }).click()
  await expect.poll(() => page.evaluate(() => window.boardXml)).toBe(xml('A-sidebar-edit'))
  await sessions.getByRole('combobox', { name: '会话模块' }).selectOption('probability')
  await expect(sessions.getByRole('link', { name: '分布题' })).toBeVisible()
  await expect(sessions.getByRole('link', { name: '几何甲' })).toHaveCount(0)
  await sessions.getByRole('button', { name: '新建概率会话' }).click()
  await expect(page).toHaveURL(/session=new-session$/)
  await expect(page.getByLabel('描述你的问题')).toBeEnabled()
  expect(state.records.find(item => item.id === 'new-session')).toMatchObject({ mode: 'probability', messages: [], report: null })
  await expect.poll(() => page.evaluate(() => window.boardXml)).toBe('<geogebra><construction/></geogebra>')
})

test('mobile navigation offers history and new sessions for the signed-in user', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const state = await mockServices(page)
  await openGeometrySession(page)
  const menu = page.getByRole('dialog', { name: '导航菜单' })
  const sessions = menu.getByRole('region', { name: '侧栏会话' })
  await page.getByRole('button', { name: '打开导航' }).click()
  await sessions.getByRole('combobox', { name: '会话模块' }).selectOption('scientific')
  await sessions.getByRole('link', { name: '对数题' }).click()
  await expect(page).toHaveURL(/session=calculator-a$/)
  await expect(menu).toBeHidden()
  await expect.poll(() => page.evaluate(() => window.boardXml)).toBe(xml('E'))
  await page.getByRole('button', { name: '打开导航' }).click()
  await sessions.getByRole('button', { name: '新建计算器会话' }).click()
  await expect(page).toHaveURL(/session=new-session$/)
  await expect(menu).toBeHidden()
  expect(state.records.find(item => item.id === 'new-session').mode).toBe('scientific')
})

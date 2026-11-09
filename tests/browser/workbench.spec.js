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
    id, name, mode, owner: owner.id, input: '', messages: [{ role: 'user', content: `${name}的问题` }],
    report: { boardXml: xml(label), objects: [], results: [], hint: '' },
  }))
  const state = { records, failSave: '' }
  await page.route('**/api/config', route => route.fulfill({ json: { pbUrl: 'http://pb.test' } }))
  await page.route('**/api/status', route => route.fulfill({ json: { configured: true, model: 'test' } }))
  await page.route('**/api/models', route => route.fulfill({ json: [{ id: 'test', label: '数学模型', gateway: false }] }))
  await page.route('http://pb.test/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path.endsWith('/auth-with-password') || path.endsWith('/auth-refresh') || path === '/api/auth/register') {
      return route.fulfill({ json: auth })
    }
    if (path === '/api/auth/request-code') return route.fulfill({ json: { ok: true } })
    if (request.headers().authorization !== token) return route.fulfill({ status: 403, json: { message: '登录后查看会话' } })
    if (path === '/api/usage/summary') return route.fulfill({ json: { requests: 0, tokens: 0, sessions: records.length, days: [], models: [] } })
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
    return route.fulfill({ json: record })
  })
  await page.route('**/deployggb.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.GGBApplet = class {
      constructor(options) { this.options = options }
      setHTML5Codebase() {}
      inject() {
        let notify
        window.boardXml = '<geogebra><construction/></geogebra>'
        window.editBoard = xml => { window.boardXml = xml; notify?.() }
        this.options.appletOnLoad({
          setErrorDialogsActive() {}, setSize() {}, setAxesVisible() {}, setGridVisible() {},
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
  await page.getByLabel('会话名称').fill('新的空间会话')
  await page.getByRole('button', { name: '新建会话' }).click()
  await expect(page).toHaveURL(/\/workspace\?session=new-session$/)
  await expect(page.getByText('当前会话 新的空间会话')).toBeVisible()
  await expect(page.getByLabel('描述你的问题')).toBeEnabled()
  expect(state.records.find(item => item.id === 'new-session')).toMatchObject({ mode: '3d', messages: [] })
  await expect.poll(() => page.evaluate(() => window.boardXml)).toBe('<geogebra><construction/></geogebra>')
})

import { test, expect } from '@playwright/test'

const testAccount = { id: 'design-user', name: '数学探索者', email: 'math@example.test', model: 'test' }
const sampleSessions = ['三角形与高线', '圆与切线', '二次函数与直线的交点', '等腰三角形的中线', '平行四边形的对角线']
  .map((name, index) => ({
    id: `session-${index}`, name, mode: 'geometry', messages: [], report: null,
    updated: `2026-11-0${9 - index} 09:30:00.000Z`,
  }))

async function mockServices(page, authenticated = false) {
  if (authenticated) {
    const token = `x.${Buffer.from(JSON.stringify({ exp: 4102444800 })).toString('base64url')}.x`
    await page.addInitScript(auth => localStorage.setItem('pocketbase_auth', JSON.stringify(auth)), { token, record: testAccount })
  }
  await page.route('**/api/config', route => route.fulfill({ json: { pbUrl: 'http://pb.test' } }))
  await page.route('**/api/status', route => route.fulfill({ json: { configured: true, model: 'test' } }))
  await page.route('**/api/models', route => route.fulfill({ json: [
    { id: 'test', label: '数学模型', gateway: false },
    { id: 'via-gateway', label: '推理模型（网关）', gateway: true },
  ] }))
  await page.route('**/api/gateway', route => route.fulfill({ json: { items: [
    { id: 'via-gateway', label: '推理模型', endpoint: 'https://gateway.example.test/v1' },
  ] } }))
  await page.route('http://pb.test/**', route => route.fulfill({ json: route.request().url().includes('/usage/summary')
    ? {
        requests: 21, sessions: sampleSessions.length, tokens: 7826, gatewayMonth: { models: [] },
        days: [1, 4, 0, 2, 5, 3, 6].map((requests, index) => ({ date: `2026-11-0${index + 3}`, requests })),
        models: [{ model: 'test', requests: 21, tokens: 7826 }],
      }
    : { page: 1, perPage: 100, totalItems: sampleSessions.length, totalPages: 1, items: sampleSessions } }))
  await page.route('**/deployggb.js', route => route.fulfill({ contentType: 'application/javascript', body: `window.GGBApplet=class {
    constructor(options){this.options=options;window.injectCount=(window.injectCount||0)+1} setHTML5Codebase(){}
    inject(){this.options.appletOnLoad({setErrorDialogsActive(){},setSize(w,h){window.lastBoardSize=[w,h]},setAxesVisible(){},setGridVisible(){},getAllObjectNames(){return []},getXML(){return '<geogebra><construction/></geogebra>'}})}
  }` }))
}

test('mobile tabs preserve the board and draft; navigation and theme work', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockServices(page)
  await page.goto('/try')
  await expect(page.locator('textarea')).toBeEnabled()
  await page.locator('textarea').fill('保留我的作图问题')
  const mounts = await page.evaluate(() => window.injectCount)
  await page.getByRole('button', { name: '画板', exact: true }).click()
  await expect(page.locator('.board-frame')).toBeVisible()
  await expect(page.locator('.conversation')).toBeHidden()
  await page.getByRole('button', { name: '对话', exact: true }).click()
  await expect(page.locator('textarea')).toHaveValue('保留我的作图问题')
  expect(await page.evaluate(() => window.injectCount)).toBe(mounts)
  await page.getByRole('button', { name: '切换深色' }).click()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: '打开导航' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.screenshot({ path: 'test-results/redesign-mobile.png' })
})

test('desktop settings open separate pages and accept old section links', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockServices(page, true)
  await page.goto('/settings')
  await expect(page).toHaveURL(/\/settings\/models$/)
  const main = page.getByRole('main')
  const nav = main.getByRole('navigation', { name: '设置分类' })
  await expect(main.getByRole('heading', { name: '模型偏好' })).toBeVisible()
  await expect(main.getByRole('heading', { name: '账户安全' })).toHaveCount(0)
  await nav.getByRole('link', { name: '账户安全' }).click()
  await expect(page).toHaveURL(/\/settings\/security$/)
  await expect(main.getByRole('heading', { name: '账户安全' })).toBeVisible()
  await expect(main.getByRole('heading', { name: '模型偏好' })).toHaveCount(0)
  await page.reload()
  await expect(nav.getByRole('link', { name: '账户安全' })).toHaveAttribute('aria-current', 'page')
  await page.goBack()
  await expect(page).toHaveURL(/\/settings\/models$/)
  await page.goto('/settings#data')
  await expect(page).toHaveURL(/\/settings\/data$/)
  await expect(main.getByRole('heading', { name: '数据管理' })).toBeVisible()
  await expect(main.getByRole('button', { name: '删除账号' })).toBeVisible()
})

test('mobile settings navigate from the category list to a detail page and back', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockServices(page, true)
  await page.goto('/settings')
  const nav = page.getByRole('navigation', { name: '设置分类' })
  await expect(nav).toBeVisible()
  await expect(page.getByRole('heading', { name: '模型偏好' })).toHaveCount(0)
  await nav.getByRole('link', { name: /数据管理/ }).click()
  await expect(page).toHaveURL(/\/settings\/data$/)
  await expect(page.getByRole('heading', { name: '数据管理' })).toBeVisible()
  await expect(nav).toBeHidden()
  await page.getByRole('link', { name: '返回设置' }).click()
  await expect(page).toHaveURL(/\/settings$/)
  await expect(nav).toBeVisible()
})

test('model settings save the selection, show connection results, and collapse gateway details', async ({ page }) => {
  await mockServices(page, true)
  const savedModels = []
  await page.route('http://pb.test/api/collections/users/records/design-user', async route => {
    const { model } = route.request().postDataJSON()
    savedModels.push(model)
    await route.fulfill({ json: { ...testAccount, model } })
  })
  await page.route('**/api/models/test', route => route.fulfill({ json: { ok: true, latencyMs: 37 } }))
  await page.goto('/settings/models')
  const model = page.getByLabel('默认模型')
  await expect(model).toHaveValue('test')
  await model.selectOption('via-gateway')
  await expect(page.getByText('默认模型已保存，下次请求生效')).toBeVisible()
  expect(savedModels).toEqual(['via-gateway'])
  await page.getByRole('button', { name: '测试连接 推理模型' }).click()
  await expect(page.getByText('已连通，37 ms')).toBeVisible()
  const endpoint = page.getByText('https://gateway.example.test/v1')
  await expect(endpoint).toBeHidden()
  await page.getByText('网关详情').click()
  await expect(endpoint).toBeVisible()
})

test('security forms open individually and data actions remain available', async ({ page }) => {
  await mockServices(page, true)
  await page.route('http://pb.test/api/collections/users/records/design-user', route => route.fulfill({
    json: { ...testAccount, ...route.request().postDataJSON() },
  }))
  await page.goto('/settings/security')
  const main = page.getByRole('main')
  await expect(main.getByLabel('昵称')).toHaveCount(0)
  await main.getByRole('button', { name: '编辑昵称' }).click()
  await main.getByLabel('昵称').fill('几何观察者')
  await main.getByRole('button', { name: '保存昵称' }).click()
  await expect(main.getByText('昵称已更新')).toBeVisible()
  await expect(main.getByText('几何观察者')).toBeVisible()
  await main.getByRole('button', { name: '更换邮箱' }).click()
  await expect(main.getByLabel('新邮箱', { exact: true })).toBeVisible()
  await main.getByRole('button', { name: '修改密码' }).click()
  await expect(main.getByLabel('新邮箱', { exact: true })).toHaveCount(0)
  await expect(main.getByLabel('当前密码')).toBeVisible()
  await main.getByRole('link', { name: '数据管理' }).click()
  const download = page.waitForEvent('download')
  await main.getByRole('button', { name: '导出全部会话' }).click()
  expect((await download).suggestedFilename()).toBe('aiggb-sessions.json')
  await expect(main.getByText('已导出全部会话')).toBeVisible()
  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain('云端会话和用量记录')
    await dialog.dismiss()
  })
  await main.getByRole('button', { name: '删除账号' }).click()
  await expect(page).toHaveURL(/\/settings\/data$/)
})

for (const width of [1440, 768, 390, 320]) {
  test(`account and data pages fit at ${width}px`, async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await mockServices(page, true)
    await page.setViewportSize({ width, height: 960 })
    for (const route of ['/', '/dashboard', '/settings', '/settings/models', '/settings/security', '/settings/data', '/login', '/register', '/forgot', '/privacy', '/terms', '/missing-page']) {
      await page.goto(route)
      await expect(page.locator('main')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
      if (route === '/dashboard') {
        await expect(page.locator('.session-list')).toContainText('三角形与高线')
        const main = page.getByRole('main')
        await expect(main.getByRole('listitem', { name: '2026-11-09，6 次请求' })).toBeVisible()
        const history = await main.getByRole('region', { name: '历史会话' }).boundingBox()
        const trend = await main.getByRole('region', { name: '近 7 天请求' }).boundingBox()
        if (width === 1440) expect(trend.x + trend.width).toBeLessThan(history.x)
        else expect(history.y + history.height).toBeLessThan(trend.y)
        const search = main.getByRole('searchbox', { name: '搜索会话' })
        await search.fill('不存在')
        await expect(page.getByText('没有找到相关会话')).toBeVisible()
        await search.fill('')
        await search.blur()
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
      }
      if (['/login', '/register', '/forgot'].includes(route)) {
        await expect(page.getByRole('link', { name: 'AI GeoGebra 首页' })).toBeVisible()
        if (width === 1440) {
          const story = await page.getByRole('region', { name: '关于 AI GeoGebra' }).boundingBox()
          const form = await page.getByRole('main').boundingBox()
          expect(story.x + story.width).toBeLessThan(form.x)
        }
      }
      if (width === 1440 || width === 390) await page.screenshot({ path: `test-results/redesign-${route.slice(1).replaceAll('/', '-')}-${width}.png`, fullPage: true })
    }
    expect(errors).toEqual([])
  })
}

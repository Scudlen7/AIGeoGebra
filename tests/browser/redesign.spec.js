import { test, expect } from '@playwright/test'

async function mockServices(page, authenticated = false) {
  if (authenticated) {
    const token = `x.${Buffer.from(JSON.stringify({ exp: 4102444800 })).toString('base64url')}.x`
    await page.addInitScript(token => localStorage.setItem('pocketbase_auth', JSON.stringify({ token, record: { id: 'design-user', name: '数学探索者', model: 'test' } })), token)
  }
  await page.route('**/api/config', route => route.fulfill({ json: { pbUrl: 'http://pb.test' } }))
  await page.route('**/api/status', route => route.fulfill({ json: { configured: true, model: 'test' } }))
  await page.route('**/api/models', route => route.fulfill({ json: [{ id: 'test', label: '数学模型', gateway: false }] }))
  await page.route('**/api/gateway', route => route.fulfill({ json: { items: [] } }))
  await page.route('http://pb.test/**', route => route.fulfill({ json: route.request().url().includes('/usage/summary')
    ? { requests: 7, sessions: 1, tokens: 2536, days: [], models: [], gatewayMonth: { models: [] } }
    : { page: 1, perPage: 100, totalItems: 1, totalPages: 1, items: [{ id: 'session', name: '三角形与高线', mode: 'geometry', messages: [], report: null }] } }))
  await page.route('**/deployggb.js', route => route.fulfill({ contentType: 'application/javascript', body: `window.GGBApplet=class {
    constructor(options){this.options=options;window.injectCount=(window.injectCount||0)+1} setHTML5Codebase(){}
    inject(){this.options.appletOnLoad({setErrorDialogsActive(){},setSize(w,h){window.lastBoardSize=[w,h]},setAxesVisible(){},setGridVisible(){},getAllObjectNames(){return []},getXML(){return '<geogebra><construction/></geogebra>'}})}
  }` }))
}

test('mobile tabs preserve the board and draft; navigation and theme work', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockServices(page)
  await page.goto('/')
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

for (const width of [1440, 768, 390, 320]) {
  test(`account and data pages fit at ${width}px`, async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await mockServices(page, true)
    await page.setViewportSize({ width, height: 960 })
    for (const route of ['/dashboard', '/settings', '/login', '/register', '/forgot', '/privacy', '/terms', '/missing-page']) {
      await page.goto(route)
      await expect(page.locator('main')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
      if (route === '/dashboard') {
        await expect(page.locator('.session-list')).toContainText('三角形与高线')
        await page.getByRole('searchbox', { name: '搜索会话' }).fill('不存在')
        await expect(page.getByText('没有找到相关会话')).toBeVisible()
        await page.getByRole('searchbox').fill('')
      }
      if (width === 1440 || width === 390) await page.screenshot({ path: `test-results/redesign-${route.slice(1)}-${width}.png`, fullPage: true })
    }
    expect(errors).toEqual([])
  })
}

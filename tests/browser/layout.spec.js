import { test, expect } from '@playwright/test'

for (const width of [1440, 1024, 390, 320]) {
  test(`workspace layout and stable automatic sync at ${width}px`, async ({ page }) => {
    let failSave = false
    await page.setViewportSize({ width, height: 900 })
    const token = `x.${Buffer.from(JSON.stringify({ exp: 4102444800 })).toString('base64url')}.x`
    await page.addInitScript(({ token }) => localStorage.setItem('pocketbase_auth', JSON.stringify({ token, record: { id: 'layout-user', name: '测试用户', model: 'test' } })), { token })
    await page.route('**/api/config', route => route.fulfill({ json: { pbUrl: 'http://pb.test' } }))
    await page.route('**/api/status', route => route.fulfill({ json: { configured: true, model: 'test' } }))
    await page.route('**/api/models', route => route.fulfill({ json: [{ id: 'test', label: '一个用于检查长名称布局的测试模型', gateway: false }] }))
    await page.route('http://pb.test/**', async route => {
      const data = route.request().postDataJSON()
      const perPage = Number(new URL(route.request().url()).searchParams.get('perPage')) || 1
      if (failSave && route.request().method() !== 'GET') return route.fulfill({ status: 503, json: { message: '云端暂时不可用，已保留本机待同步副本，请稍后重试同步' } })
      await route.fulfill({ json: route.request().method() === 'GET'
        ? { page: 1, perPage, totalItems: 1, totalPages: 1, items: [{ id: 'session', name: '一个很长的数学会话名称用于验证标题截断和导航布局', mode: 'geometry', messages: [], input: '', report: null }] }
        : { ...data, id: 'session' } })
    })
    await page.route('**/deployggb.js', route => route.fulfill({ contentType: 'application/javascript', body: `window.GGBApplet=class {
      constructor(options){this.options=options} setHTML5Codebase(){}
      inject(){this.options.appletOnLoad({setErrorDialogsActive(){},setSize(w,h){window.lastBoardSize=[w,h]},setAxesVisible(){},setGridVisible(){},getAllObjectNames(){return []},getXML(){return '<geogebra><construction/></geogebra>'}})}
    }` }))
    await page.goto('/workspace')
    await expect(page.locator('textarea')).toBeEnabled()
    await expect(page.locator('.session-name')).toBeVisible()
    if (width === 1440) await expect(page.locator('.sidebar-history a')).toBeVisible()
    await expect(page.locator('.composer').getByRole('button', { name: /^当前模型/ })).toBeVisible()
    const topbar = page.locator('.workspace-topbar')
    const height = (await topbar.boundingBox()).height
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    expect(height).toBeLessThan(width > 860 ? 76 : 118)
    await page.evaluate(() => {
      window.retryAppeared = false
      new MutationObserver(() => {
        if ([...document.querySelectorAll('.workspace-identity button')].some(el => el.textContent.includes('重试同步'))) window.retryAppeared = true
      }).observe(document.querySelector('.workspace-identity'), { childList: true, subtree: true, characterData: true })
    })
    await page.locator('textarea').fill('编辑中的草稿')
    await expect(page.getByRole('button', { name: '重试同步' })).toHaveCount(0)
    await expect(page.getByText('已同步到云端', { exact: true })).toBeVisible()
    expect((await topbar.boundingBox()).height).toBe(height)
    expect(await page.evaluate(() => window.retryAppeared)).toBe(false)
    await page.screenshot({ path: `test-results/workspace-${width}.png` })
    failSave = true
    await page.locator('textarea').fill('断网期间的新草稿')
    const retry = page.getByRole('button', { name: '重试同步', exact: true })
    await expect(retry).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    failSave = false
    await retry.click()
    await expect(retry).toHaveCount(0)
    await expect(page.getByText('已同步到云端', { exact: true })).toBeVisible()
    await page.setViewportSize({ width: width === 320 ? 390 : Math.max(320, width - 100), height: 800 })
    await expect.poll(() => page.evaluate(() => {
      const frame = document.querySelector('.board-frame')
      return window.lastBoardSize?.[0] === Math.floor(frame.clientWidth)
    })).toBe(true)
  })
}

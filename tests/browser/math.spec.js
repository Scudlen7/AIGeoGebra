import { test, expect } from '@playwright/test'
import { mkdir, appendFile } from 'node:fs/promises'
import { mathCases } from '../math-cases.mjs'

const live = process.env.LIVE_LLM === '1'
const enabled = live || process.env.LIVE_GEOGEBRA === '1'
const labels = { geometry: '几何', '3d': '3D', probability: '概率', scientific: '计算器' }

for (const mode of Object.keys(labels)) {
  test.describe(`${mode} real GeoGebra acceptance`, () => {
    test.skip(!enabled, 'Opt in with LIVE_GEOGEBRA=1 or LIVE_LLM=1; live LLM calls use the configured local model.')
    let page, context, model
    test.beforeAll(async ({ browser }) => {
      test.setTimeout(180000)
      context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      page = await context.newPage()
      // Use guest mode: live model testing must not write to an existing account.
      await page.route('**/api/config', route => route.fulfill({ json: { pbUrl: '' } }))
      await page.goto('/try')
      if (mode !== 'geometry') await page.getByRole('button', { name: labels[mode], exact: true }).click()
      await expect(page.locator('.conversation textarea')).toBeEnabled({ timeout: 120000 })
      await expect(page.locator('#composer-board-status')).toHaveCount(0, { timeout: 120000 })
      model = (await (await page.request.get('/api/status')).json()).model
      if (live) expect(model).toBeTruthy()
    })
    test.afterAll(async () => { await context?.close() })
    for (const fixture of mathCases.filter(item => item.mode === mode)) {
      test(fixture.id + ': ' + fixture.prompt, async ({}, testInfo) => {
        test.setTimeout(180000)
        const result = await page.evaluate(async ({ fixture, live, model }) => {
          const board = await import('/src/board.ts')
          const { runTurn } = await import('/src/chat.ts')
          board.resetBoard()
          const reports = []
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 120000)
          let error = ''
          try {
            if (live) await runTurn({ mode: fixture.mode, angleUnit: fixture.angleUnit || 'degree', model,
              messages: [{ role: 'user', content: fixture.prompt }], signal: controller.signal,
              onText() {}, onReport(report) { reports.push(report) },
            })
            else reports.push(board.executeCommands(fixture.commands, fixture.mode, { angleUnit: fixture.angleUnit || 'degree', enforceAngle: true }))
          } catch (reason) { error = String(reason) }
          finally { clearTimeout(timeout) }
          const api = board.getApi()
          const values = Object.fromEntries(Object.keys(fixture.values || {}).map(name => [name, api.getValue(name)]))
          const points = Object.fromEntries(Object.entries(fixture.points || {}).map(([name, coordinates]) => [name,
            [api.getXcoord(name), api.getYcoord(name), ...(coordinates.length === 3 ? [api.getZcoord(name)] : [])],
          ]))
          return { id: fixture.id, mode: fixture.mode, model, error, reports, values, points }
        }, { fixture, live, model })
        const final = result.reports.at(-1)
        let valid = !result.error && !!final && final.results.every(item => item.status === 'ok')
        for (const [name, expected] of Object.entries(fixture.values || {})) valid &&= Number.isFinite(result.values[name]) && Math.abs(result.values[name] - expected) < 1e-6
        for (const [name, expected] of Object.entries(fixture.points || {})) valid &&= expected.every((value, index) => Number.isFinite(result.points[name][index]) && Math.abs(result.points[name][index] - value) < 1e-6)
        result.outcome = valid ? result.reports.length > 1 ? 'corrected' : 'first-pass' : 'failed'
        await mkdir('test-results', { recursive: true })
        await appendFile(`test-results/math-${live ? 'live' : 'reference'}.jsonl`, JSON.stringify(result) + '\n')
        await testInfo.attach('math-result', { body: JSON.stringify(result, null, 2), contentType: 'application/json' })
        if (!valid) await page.screenshot({ path: `test-results/math-${fixture.id}.png` })
        expect(valid, JSON.stringify(result)).toBe(true)
      })
    }
  })
}

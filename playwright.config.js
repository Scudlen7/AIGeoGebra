import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  timeout: 90000,
  use: { baseURL: 'http://127.0.0.1:5174', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5174 --strictPort', url: 'http://127.0.0.1:5174', reuseExistingServer: !process.env.CI },
})

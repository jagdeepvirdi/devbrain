import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir:   './e2e',
  timeout:   30_000,
  retries:   process.env.CI ? 2 : 0,
  workers:   process.env.CI ? 1 : undefined,
  reporter:  [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  outputDir: 'test-results',

  use: {
    baseURL:           'http://localhost:5174',
    screenshot:        'only-on-failure',
    trace:             'on-first-retry',
    video:             'off',
    actionTimeout:     10_000,
    navigationTimeout: 15_000,
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  // Auto-start the Vite dev server.
  // The Express API server (port 3001) must be running separately before tests.
  webServer: {
    command:              'npm run dev',
    url:                  'http://localhost:5174',
    reuseExistingServer:  !process.env.CI,
    timeout:              60_000,
  },
})

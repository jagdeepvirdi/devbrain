import { type Page } from '@playwright/test'

export const TEST_USERNAME = process.env.TEST_USERNAME ?? 'admin'
export const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'devbrain'

/** Returns true if the app is in dev mode (no auth required). */
export async function isDevMode(page: Page): Promise<boolean> {
  return !(await page.locator('input[type="password"]').isVisible({ timeout: 2_000 }).catch(() => false))
}

/** Log in if auth is enabled; no-op in dev mode. */
export async function ensureLoggedIn(page: Page): Promise<void> {
  await page.goto('/')
  // Wait for either the login form or the authenticated app shell
  await page.waitForSelector('form, .app', { timeout: 10_000 })
  if (await page.locator('input[type="password"]').isVisible()) {
    await page.getByPlaceholder('username').fill(TEST_USERNAME)
    await page.getByPlaceholder('password').fill(TEST_PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForSelector('.app', { timeout: 10_000 })
  }
}

/** Navigate to a sidebar section by its label. */
export async function goTo(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: label }).click()
}

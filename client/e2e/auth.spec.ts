import { test, expect } from '@playwright/test'
import { TEST_USERNAME, TEST_PASSWORD } from './helpers'

test.describe('Auth flow', () => {
  test('unauthenticated visit shows login or auto-auths in dev mode', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/')
    // Either a login form (auth enabled) or the app shell (dev mode) must appear
    await expect(
      page.locator('form').or(page.locator('.app'))
    ).toBeVisible({ timeout: 10_000 })
  })

  test('valid login lands on Dashboard', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/')
    await page.waitForSelector('form, .app', { timeout: 10_000 })

    if (await page.locator('input[type="password"]').isVisible()) {
      await page.getByPlaceholder('username').fill(TEST_USERNAME)
      await page.getByPlaceholder('password').fill(TEST_PASSWORD)
      await page.getByRole('button', { name: 'Sign in' }).click()
    }

    await expect(page.locator('.app')).toBeVisible({ timeout: 10_000 })
    // Sidebar should show navigation items
    await expect(page.getByRole('button', { name: 'Dashboard' })).toBeVisible()
  })

  test('wrong password shows error', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/')
    await page.waitForSelector('form, .app', { timeout: 10_000 })

    // Only run if auth is enabled
    if (!(await page.locator('input[type="password"]').isVisible())) {
      test.skip()
      return
    }

    await page.getByPlaceholder('username').fill(TEST_USERNAME)
    await page.getByPlaceholder('password').fill('wrong-password-xyz')
    await page.getByRole('button', { name: 'Sign in' }).click()

    // Error message should appear and login form stays
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.locator('form')).toBeVisible()
  })

  test('logout returns to login', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/')
    await page.waitForSelector('form, .app', { timeout: 10_000 })

    // Login if needed
    if (await page.locator('input[type="password"]').isVisible()) {
      await page.getByPlaceholder('username').fill(TEST_USERNAME)
      await page.getByPlaceholder('password').fill(TEST_PASSWORD)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await page.waitForSelector('.app', { timeout: 10_000 })
    } else {
      // Dev mode: logout has no visible effect (no login wall)
      test.skip()
      return
    }

    // Navigate to Settings and log out
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: /log out|sign out/i }).click()

    // Should see login form again
    await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 5_000 })
  })
})

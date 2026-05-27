import { test, expect } from '@playwright/test'
import { ensureLoggedIn } from './helpers'

test.describe('Global search (⌘K)', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page)
  })

  test('⌘K opens search modal', async ({ page }) => {
    await page.keyboard.press('Control+k')

    // Search input should appear
    const searchInput = page.getByPlaceholder(/search/i).first()
    await expect(searchInput).toBeVisible({ timeout: 5_000 })
  })

  test('clicking the search bar opens the modal', async ({ page }) => {
    // The top bar has a search button
    const searchTrigger = page.getByText(/search docs, issues, commands/i)
    await expect(searchTrigger).toBeVisible()
    await searchTrigger.click()

    const searchInput = page.getByPlaceholder(/search/i).first()
    await expect(searchInput).toBeVisible({ timeout: 5_000 })
  })

  test('empty state shows recent items', async ({ page }) => {
    await page.keyboard.press('Control+k')
    // With empty query the search should show recent items grouped by type
    await expect(
      page.locator('[data-search-results], [role="listbox"], [role="list"]').first()
    ).toBeVisible({ timeout: 5_000 })
  })

  test('typing a query returns results across entity types', async ({ page }) => {
    await page.keyboard.press('Control+k')

    const searchInput = page.getByPlaceholder(/search/i).first()
    await expect(searchInput).toBeVisible({ timeout: 5_000 })

    await searchInput.fill('test')

    // After a short delay, results should appear (or an empty state)
    await page.waitForTimeout(800)
    const results = page.locator('[data-search-results], [role="listbox"], [role="option"]')
    await expect(results.first()).toBeVisible({ timeout: 5_000 })
  })

  test('Escape closes the search modal', async ({ page }) => {
    await page.keyboard.press('Control+k')

    const searchInput = page.getByPlaceholder(/search/i).first()
    await expect(searchInput).toBeVisible({ timeout: 5_000 })

    await page.keyboard.press('Escape')
    await expect(searchInput).not.toBeVisible({ timeout: 3_000 })
  })
})

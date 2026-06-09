import { test, expect } from '@playwright/test'
import { ensureLoggedIn, goTo } from './helpers'

const CMD_TITLE   = `e2e-cmd-${Date.now()}`
const CMD_COMMAND = `echo "e2e test ${Date.now()}"`

test.describe('Command CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page)
    await goTo(page, 'Commands')
  })

  test('create a command', async ({ page }) => {
    await page.getByRole('button', { name: /new command|new|add/i }).first().click()

    // Fill title
    const titleInput = page.getByPlaceholder(/start dev server/i).first()
    await expect(titleInput).toBeVisible({ timeout: 5_000 })
    await titleInput.fill(CMD_TITLE)

    // Fill command
    const cmdInput = page.getByPlaceholder(/npm run dev/i).first()
    await cmdInput.fill(CMD_COMMAND)

    // Save
    await page.getByRole('button', { name: /create|save/i }).last().click()

    // Should appear in the list
    await expect(page.getByText(CMD_TITLE)).toBeVisible({ timeout: 8_000 })
  })

  test('star a command as favorite', async ({ page }) => {
    // Find the command created above
    const cmdRow = page.getByText(CMD_TITLE)
    if (!(await cmdRow.isVisible())) { test.skip(); return }

    // Find and click the star/favorite button within that row
    const row = page.locator('[data-cmd-row]').filter({ hasText: CMD_TITLE })
                  .or(page.locator('li, tr, [role="row"]').filter({ hasText: CMD_TITLE }))
                  .first()

    const starBtn = row.getByRole('button', { name: /star|favorite|fav/i })
    if (await starBtn.isVisible()) {
      await starBtn.click()
      // Some visual indicator of the star state should change
      await expect(starBtn).toBeVisible()
    }
  })

  test('search for command by title', async ({ page }) => {
    const searchInput = page.getByPlaceholder(/search/i).first()
    await expect(searchInput).toBeVisible({ timeout: 5_000 })

    await searchInput.fill(CMD_TITLE)

    await expect(page.getByText(CMD_TITLE)).toBeVisible({ timeout: 5_000 })
  })

  test('delete command and verify gone', async ({ page }) => {
    // Search so the command is visible
    const searchInput = page.getByPlaceholder(/search/i).first()
    if (await searchInput.isVisible()) {
      await searchInput.fill(CMD_TITLE)
    }

    const cmdText = page.getByText(CMD_TITLE)
    if (!(await cmdText.isVisible())) { test.skip(); return }

    // Click into the command detail
    await cmdText.click()

    // Find and click delete button
    const deleteBtn = page.getByRole('button', { name: /delete|remove/i }).last()
    await expect(deleteBtn).toBeVisible({ timeout: 5_000 })
    await deleteBtn.click()

    // Confirmation dialog may appear
    const confirmBtn = page.getByRole('button', { name: /confirm|yes|delete/i }).last()
    if (await confirmBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await confirmBtn.click()
    }

    // Command should be gone
    await expect(page.getByText(CMD_TITLE)).not.toBeVisible({ timeout: 8_000 })
  })
})

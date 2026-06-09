import { test, expect } from '@playwright/test'
import { ensureLoggedIn, goTo } from './helpers'

const ISSUE_TITLE = `E2E issue ${Date.now()}`

test.describe('Issue lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page)
    await goTo(page, 'Issues')
  })

  test('create issue appears in list', async ({ page }) => {
    // Open new issue modal
    await page.getByRole('button', { name: /new issue|new/i }).first().click()

    // Fill in the form
    await page.getByPlaceholder(/title/i).fill(ISSUE_TITLE)
    await page.getByPlaceholder(/description/i).fill('E2E test issue description')

    // Save
    await page.getByRole('button', { name: /create|save/i }).last().click()

    // Issue should appear in the list
    await expect(page.getByText(ISSUE_TITLE)).toBeVisible({ timeout: 8_000 })
  })

  test('open issue detail and add a note', async ({ page }) => {
    // Click on the issue created in previous test (or any existing open issue)
    const issueRow = page.getByText(ISSUE_TITLE)
    if (await issueRow.isVisible()) {
      await issueRow.click()
    } else {
      // Fall back to first available issue
      const firstIssue = page.locator('[data-issue-row]').first()
      if (!(await firstIssue.isVisible())) { test.skip(); return }
      await firstIssue.click()
    }

    // Detail panel should open
    await expect(page.getByPlaceholder(/add a note/i)).toBeVisible({ timeout: 5_000 })

    // Add note
    const noteText = `Note added at ${Date.now()}`
    await page.getByPlaceholder(/add a note/i).fill(noteText)
    await page.getByRole('button', { name: /add note|save note/i }).click()

    // Note should appear
    await expect(page.getByText(noteText)).toBeVisible({ timeout: 5_000 })
  })

  test('change status to resolved', async ({ page }) => {
    // Navigate into the issue
    const issueRow = page.getByText(ISSUE_TITLE)
    if (await issueRow.isVisible()) {
      await issueRow.click()
    } else {
      test.skip()
      return
    }

    // Find and change the status selector
    const statusBtn = page.getByRole('button', { name: /open|investigating|resolved/i }).first()
    await expect(statusBtn).toBeVisible({ timeout: 5_000 })

    // Click the status to open the dropdown/selector
    await statusBtn.click()

    // Select "resolved"
    await page.getByRole('button', { name: /resolved/i }).last().click()

    // Status chip should now show "resolved"
    await expect(page.getByText(/resolved/i).first()).toBeVisible({ timeout: 5_000 })
  })
})

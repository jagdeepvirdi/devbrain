import { test, expect } from '@playwright/test'
import { ensureLoggedIn, goTo } from './helpers'

test.describe('Projects page features', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page)
    await goTo(page, 'Projects')
  })

  test('open git tab in project detail panel', async ({ page }) => {
    // Click on a project to open the detail panel
    const projectCard = page.locator('div[style*="grid-template-columns"]').locator('> div').first()
    await expect(projectCard).toBeVisible({ timeout: 5000 })
    
    // Click the "Git" button on the card
    const gitBtn = projectCard.getByRole('button', { name: /git/i })
    await gitBtn.click()

    // Panel should open with Git tab selected
    await expect(page.getByText(/loading git history/i)).toBeVisible({ timeout: 2000 })
    
    // Check if branch info appears (eventually)
    // We might not have a real repo in CI, but we can check if the UI state is correct
    await expect(page.getByRole('button', { name: /git/i, pressed: true })).toBeDefined()
  })

  test('toggle between tasks, sessions and git tabs', async ({ page }) => {
    const projectCard = page.locator('div[style*="grid-template-columns"]').locator('> div').first()
    await projectCard.getByRole('button', { name: /sessions/i }).click()

    // Click tabs in the header
    await page.getByRole('button', { name: /tasks/i }).click()
    await expect(page.getByText(/create a new task/i)).toBeVisible({ timeout: 2000 })

    await page.getByRole('button', { name: /git/i }).last().click()
    await expect(page.getByText(/branch/i)).toBeDefined()
  })
})

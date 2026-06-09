import { test, expect } from '@playwright/test'
import { ensureLoggedIn, goTo } from './helpers'

test.describe('Org Sharing & Multi-user', () => {
  test('viewer role should have restricted UI', async ({ page }) => {
    // We assume the test runner can handle multiple users or we mock the 'me' response
    // For this E2E, we'll test as admin first, then ideally a viewer.
    // If our helpers only support one login, we might need to extend them.
    await ensureLoggedIn(page)
    await goTo(page, 'Settings')
    
    // Admin should see User Management
    await expect(page.getByText(/user management/i)).toBeVisible()

    // TBD: Test as viewer. This requires a way to switch users in E2E.
  })

  test('audit log filtering', async ({ page }) => {
    await ensureLoggedIn(page)
    await goTo(page, 'Settings')

    // Scroll to Audit Log
    const auditSection = page.getByText(/audit log/i)
    await auditSection.scrollIntoViewIfNeeded()

    // Change filter
    const filter = page.locator('select').filter({ hasText: /all entities/i })
    await filter.selectOption('project')
    
    // Should show project events
    await expect(page.getByText(/project/i).first()).toBeVisible()
  })

  test('invite user flow', async ({ page }) => {
    await ensureLoggedIn(page)
    await goTo(page, 'Settings')

    await page.getByRole('button', { name: /invite user/i }).click()
    
    const email = `test-${Date.now()}@example.com`
    await page.getByPlaceholder(/email@org.com/i).fill(email)
    await page.getByRole('button', { name: /generate link/i }).click()

    // Success toast should appear
    await expect(page.getByText(/invite created/i)).toBeVisible()
    
    // Check pending invites list
    await expect(page.getByText(email, { exact: true })).toBeVisible()
  })
})

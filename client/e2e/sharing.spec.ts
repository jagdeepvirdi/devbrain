import { test, expect } from '@playwright/test'
import { ensureLoggedIn, goTo, isDevMode, getAdminToken, createTestUser, deleteTestUser, loginAs } from './helpers'

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

test.describe('Role-based access control', () => {

  test('viewer cannot see Create Project or Delete buttons', async ({ page, request }) => {
    await page.goto('/')
    await page.waitForSelector('form, .app', { timeout: 30_000 })
    if (await isDevMode(page)) { test.skip(); return }

    const adminToken = await getAdminToken(request)
    const ts         = Date.now()
    const viewer     = await createTestUser(request, adminToken, {
      username: `e2e-viewer-${ts}`,
      password: 'Viewer@E2E123',
      role:     'viewer',
    })

    try {
      await loginAs(page, viewer.username, 'Viewer@E2E123')
      await goTo(page, 'Projects')
      await expect(page.getByTestId('project-grid')).toBeVisible({ timeout: 5_000 })

      // Viewer must not see project-creation or delete controls
      await expect(
        page.getByRole('button', { name: /new project|create project|add project/i }).first()
      ).not.toBeVisible()
      await expect(page.getByRole('button', { name: /^delete$/i }).first()).not.toBeVisible()
    } finally {
      await deleteTestUser(request, adminToken, viewer.id)
    }
  })

  test('member cannot see a project they are not assigned to', async ({ page, request }) => {
    await page.goto('/')
    await page.waitForSelector('form, .app', { timeout: 30_000 })
    if (await isDevMode(page)) { test.skip(); return }

    const adminToken = await getAdminToken(request)
    const ts         = Date.now()

    const userA = await createTestUser(request, adminToken, {
      username: `e2e-ua-${ts}`, password: 'UserA@E2E123', role: 'member',
    })
    const userB = await createTestUser(request, adminToken, {
      username: `e2e-ub-${ts}`, password: 'UserB@E2E123', role: 'member',
    })

    // Create a project and grant access only to userA
    const projRes = await request.post('http://localhost:3001/api/projects', {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        name:        `Private-${ts}`,
        short_name:  `prv${ts}`.slice(0, 30),
        description: 'E2E private project',
        color:       '#AA00FF',
        status:      'active',
        tech_stack:  [],
        type:        'web',
      },
    })
    const project = (await projRes.json() as { data: { id: string } }).data

    await request.post(`http://localhost:3001/api/projects/${project.id}/members`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data:    { user_id: userA.id, role: 'member' },
    })

    try {
      await loginAs(page, userB.username, 'UserB@E2E123')
      await goTo(page, 'Projects')
      await expect(page.getByTestId('project-grid')).toBeVisible({ timeout: 5_000 })
      await expect(page.getByText(`Private-${ts}`, { exact: true })).not.toBeVisible()
    } finally {
      await request.delete(`http://localhost:3001/api/projects/${project.id}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
      await deleteTestUser(request, adminToken, userA.id)
      await deleteTestUser(request, adminToken, userB.id)
    }
  })

  test('deactivated user cannot log in', async ({ page, request }) => {
    await page.goto('/')
    await page.waitForSelector('form, .app', { timeout: 30_000 })
    if (await isDevMode(page)) { test.skip(); return }

    const adminToken = await getAdminToken(request)
    const ts         = Date.now()
    const testUser   = await createTestUser(request, adminToken, {
      username: `e2e-deact-${ts}`,
      password: 'Deact@E2E123',
      role:     'member',
    })

    // Deactivate via admin API
    await request.put(`http://localhost:3001/api/users/${testUser.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data:    { is_active: false },
    })

    try {
      await page.context().clearCookies()
      await page.goto('/')
      await page.waitForSelector('form', { timeout: 30_000 })

      await page.getByPlaceholder('username').fill(testUser.username)
      await page.getByPlaceholder('password').fill('Deact@E2E123')
      await page.getByRole('button', { name: 'Sign in' }).click()

      // Login must fail — form stays, app shell must not appear
      await expect(page.locator('form')).toBeVisible({ timeout: 5_000 })
      await expect(page.locator('.app')).not.toBeVisible()
    } finally {
      // Re-activate so the user can be deleted (DELETE requires active session context)
      await request.put(`http://localhost:3001/api/users/${testUser.id}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        data:    { is_active: true },
      })
      await deleteTestUser(request, adminToken, testUser.id)
    }
  })
})

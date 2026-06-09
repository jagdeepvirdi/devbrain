import { test, expect } from '@playwright/test'
import { ensureLoggedIn, goTo, getAdminToken } from './helpers'
import path from 'path'

test.describe('Projects page features', () => {
  let linkedProjectId: string | null = null

  test.beforeAll(async ({ request }) => {
    try {
      const adminToken = await getAdminToken(request)
      const res = await request.get('http://localhost:3001/api/projects', {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
      const body = await res.json() as { data: { id: string }[] }
      const projects = body.data ?? []
      if (!projects.length) return

      const candidateId = projects[0].id
      // Link first project to the devbrain repo root (a real git repo on this machine)
      const repoRoot = path.resolve(process.cwd(), '..')
      const linkRes = await request.put(`http://localhost:3001/api/projects/${candidateId}/link`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { fs_path: repoRoot },
      })
      if (linkRes.ok()) linkedProjectId = candidateId
    } catch {
      // If setup fails, tests skip via the linkedProjectId guard
    }
  })

  test.afterAll(async ({ request }) => {
    if (!linkedProjectId) return
    try {
      const adminToken = await getAdminToken(request)
      await request.put(`http://localhost:3001/api/projects/${linkedProjectId}/link`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { fs_path: null },
      })
    } catch { /* ignore cleanup errors */ }
  })

  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page)
    await goTo(page, 'Projects')
  })

  test('open git tab in project detail panel', async ({ page }) => {
    if (!linkedProjectId) { test.skip(); return }

    const projectCard = page.getByTestId('project-card').first()
    await expect(projectCard).toBeVisible({ timeout: 5_000 })

    const gitBtn = projectCard.getByRole('button', { name: /git/i })
    await expect(gitBtn).toBeVisible({ timeout: 5_000 })
    await gitBtn.click()

    // Loading state appears while git history is fetched from the linked repo
    await expect(page.getByText(/loading git history/i)).toBeVisible({ timeout: 5_000 })
  })

  test('toggle between tasks, sessions and git tabs', async ({ page }) => {
    if (!linkedProjectId) { test.skip(); return }

    const projectCard = page.getByTestId('project-card').first()
    await expect(projectCard).toBeVisible({ timeout: 5_000 })

    // Open panel with sessions tab
    await projectCard.getByRole('button', { name: /sessions/i }).click()
    // Wait for panel to open — the tasks tab button appears in the panel header
    await expect(page.getByRole('button', { name: 'tasks', exact: true })).toBeVisible({ timeout: 5_000 })

    // Switch to tasks tab via panel header (exact lowercase match avoids sidebar/grid buttons)
    await page.getByRole('button', { name: 'tasks', exact: true }).click()

    // Switch to git tab — loading state or git content should appear
    await page.getByRole('button', { name: 'git', exact: true }).click()
    await expect(
      page.getByText(/loading git history|branch|no commits/i).first()
    ).toBeVisible({ timeout: 8_000 })
  })
})

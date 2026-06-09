import { type Page, type APIRequestContext } from '@playwright/test'

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
  await page.waitForSelector('form, .app', { timeout: 30_000 })
  if (await page.locator('input[type="password"]').isVisible()) {
    await page.getByPlaceholder('username').fill(TEST_USERNAME)
    await page.getByPlaceholder('password').fill(TEST_PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForSelector('.app', { timeout: 30_000 })
  }
}

/** Navigate to a sidebar section by its label. */
export async function goTo(page: Page, label: string): Promise<void> {
  await page.locator('nav').getByRole('button', { name: label }).click()
}

const API_BASE = 'http://localhost:3001/api'

/** Get a JWT token for the default admin user via the API. */
export async function getAdminToken(request: APIRequestContext): Promise<string> {
  const res  = await request.post(`${API_BASE}/auth/login`, {
    data: { username: TEST_USERNAME, password: TEST_PASSWORD },
  })
  const body = await res.json() as { data: { token: string } }
  return body.data.token
}

export interface TestUser { id: string; username: string }

/** Create a user via the admin API and return its id + username. */
export async function createTestUser(
  request:    APIRequestContext,
  adminToken: string,
  opts:       { username: string; password: string; role: 'admin' | 'member' | 'viewer' },
): Promise<TestUser> {
  const res  = await request.post(`${API_BASE}/users`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data:    opts,
  })
  const body = await res.json() as { data: { id: string; username: string } }
  return { id: body.data.id, username: body.data.username }
}

/** Delete a user via the admin API. */
export async function deleteTestUser(
  request:    APIRequestContext,
  adminToken: string,
  userId:     string,
): Promise<void> {
  await request.delete(`${API_BASE}/users/${userId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })
}

/** Clear cookies then log into the browser as a specific user. */
export async function loginAs(page: Page, username: string, password: string): Promise<void> {
  await page.context().clearCookies()
  await page.goto('/')
  await page.waitForSelector('form, .app', { timeout: 30_000 })
  if (await page.locator('input[type="password"]').isVisible()) {
    await page.getByPlaceholder('username').fill(username)
    await page.getByPlaceholder('password').fill(password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForSelector('.app', { timeout: 30_000 })
  }
}

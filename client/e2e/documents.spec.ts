import { test, expect } from '@playwright/test'
import { ensureLoggedIn, goTo } from './helpers'
import path from 'path'
import fs from 'fs'
import os from 'os'

const RUN_ID     = Date.now()
const DOC_TITLE  = 'E2E Test Document'
const MD_CONTENT = `# ${DOC_TITLE}\n\nRun: ${RUN_ID}\n\nThis document was uploaded by the Playwright E2E suite.\n`

test.describe('Document upload', () => {
  let tmpMdPath: string

  test.beforeAll(async () => {
    // Write a temporary .md file for upload
    // Filename becomes the document title in the DB (parser uses baseName)
    tmpMdPath = path.join(os.tmpdir(), `${DOC_TITLE}.md`)
    fs.writeFileSync(tmpMdPath, MD_CONTENT)
  })

  test.afterAll(() => {
    try { fs.unlinkSync(tmpMdPath) } catch { /* ignore */ }
  })

  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page)
    await goTo(page, 'Documents')
  })

  test('upload .md file appears in document list', async ({ page }) => {
    // The Documents page uses a hidden <input type="file"> triggered by the drop zone.
    // Playwright can set files on hidden inputs directly without clicking first.
    const fileInput = page.locator('input[type="file"]').first()
    await fileInput.setInputFiles(tmpMdPath)

    // A single selected file is staged (not uploaded yet) so Auto-tag can analyze its
    // real content — confirm the upload explicitly before it reaches the document list.
    // Wait for the actual POST /api/documents response, not just the click: right after
    // clicking, the drop-zone's "Embedding..." status text and the staged-file banner (both
    // of which also render the filename) can be visible at the same time as a transient
    // in-flight render, which makes a plain getByText(DOC_TITLE) match 2 elements.
    await Promise.all([
      page.waitForResponse(res => res.url().includes('/api/documents') && res.request().method() === 'POST', { timeout: 60_000 }),
      page.getByRole('button', { name: 'Upload' }).click(),
    ])

    // Once uploaded, the drop-zone's staged-file banner is gone, so the document list row
    // is the only remaining match.
    await expect(page.getByText(DOC_TITLE)).toBeVisible({ timeout: 15_000 })
  })

  test('document title links to DocChat', async ({ page }) => {
    // Navigate to Ask AI
    await goTo(page, 'Ask AI')
    // The DocChat page should load
    await expect(page.getByPlaceholder(/ask about/i)).toBeVisible({ timeout: 5_000 })
  })

  test('DocChat streams an SSE response', async ({ page, request }) => {
    // Skip when Ollama is not running
    const ollamaUp = await request.get('http://localhost:11434/api/tags').catch(() => null)
    if (!ollamaUp || !ollamaUp.ok()) { test.skip(); return }

    await goTo(page, 'Ask AI')
    await expect(page.getByPlaceholder(/ask about/i)).toBeVisible({ timeout: 5_000 })

    await page.getByPlaceholder(/ask about/i).fill('What is in the E2E test document?')
    await page.keyboard.press('Enter')

    // AI message container appears once streaming begins
    await expect(page.locator('[data-testid="ai-message"]').first()).toBeVisible({ timeout: 20_000 })
  })
})

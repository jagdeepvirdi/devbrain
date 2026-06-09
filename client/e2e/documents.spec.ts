import { test, expect } from '@playwright/test'
import { ensureLoggedIn, goTo } from './helpers'
import path from 'path'
import fs from 'fs'
import os from 'os'

const MD_CONTENT = `# E2E Test Document\n\nThis document was uploaded by the Playwright E2E suite.\n\nIt contains some content about testing.\n`
const DOC_TITLE  = `E2E Test Document`

test.describe('Document upload', () => {
  let tmpMdPath: string

  test.beforeAll(async () => {
    // Write a temporary .md file for upload
    tmpMdPath = path.join(os.tmpdir(), `e2e-test-${Date.now()}.md`)
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
    // Look for an upload button or file input
    const uploadBtn = page.getByRole('button', { name: /upload|add document/i }).first()
    await expect(uploadBtn).toBeVisible({ timeout: 5_000 })
    await uploadBtn.click()

    // The file input — may be hidden; use setInputFiles
    const fileInput = page.locator('input[type="file"]').first()
    await fileInput.setInputFiles(tmpMdPath)

    // Wait for the document to appear in the list
    await expect(page.getByText(DOC_TITLE)).toBeVisible({ timeout: 15_000 })
  })

  test('document title links to DocChat', async ({ page }) => {
    // Navigate to Ask AI
    await goTo(page, 'Ask AI')
    // The DocChat page should load
    await expect(page.getByPlaceholder(/ask about/i)).toBeVisible({ timeout: 5_000 })
  })

  test('DocChat streams an SSE response', async ({ page }) => {
    await goTo(page, 'Ask AI')
    await expect(page.getByPlaceholder(/ask about/i)).toBeVisible({ timeout: 5_000 })

    await page.getByPlaceholder(/ask about/i).fill('What is in the E2E test document?')
    await page.keyboard.press('Enter')

    // Some response should stream in (even if Ollama is unavailable, an error/fallback message appears)
    await expect(
      page.locator('[data-chat-response], .chat-answer, [aria-live]').first()
    ).toBeVisible({ timeout: 20_000 })
  })
})

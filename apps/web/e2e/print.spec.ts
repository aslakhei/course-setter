import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { EventDoc, PrintSettings } from '@course-setter/core'
import { expect, type Page, test } from '@playwright/test'
import { admin, clubWithPdfMap, createUser, deleteUsers, pageFor, pdfMap, removeClub, type TestUser } from './users.ts'

const users: TestUser[] = []
const clubs: string[] = []

test.afterAll(async () => {
  for (const id of clubs) await removeClub(id)
  await deleteUsers(users)
})

async function clickMap(page: Page, fx: number, fy: number) {
  const box = await page.getByTestId('editor-map').boundingBox()
  if (!box) throw new Error('editor map has no size')
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
  await page.waitForTimeout(150)
}

const tool = (page: Page, name: string) => page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name, exact: true })

async function newCourse(page: Page, name: string) {
  await page.getByRole('button', { name: 'New course' }).click()
  await page.getByPlaceholder('Course name').fill(name)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Course', exact: true })).toHaveValue(/.+/)
}

async function waitSaved(page: Page) {
  await expect(page.getByTestId('save-status')).toHaveText(/^Saved/, { timeout: 15_000 })
}

/** Wait for the change just made to be saved (autosave waits 1.5 s before saving). */
async function waitChangeSaved(page: Page) {
  await expect(page.getByTestId('save-status')).not.toHaveText(/^Saved/)
  await waitSaved(page)
}

const widthOf = (s: PrintSettings) => (s.orientation === 'landscape' ? 1 : 0) + (s.paper === 'A3' ? 2 : 0)
const WIDTHS = [210, 297, 297, 420]

/** The print settings of a course as saved. */
async function savedPrint(clubId: string, courseName: string): Promise<PrintSettings | undefined> {
  const { data } = await admin.from('events').select('doc').eq('club_id', clubId).single()
  const doc = data?.doc as EventDoc | undefined
  return doc?.courses.find(c => c.name === courseName)?.print
}

/**
 * Where the page is on screen: the label above the frame sits on its top-left corner, and the view is
 * fitted to the page, so its centre is the map's centre (shifted by the fit's extra top padding).
 */
async function pageOnScreen(page: Page, widthMm: number) {
  const map = await page.getByTestId('print-map').boundingBox()
  const label = await page.getByTestId('print-page-label').boundingBox()
  if (!map || !label) throw new Error('no print map')
  const centre = { x: map.x + map.width / 2, y: map.y + (map.height + 16) / 2 }
  const left = label.x
  const top = label.y + label.height
  return { centre, left, top, pxPerMm: (centre.x - left) / (widthMm / 2) }
}

test('the print view: place the page and the description sheet, keep them, and download the PDF', async ({ browser }) => {
  test.setTimeout(180_000)
  const ada = await createUser('Ada Admin')
  users.push(ada)
  // A PDF map: printed as vector, so the PDF is made in seconds and keeps the worker free for other tests.
  const { clubId } = await clubWithPdfMap(ada, `E2E print ${randomUUID().slice(0, 8)}`, pdfMap(420, 297), 15000)
  clubs.push(clubId)

  const page = await pageFor(browser, ada)
  await page.goto(`/clubs/${clubId}/events`)
  await page.getByLabel('Name').fill('Tuesday training')
  await page.getByRole('button', { name: 'Create event' }).click()
  await expect(page.getByTestId('editor-map')).toBeVisible()
  // No course yet: nothing to print.
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeDisabled()

  await newCourse(page, 'H21')
  await tool(page, 'Start').click()
  await clickMap(page, 0.3, 0.5)
  await tool(page, 'Control').click()
  await clickMap(page, 0.45, 0.45)
  await tool(page, 'Finish').click()
  await clickMap(page, 0.6, 0.55)
  await newCourse(page, 'D16')
  await tool(page, 'Start').click()
  await clickMap(page, 0.3, 0.5)
  await tool(page, 'Control').click()
  await clickMap(page, 0.5, 0.6)
  await waitSaved(page)

  // The print view shows the page of the course being edited.
  const courses = page.getByRole('combobox', { name: 'Course', exact: true })
  await courses.selectOption((await courses.locator('option', { hasText: 'H21' }).getAttribute('value')) ?? '')
  await page.getByRole('button', { name: 'Print', exact: true }).click()
  await expect(page).toHaveURL(/view=print/)
  const toolbar = page.getByRole('toolbar', { name: 'Page' })
  await expect(toolbar.getByRole('combobox', { name: 'Page of' })).toHaveValue(/.+/)
  await expect(toolbar.getByRole('combobox', { name: 'Page of' }).locator('option:checked')).toHaveText('H21')
  await expect(page.getByTestId('print-map')).toBeVisible()
  // Nothing is saved until the page is changed.
  await expect(toolbar.getByRole('button', { name: 'Reset page' })).toBeDisabled()

  // A3, kept with the course (the wide course is printed landscape).
  await toolbar.getByText('A3', { exact: true }).click()
  await expect(toolbar.getByRole('radio', { name: 'A3' })).toBeChecked()
  await waitChangeSaved(page)
  expect(await savedPrint(clubId, 'H21')).toMatchObject({ paper: 'A3', orientation: 'landscape' })
  await expect(page.getByTestId('print-page-label')).toHaveText(/^H21 · A3 landscape · 1:15\s000$/)

  // Drag the page: it shows what is under it after the move.
  const before = (await savedPrint(clubId, 'H21')) as PrintSettings
  const width = WIDTHS[widthOf(before)] ?? 0
  let at = await pageOnScreen(page, width)
  await page.mouse.move(at.centre.x, at.centre.y)
  await page.mouse.down()
  await page.mouse.move(at.centre.x + 40, at.centre.y + 10, { steps: 5 })
  await page.mouse.move(at.centre.x + 80, at.centre.y + 20, { steps: 5 })
  await page.mouse.up()
  await waitChangeSaved(page)
  const moved = (await savedPrint(clubId, 'H21')) as PrintSettings
  // 80 px right, 20 px down, in ground metres at 1:15 000.
  const metres = (px: number) => (px / at.pxPerMm) * 15
  expect(moved.center[0] - before.center[0]).toBeCloseTo(metres(80), -1)
  expect(moved.center[1] - before.center[1]).toBeCloseTo(-metres(20), -1)

  // Drag the description sheet 30 mm to the right and 10 mm down on the page (or as far as it goes).
  await page.reload()
  await expect(page.getByTestId('print-map')).toBeVisible()
  await page.waitForTimeout(500)
  at = await pageOnScreen(page, width)
  const sheet = moved.layout.find(e => e.kind === 'descriptions')?.at ?? [0, 0]
  const grab = { x: at.left + (sheet[0] + 5) * at.pxPerMm, y: at.top + (sheet[1] + 5) * at.pxPerMm }
  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  await page.mouse.move(grab.x + 15 * at.pxPerMm, grab.y + 5 * at.pxPerMm, { steps: 5 })
  await page.mouse.move(grab.x + 30 * at.pxPerMm, grab.y + 10 * at.pxPerMm, { steps: 5 })
  await page.mouse.up()
  await waitChangeSaved(page)
  const placed = (await savedPrint(clubId, 'H21')) as PrintSettings
  expect(placed.center).toEqual(moved.center)
  const after = placed.layout.find(e => e.kind === 'descriptions')?.at ?? [0, 0]
  expect(after[0] - sheet[0]).toBeCloseTo(30, -0.5)
  expect(after[1] - sheet[1]).toBeCloseTo(10, -0.5)

  // Undo puts the sheet back.
  await page.keyboard.press('Control+z')
  await waitChangeSaved(page)
  expect((await savedPrint(clubId, 'H21'))?.layout).toEqual(moved.layout)

  // One PDF with both courses.
  const panel = page.getByRole('complementary', { name: 'Print' })
  await panel.getByRole('checkbox', { name: /^D16/ }).check()
  await expect(panel.getByText('2 of 2 courses')).toBeVisible()
  await panel.getByRole('button', { name: 'Make PDF of 2 courses' }).click()
  await expect(panel.getByText('Making a PDF of H21, D16…')).toBeVisible()
  const download = panel.getByRole('button', { name: 'Download Tuesday training.pdf' })
  await expect(download).toBeVisible({ timeout: 90_000 })
  const [file] = await Promise.all([page.waitForEvent('download'), download.click()])
  expect(file.suggestedFilename()).toBe('Tuesday training.pdf')
  const bytes = readFileSync(await file.path())
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')

  // Back to editing.
  await page.getByRole('button', { name: 'Back to editing' }).click()
  await expect(page.getByTestId('editor-map')).toBeVisible()
  await expect(page).not.toHaveURL(/view=print/)
})

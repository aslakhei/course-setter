import type { EventDoc, PageElementSpec, PrintSettings } from '@course-setter/core'
import { expect, type Page, test } from '@playwright/test'
import { admin, clubWithPdfMap, createUser, deleteUsers, pageFor, pdfMap, removeClub, type TestUser } from './users.ts'

const users: TestUser[] = []
const clubs: string[] = []

test.afterAll(async () => {
  for (const id of clubs) await removeClub(id)
  await deleteUsers(users)
})

/** The event document as saved. */
async function saved(eventId: string): Promise<EventDoc> {
  const { data } = await admin.from('events').select('doc').eq('id', eventId).single()
  return data?.doc as EventDoc
}

async function waitSaved(page: Page) {
  await expect(page.getByTestId('save-status')).not.toHaveText(/^Saved/)
  await expect(page.getByTestId('save-status')).toHaveText(/^Saved/, { timeout: 15_000 })
}

/** Where the page is on screen (the view is fitted to it): its top-left corner and pixels per mm. */
async function pageOnScreen(page: Page, widthMm: number) {
  const map = await page.getByTestId('print-map').boundingBox()
  const label = await page.getByTestId('print-page-label').boundingBox()
  if (!map || !label) throw new Error('no print map')
  const centreX = map.x + map.width / 2
  return { left: label.x, top: label.y + label.height, pxPerMm: (centreX - label.x) / (widthMm / 2) }
}

test('layout mode: add and edit elements for every course or one, its own layout, undo', async ({ browser }) => {
  test.setTimeout(240_000)
  const ada = await createUser('Ada Admin')
  users.push(ada)
  const { clubId, mapVersionId } = await clubWithPdfMap(ada, 'Layout club', pdfMap(300, 200), 10000)
  clubs.push(clubId)
  const doc: EventDoc = {
    schemaVersion: 1,
    standard: 'isom',
    controls: [
      { id: 'a', kind: 'control', code: 31, position: [1500, 1000] },
      { id: 'b', kind: 'control', code: 32, position: [1600, 1100] },
    ],
    courses: [
      { id: 'K', name: 'Long', controls: ['a', 'b'], printScale: 10000, bends: {}, numberPositions: {} },
      { id: 'L', name: 'Short', controls: ['a'], printScale: 10000, bends: {}, numberPositions: {} },
    ],
    specials: [],
  }
  const created = await admin
    .from('events')
    .insert({ club_id: clubId, name: 'Night', map_version_id: mapVersionId, doc, created_by: ada.id })
    .select('id')
    .single()
  if (created.error) throw created.error
  const eventId = created.data.id
  await admin.from('event_revisions').insert({ event_id: eventId, revision: 1, doc })

  const page = await pageFor(browser, ada)
  await page.setViewportSize({ width: 1500, height: 950 })
  await page.goto(`/clubs/${clubId}/events/${eventId}?view=print`)
  await page.getByRole('toolbar').getByText('Layout', { exact: true }).click()
  const panel = page.getByRole('complementary', { name: 'Layout' })
  const properties = page.getByRole('complementary', { name: 'Properties' })
  const layers = panel.getByRole('list', { name: 'Layers' })
  await expect(panel.getByTestId('layout-scope')).toHaveText('Shared layout: changes apply to every course.')

  // A text with a field, for every course.
  await panel.getByRole('region', { name: 'Add' }).getByRole('button', { name: 'Text', exact: true }).click()
  await expect(properties.getByRole('heading', { name: 'Text' })).toBeVisible()
  await properties.getByLabel('Text', { exact: true }).fill('Course ')
  await properties.getByRole('button', { name: 'Course', exact: true }).click()
  await expect(layers.getByRole('button', { name: 'Course Long', exact: true })).toBeVisible()
  await waitSaved(page)
  const text = (await saved(eventId)).printLayout?.elements[0] as Extract<PageElementSpec, { kind: 'text' }>
  expect(text).toMatchObject({ kind: 'text', text: 'Course {course}', anchor: 'tl', offset: [15, 15] })

  // Arrow keys move it, for every course.
  await layers.getByRole('button', { name: 'Course Long', exact: true }).click()
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
  await waitSaved(page)
  expect((await saved(eventId)).printLayout?.elements[0]?.offset).toEqual([18, 15])

  // Pinned to the bottom right, it stays where it is.
  await properties.getByTitle('Bottom right').click()
  await expect(properties.getByText(/from the right, .* from the bottom/)).toBeVisible()
  await waitSaved(page)
  expect((await saved(eventId)).printLayout?.elements[0]?.anchor).toBe('br')

  // Only this course: moving it changes this course alone, and its other settings are locked.
  await properties.getByText('Only Long', { exact: true }).click()
  await expect(properties.getByLabel('Text', { exact: true })).toBeDisabled()
  await layers.getByRole('button', { name: 'Course Long', exact: true }).click()
  await page.keyboard.press('Shift+ArrowUp')
  await waitSaved(page)
  let now = await saved(eventId)
  const long = now.courses.find(c => c.id === 'K')?.print as PrintSettings
  expect(Object.keys(long.overrides ?? {})).toEqual([text.id])
  expect(now.courses.find(c => c.id === 'L')?.print).toBeUndefined()

  // A layout of its own for this course, then the shared one again; undo brings its own back.
  await properties.getByRole('button', { name: 'Use a layout of its own for Long' }).click()
  await expect(panel.getByTestId('layout-scope')).toHaveText('Own layout: changes apply to Long only.')
  await waitSaved(page)
  now = await saved(eventId)
  expect(now.courses.find(c => c.id === 'K')?.print?.ownLayout?.elements).toHaveLength(1)
  page.once('dialog', dialog => dialog.accept())
  await properties.getByRole('button', { name: 'Use the shared layout again' }).click()
  await expect(panel.getByTestId('layout-scope')).toHaveText('Shared layout: changes apply to every course.')
  await page.keyboard.press('Control+z')
  await expect(panel.getByTestId('layout-scope')).toHaveText('Own layout: changes apply to Long only.')
  await page.keyboard.press('Control+z')
  await expect(panel.getByTestId('layout-scope')).toHaveText('Shared layout: changes apply to every course.')

  // Dragging a shape on the page moves it for every course.
  await properties.getByText('All courses', { exact: true }).click()
  await panel.getByRole('region', { name: 'Add' }).getByRole('button', { name: 'Shape', exact: true }).click()
  await waitSaved(page)
  const shapeId = (await saved(eventId)).printLayout?.elements[1]?.id
  const paper = (await saved(eventId)).courses.find(c => c.id === 'K')?.print?.orientation === 'portrait' ? 210 : 297
  const at = await pageOnScreen(page, paper)
  // The shape is 40 × 20 mm with its top-left 15 mm in: press in its middle and drag 20 mm right.
  const [x, y] = [at.left + 35 * at.pxPerMm, at.top + 25 * at.pxPerMm]
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 10 * at.pxPerMm, y, { steps: 5 })
  await page.mouse.move(x + 20 * at.pxPerMm, y, { steps: 5 })
  await page.mouse.up()
  await waitSaved(page)
  const shape = (await saved(eventId)).printLayout?.elements.find(e => e.id === shapeId)
  expect(shape?.offset[0]).toBeGreaterThan(30)
  expect(shape?.offset[0]).toBeLessThan(40)

  // Delete removes the selected element for every course.
  await page.keyboard.press('Delete')
  await expect(layers.getByRole('button', { name: 'Shape', exact: true })).toHaveCount(0)
  await waitSaved(page)
  expect((await saved(eventId)).printLayout?.elements.map(e => e.id)).toEqual([text.id])
})

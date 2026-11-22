import type { EventDoc, PageElementSpec, PrintSettings } from '@course-setter/core'
import { expect, type Page, test } from '@playwright/test'
import { admin, clientFor, clubWithPdfMap, createUser, deleteUsers, pageFor, pdfMap, removeClub, type TestUser } from './users.ts'

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

/** A 2 × 1 pixel PNG. */
const PIXELS = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGP4z8DAwMDAAAAfAAQBXd1+NQAAAABJRU5ErkJggg==', 'base64')

/** Wait until the image is checked by the worker. */
async function ready(assetId: string) {
  await expect
    .poll(async () => (await admin.from('layout_assets').select('status').eq('id', assetId).single()).data?.status, { timeout: 60_000 })
    .toBe('ready')
}

test('layout images: upload to the event, use a personal image (copied into the event), align two', async ({ browser }) => {
  test.setTimeout(240_000)
  const ada = await createUser('Ada Admin')
  users.push(ada)
  const { clubId, mapVersionId } = await clubWithPdfMap(ada, 'Layout images club', pdfMap(300, 200), 10000)
  clubs.push(clubId)
  const doc: EventDoc = {
    schemaVersion: 1,
    standard: 'isom',
    controls: [{ id: 'a', kind: 'control', code: 31, position: [1500, 1000] }],
    courses: [{ id: 'K', name: 'Long', controls: ['a'], printScale: 10000, bends: {}, numberPositions: {} }],
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

  // Ada's own logo, uploaded through the API.
  const client = await clientFor(ada)
  const started = await client.rpc('start_asset_upload', { scope: 'personal', asset_name: 'My logo', kind: 'png' })
  if (started.error) throw started.error
  const personal = started.data[0]
  if (!personal) throw new Error('no upload')
  await client.storage.from('layout-assets').upload(personal.upload_path, PIXELS, { contentType: 'image/png' })
  await client.rpc('finish_asset_upload', { asset_id: personal.asset_id })
  await ready(personal.asset_id)

  const page = await pageFor(browser, ada)
  await page.setViewportSize({ width: 1500, height: 950 })
  await page.goto(`/clubs/${clubId}/events/${eventId}?view=print&mode=layout`)
  const panel = page.getByRole('complementary', { name: 'Layout' })
  const properties = page.getByRole('complementary', { name: 'Properties' })
  const layers = panel.getByRole('list', { name: 'Layers' })
  const picker = page.getByRole('dialog', { name: 'Choose an image' })

  // An image uploaded to the event, then chosen.
  await panel.getByRole('region', { name: 'Add' }).getByRole('button', { name: 'Image', exact: true }).click()
  await picker.getByText('This event', { exact: true }).click()
  await picker.getByLabel('Upload an image to this event').setInputFiles({ name: 'Sponsor.png', mimeType: 'image/png', buffer: PIXELS })
  await picker.getByRole('button', { name: 'Upload image' }).click()
  const sponsor = picker.getByRole('button', { name: 'Sponsor' })
  await expect(sponsor).toBeEnabled({ timeout: 60_000 })
  await sponsor.click()
  await expect(picker).toHaveCount(0)
  await waitSaved(page)
  let now = await saved(eventId)
  const first = now.printLayout?.elements[0] as Extract<PageElementSpec, { kind: 'image' }>
  // 2:1 like the image.
  expect(first).toMatchObject({ kind: 'image', size: [40, 20] })
  const { data: eventImage } = await admin.from('layout_assets').select('event_id, name').eq('id', first.asset).single()
  expect(eventImage).toEqual({ event_id: eventId, name: 'Sponsor' })

  // A personal image is copied into the event, so others editing it see it too.
  await panel.getByRole('region', { name: 'Add' }).getByRole('button', { name: 'Image', exact: true }).click()
  await picker.getByText('Your images', { exact: true }).click()
  await picker.getByRole('button', { name: 'My logo' }).click()
  await expect(picker).toHaveCount(0)
  await waitSaved(page)
  now = await saved(eventId)
  const second = now.printLayout?.elements[1] as Extract<PageElementSpec, { kind: 'image' }>
  expect(second.asset).not.toBe(personal.asset_id)
  const { data: copy } = await admin.from('layout_assets').select('event_id, owner_id, name').eq('id', second.asset).single()
  expect(copy).toEqual({ event_id: eventId, owner_id: null, name: 'My logo' })
  await ready(second.asset)

  // Both selected (Shift-click) and lined up on their left edges.
  await layers.getByRole('button', { name: 'My logo', exact: true }).click()
  await layers.getByRole('button', { name: 'Sponsor', exact: true }).click({ modifiers: ['Shift'] })
  await expect(properties.getByRole('heading', { name: '2 elements' })).toBeVisible()
  // Move one away first, so aligning has something to do.
  await layers.getByRole('button', { name: 'My logo', exact: true }).click()
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight')
  await layers.getByRole('button', { name: 'Sponsor', exact: true }).click({ modifiers: ['Shift'] })
  await properties.getByRole('button', { name: 'Left edges' }).click()
  await waitSaved(page)
  now = await saved(eventId)
  const [x1, x2] = (now.printLayout?.elements ?? []).map(e => e.offset[0])
  expect(x1).toBe(x2)

  // Replacing the sponsor (the bottom layer) with the logo keeps its place.
  await layers.getByRole('button', { name: 'Sponsor', exact: true }).click()
  await properties.getByRole('button', { name: 'Replace image' }).click()
  await picker.getByText('This event', { exact: true }).click()
  await picker.getByRole('button', { name: 'My logo' }).click()
  await waitSaved(page)
  now = await saved(eventId)
  expect((now.printLayout?.elements ?? []).filter(e => e.kind === 'image' && e.asset === second.asset)).toHaveLength(2)
})

test('white areas: drawn with the pen, edited point by point, moved to the page, deleted', async ({ browser }) => {
  test.setTimeout(240_000)
  const ada = await createUser('Ada Admin')
  users.push(ada)
  const { clubId, mapVersionId } = await clubWithPdfMap(ada, 'White area club', pdfMap(300, 200), 10000)
  clubs.push(clubId)
  const doc: EventDoc = {
    schemaVersion: 1,
    standard: 'isom',
    controls: [{ id: 'a', kind: 'control', code: 31, position: [1500, 1000] }],
    courses: [{ id: 'K', name: 'Long', controls: ['a'], printScale: 10000, bends: {}, numberPositions: {} }],
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
  await page.goto(`/clubs/${clubId}/events/${eventId}?view=print&mode=layout`)
  const panel = page.getByRole('complementary', { name: 'Layout' })
  const properties = page.getByRole('complementary', { name: 'Properties' })
  await expect(panel).toBeVisible()
  await page.waitForTimeout(1500)

  // A4 portrait (one control): page mm from the top-left to the screen.
  const at = await pageOnScreen(page, 210)
  const screen = (x: number, y: number): [number, number] => [at.left + x * at.pxPerMm, at.top + y * at.pxPerMm]

  // Two corners and a curve point, then Enter.
  await panel.getByRole('region', { name: 'Add' }).getByRole('button', { name: 'White area' }).click()
  await expect(properties.getByRole('heading', { name: 'Drawing a white area' })).toBeVisible()
  await page.mouse.click(...screen(60, 80))
  await page.mouse.click(...screen(120, 80))
  await page.mouse.move(...screen(110, 140))
  await page.mouse.down()
  await page.mouse.move(...screen(100, 150), { steps: 4 })
  await page.mouse.move(...screen(90, 150), { steps: 4 })
  await page.mouse.up()
  await expect(properties.getByText('3 points')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(properties.getByRole('heading', { name: 'White area' })).toBeVisible()
  await expect(panel.getByRole('list', { name: 'Layers' }).getByRole('button', { name: 'White area 1', exact: true })).toBeVisible()
  await waitSaved(page)
  let area = (await saved(eventId)).printLayout?.whiteAreas?.[0]
  expect(area?.on).toBe('map')
  expect(area?.nodes.map(n => Boolean(n.out))).toEqual([false, false, true])
  // 60 mm between the first two points is 600 m at 1:10 000.
  const [p0, p1] = area?.nodes ?? []
  expect(Math.abs((p1?.at[0] ?? 0) - (p0?.at[0] ?? 0) - 600)).toBeLessThan(15)

  // Alt-click the first point: it becomes a curve.
  await page.keyboard.down('Alt')
  await page.mouse.click(...screen(60, 80))
  await page.keyboard.up('Alt')
  await waitSaved(page)
  area = (await saved(eventId)).printLayout?.whiteAreas?.[0]
  expect(area?.nodes[0]?.in).toBeDefined()

  // Drag the second point 10 mm down.
  await page.mouse.move(...screen(120, 80))
  await page.mouse.down()
  await page.mouse.move(...screen(120, 85), { steps: 3 })
  await page.mouse.move(...screen(120, 90), { steps: 3 })
  await page.mouse.up()
  await waitSaved(page)
  const moved = (await saved(eventId)).printLayout?.whiteAreas?.[0]?.nodes[1]?.at
  expect(Math.abs((p1?.at[1] ?? 0) - (moved?.[1] ?? 0) - 100)).toBeLessThan(15)

  // On the page instead: the same place, in page mm.
  await properties.getByText('The page', { exact: true }).click()
  await waitSaved(page)
  area = (await saved(eventId)).printLayout?.whiteAreas?.[0]
  expect(area?.on).toBe('page')
  expect(area?.nodes[1]?.at[0]).toBeCloseTo(120, 0)
  expect(area?.nodes[1]?.at[1]).toBeCloseTo(90, 0)

  // Delete it (nothing but the area selected), and undo brings it back.
  await panel.getByRole('list', { name: 'Layers' }).getByRole('button', { name: 'White area 1', exact: true }).click()
  await page.keyboard.press('Delete')
  await expect(panel.getByRole('list', { name: 'Layers' }).getByRole('button', { name: 'White area 1', exact: true })).toHaveCount(0)
  await page.keyboard.press('Control+z')
  await expect(panel.getByRole('list', { name: 'Layers' }).getByRole('button', { name: 'White area 1', exact: true })).toBeVisible()
})

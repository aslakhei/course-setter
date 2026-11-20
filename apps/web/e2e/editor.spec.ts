import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { admin, clubWithMap, createUser, deleteUsers, pageFor, removeClub, type TestUser, uploadNewVersion } from './users.ts'

const fixture = fileURLToPath(new URL('../../worker/test/fixtures/ocad/basic-1.ocd', import.meta.url))
const users: TestUser[] = []
const clubs: string[] = []

test.afterAll(async () => {
  for (const id of clubs) await removeClub(id)
  await deleteUsers(users)
})

/** Click the editor map at a fraction of its width and height. */
// The test map is wide and flat: it fills a band across the middle of the view, so clicks stay there.
async function clickMap(page: Page, fx: number, fy: number) {
  const box = await page.getByTestId('editor-map').boundingBox()
  if (!box) throw new Error('editor map has no size')
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
  await page.waitForTimeout(150)
}

const tool = (page: Page, name: string) => page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name, exact: true })
const lengthOf = async (page: Page) => (await page.getByTestId('course-length').textContent()) ?? ''

async function newCourse(page: Page, name: string) {
  await page.getByRole('button', { name: 'New course' }).click()
  await page.getByPlaceholder('Course name').fill(name)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Course', exact: true })).toHaveValue(/.+/)
}

async function waitSaved(page: Page) {
  await expect(page.getByTestId('save-status')).toHaveText(/^Saved/, { timeout: 15_000 })
}

function courseList(page: Page, name: string): Locator {
  return page.getByRole('list', { name })
}

test('set a course on the map, share a control with a second course, and keep it after reload', async ({ browser }) => {
  test.setTimeout(240_000)
  const ada = await createUser('Ada Admin')
  users.push(ada)
  const { clubId } = await clubWithMap(ada, `E2E editor ${randomUUID().slice(0, 8)}`, fixture)
  clubs.push(clubId)

  const page = await pageFor(browser, ada)
  await page.goto(`/clubs/${clubId}/events`)
  await page.getByLabel('Name').fill('Tuesday training')
  await page.getByRole('button', { name: 'Create event' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Tuesday training' })).toBeVisible()
  await expect(page.getByTestId('editor-map')).toBeVisible()

  // H21: start, three controls, finish.
  await newCourse(page, 'H21')
  await tool(page, 'Start').click()
  await clickMap(page, 0.2, 0.55)
  await tool(page, 'Control').click()
  await clickMap(page, 0.35, 0.45)
  await clickMap(page, 0.55, 0.42)
  await clickMap(page, 0.7, 0.55)
  await tool(page, 'Finish').click()
  await clickMap(page, 0.8, 0.58)

  const h21 = courseList(page, 'H21')
  await expect(h21.getByRole('listitem')).toHaveCount(5)
  await expect(h21.getByText('Code 31')).toBeVisible()
  await expect(h21.getByText('Code 33')).toBeVisible()
  await expect(page.getByTestId('course-length')).toHaveText(/^\d+\.\d km$/)
  const h21Before = await lengthOf(page)
  await waitSaved(page)

  // D16 reuses the start, control 32 and the finish by clicking them.
  await newCourse(page, 'D16')
  await tool(page, 'Start').click()
  await clickMap(page, 0.2, 0.55)
  await tool(page, 'Control').click()
  // Hovering over control 32 previews the snap: the click will reuse it.
  const mapBox = await page.getByTestId('editor-map').boundingBox()
  if (!mapBox) throw new Error('no map')
  await page.mouse.move(mapBox.x + mapBox.width * 0.55 + 3, mapBox.y + mapBox.height * 0.42 + 2)
  await expect(page.getByRole('toolbar', { name: 'Tools' }).getByText('Click to use Code 32 again in D16.')).toBeVisible()
  await clickMap(page, 0.55, 0.42)
  await tool(page, 'Finish').click()
  await clickMap(page, 0.8, 0.58)
  const d16 = courseList(page, 'D16')
  await expect(d16.getByRole('listitem')).toHaveCount(3)
  await expect(d16.getByText('Code 32')).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Course', exact: true }).locator('option')).toHaveText([
    /^All controls \(5\)$/,
    /^H21/,
    /^D16/,
  ])
  const d16Before = await lengthOf(page)

  // Drag the shared control 32: both courses change.
  await tool(page, 'Select').click()
  const box = await page.getByTestId('editor-map').boundingBox()
  if (!box) throw new Error('no map')
  // Dragging an unselected control pans the map instead; select it first.
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.42)
  await expect(page.getByText('Selected: Code 32')).toBeVisible()
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.42)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => lengthOf(page)).not.toBe(d16Before)
  await page.getByRole('combobox', { name: 'Course', exact: true }).selectOption({ index: 1 })
  await expect.poll(() => lengthOf(page)).not.toBe(h21Before)

  // Undo puts it back.
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(() => lengthOf(page)).toBe(h21Before)
  await waitSaved(page)

  // Delete takes the selected control out of the course (it stays in the event); undo puts it back.
  await courseList(page, 'H21').getByText('Code 33').click()
  await page.keyboard.press('Delete')
  await expect(courseList(page, 'H21').getByRole('listitem')).toHaveCount(4)
  await expect(page.getByRole('combobox', { name: 'Course', exact: true }).locator('option').first()).toHaveText('All controls (5)')
  await page.keyboard.press('Control+z')
  await expect(courseList(page, 'H21').getByRole('listitem')).toHaveCount(5)
  await waitSaved(page)

  // Reload: the courses are still there.
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Course', exact: true }).locator('option')).toHaveText([
    /^All controls \(5\)$/,
    /^H21/,
    /^D16/,
  ])
  await expect(courseList(page, 'H21').getByRole('listitem')).toHaveCount(5)
  await expect(page.getByTestId('course-length')).toHaveText(h21Before)
})

test('control descriptions show in every course that uses the control and survive a reload', async ({ browser }) => {
  test.setTimeout(240_000)
  const ada = await createUser('Ada Admin')
  users.push(ada)
  const { clubId } = await clubWithMap(ada, `E2E descriptions ${randomUUID().slice(0, 8)}`, fixture)
  clubs.push(clubId)

  const page = await pageFor(browser, ada)
  await page.goto(`/clubs/${clubId}/events`)
  await page.getByLabel('Name').fill('Club night')
  await page.getByRole('button', { name: 'Create event' }).click()
  await expect(page.getByTestId('editor-map')).toBeVisible()

  // H21: start, 31, 32, finish. D16: start, 32 (reused), finish.
  await newCourse(page, 'H21')
  await tool(page, 'Start').click()
  await clickMap(page, 0.2, 0.55)
  await tool(page, 'Control').click()
  await clickMap(page, 0.4, 0.45)
  await clickMap(page, 0.6, 0.45)
  await tool(page, 'Finish').click()
  await clickMap(page, 0.8, 0.55)
  await newCourse(page, 'D16')
  await tool(page, 'Start').click()
  await clickMap(page, 0.2, 0.55)
  await tool(page, 'Control').click()
  await clickMap(page, 0.6, 0.45)
  await tool(page, 'Finish').click()
  await clickMap(page, 0.8, 0.55)
  await expect(courseList(page, 'D16').getByText('Code 32')).toBeVisible()
  await tool(page, 'Select').click()

  // In H21's sheet: 32 is a boulder, 1.5 m high; 31 a knoll.
  const course = page.getByRole('combobox', { name: 'Course', exact: true })
  await course.selectOption({ label: (await course.locator('option', { hasText: 'H21' }).textContent()) ?? '' })
  await page.getByRole('button', { name: 'Descriptions' }).click()
  const sheet = page.getByTestId('description-sheet')
  await sheet.getByRole('button', { name: 'Code 32, Feature: empty' }).click()
  const picker = page.getByRole('dialog', { name: 'Code 32 · column D' })
  await expect(picker.getByRole('searchbox', { name: 'Search symbols' })).toBeFocused()
  await picker.getByRole('searchbox').fill('boulder')
  await expect(picker.getByRole('button', { name: 'Knoll' })).toHaveCount(0)
  await picker.getByRole('button', { name: 'Boulder', exact: true }).click()
  await expect(picker).toHaveCount(0)
  await expect(sheet.getByRole('button', { name: 'Code 32, Feature: Boulder' })).toBeVisible()

  await sheet.getByRole('button', { name: 'Code 32, Dimensions and combinations: empty' }).click()
  await page.getByLabel('Size in metres').fill('1.5')
  await page.getByRole('button', { name: 'Set', exact: true }).click()
  await expect(sheet.getByRole('button', { name: 'Code 32, Dimensions and combinations: 1.5' })).toBeVisible()

  await sheet.getByRole('button', { name: 'Code 31, Feature: empty' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Knoll', exact: true }).click()
  // Escape closes the picker without changing anything.
  await sheet.getByRole('button', { name: 'Code 31, Appearance: empty' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(sheet.getByRole('button', { name: 'Code 31, Appearance: empty' })).toBeFocused()

  // D16 shares control 32, so it has the same description.
  await course.selectOption({ label: (await course.locator('option', { hasText: 'D16' }).textContent()) ?? '' })
  await expect(sheet.getByRole('button', { name: 'Code 32, Feature: Boulder' })).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Code 32, Dimensions and combinations: 1.5' })).toBeVisible()
  await waitSaved(page)

  // After a reload both courses still have it.
  await page.reload()
  await page.getByRole('button', { name: 'Descriptions' }).click()
  for (const name of ['H21', 'D16']) {
    await course.selectOption({ label: (await course.locator('option', { hasText: name }).textContent()) ?? '' })
    await expect(sheet.getByRole('button', { name: 'Code 32, Feature: Boulder' })).toBeVisible()
  }
  await expect(sheet.getByRole('button', { name: 'Code 31' })).toHaveCount(0) // not in D16
  await course.selectOption({ label: (await course.locator('option', { hasText: 'H21' }).textContent()) ?? '' })
  await expect(sheet.getByRole('button', { name: 'Code 31, Feature: Knoll' })).toBeVisible()

  // Clearing a cell.
  await sheet.getByRole('button', { name: 'Code 31, Feature: Knoll' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Clear cell' }).click()
  await expect(sheet.getByRole('button', { name: 'Code 31, Feature: empty' })).toBeVisible()
})

test('two people editing at once: the second save gets the conflict and nothing is lost', async ({ browser }) => {
  test.setTimeout(240_000)
  const [ada, ivan] = await Promise.all([createUser('Ada Admin'), createUser('Ivan Invited')])
  users.push(ada, ivan)
  const { clubId, mapVersionId } = await clubWithMap(ada, `E2E conflict ${randomUUID().slice(0, 8)}`, fixture)
  clubs.push(clubId)
  await admin.from('club_members').insert({ club_id: clubId, user_id: ivan.id, role: 'member' })

  const adaPage = await pageFor(browser, ada)
  await adaPage.goto(`/clubs/${clubId}/events`)
  await adaPage.getByLabel('Name').fill('Shared training')
  await expect(adaPage.getByLabel('Map')).toHaveValue(mapVersionId)
  await adaPage.getByRole('button', { name: 'Create event' }).click()
  await expect(adaPage.getByRole('heading', { level: 1, name: 'Shared training' })).toBeVisible()
  const eventUrl = adaPage.url()

  // Ivan cannot see the event until Ada invites him.
  const ivanPage = await pageFor(browser, ivan)
  await ivanPage.goto(eventUrl)
  await expect(ivanPage.getByText('This event does not exist, or you do not have access to it.')).toBeVisible()
  await adaPage.getByRole('button', { name: 'Invite' }).click()
  await adaPage.getByLabel('Invite a club member').selectOption({ label: 'Ivan Invited' })
  await adaPage.getByRole('dialog').getByRole('button', { name: 'Invite' }).click()
  await expect(adaPage.getByRole('dialog').getByText('Ivan Invited')).toBeVisible()
  await adaPage.getByRole('button', { name: 'Close' }).click()

  // Both open the event; Ada adds a control and it saves.
  await ivanPage.goto(eventUrl)
  await expect(ivanPage.getByTestId('editor-map')).toBeVisible()
  await tool(adaPage, 'Control').click()
  await clickMap(adaPage, 0.4, 0.48)
  await waitSaved(adaPage)

  // Ivan, still on the old revision, adds one too: his save is refused and he is told why.
  await tool(ivanPage, 'Control').click()
  await clickMap(ivanPage, 0.6, 0.52)
  const dialog = ivanPage.getByRole('dialog')
  await expect(dialog.getByText(/Ada Admin saved this event at \d\d:\d\d while you were editing/)).toBeVisible({ timeout: 15_000 })

  // Use theirs: his version becomes a copy, Ada's opens.
  await dialog.getByRole('button', { name: 'Use theirs' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(ivanPage.getByRole('combobox', { name: 'Course', exact: true }).locator('option')).toHaveText([/^All controls \(1\)$/])
  const { data: events } = await admin.from('events').select('name, doc').eq('club_id', clubId).order('created_at')
  expect(events?.map(e => e.name)).toEqual(['Shared training', 'Shared training (my copy)'])
  // The copy holds Ivan's control, which never reached the original.
  const copy = events?.[1]?.doc as { controls: unknown[] } | undefined
  expect(copy?.controls).toHaveLength(1)
})

test('an event moves to a newer version of its map and keeps its course', async ({ browser }) => {
  test.setTimeout(240_000)
  const ada = await createUser('Ada Admin')
  users.push(ada)
  const { clubId, mapVersionId } = await clubWithMap(ada, `E2E move ${randomUUID().slice(0, 8)}`, fixture)
  clubs.push(clubId)

  const page = await pageFor(browser, ada)
  await page.goto(`/clubs/${clubId}/events`)
  await page.getByLabel('Name').fill('Moving training')
  await page.getByRole('button', { name: 'Create event' }).click()
  // The events page lists "Test forest · version 1" too: wait for the editor first.
  await expect(page.getByRole('heading', { level: 1, name: 'Moving training' })).toBeVisible()
  await expect(page.getByText('Test forest · Version 1')).toBeVisible()
  await newCourse(page, 'H21')
  await tool(page, 'Start').click()
  await clickMap(page, 0.3, 0.5)
  await tool(page, 'Control').click()
  await clickMap(page, 0.5, 0.45)
  await tool(page, 'Finish').click()
  await clickMap(page, 0.7, 0.55)
  const length = await lengthOf(page)
  await waitSaved(page)

  // A new version of the map is uploaded meanwhile (the same OCAD file: it lines up as unchanged).
  const { data: v1 } = await admin.from('map_versions').select('map_id').eq('id', mapVersionId).single()
  await uploadNewVersion(ada, clubId, v1?.map_id ?? '', fixture)
  await page.reload()
  await expect(page.getByText('Version 2 of the map is available.')).toBeVisible()
  await page.getByRole('button', { name: 'Move to version 2' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(/Every control and bend moves to the same place on the terrain on version 2/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Move' }).click()

  // The editor reopens on version 2 with the same course.
  await expect(page.getByText('Test forest · Version 2')).toBeVisible()
  await expect(page.getByText('Version 2 of the map is available.')).toHaveCount(0)
  await expect(courseList(page, 'H21').getByRole('listitem')).toHaveCount(3)
  await expect(page.getByTestId('course-length')).toHaveText(length)
  const { data: event } = await admin.from('events').select('map_version_id').eq('club_id', clubId).single()
  expect(event?.map_version_id).not.toBe(mapVersionId)
})

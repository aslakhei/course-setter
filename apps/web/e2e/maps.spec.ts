/// <reference lib="dom" />
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { expect, type Page, test } from '@playwright/test'
import { admin, createUser, deleteUsers, pageFor, type TestUser } from './users.ts'

const users: TestUser[] = []
const clubName = `E2E maps ${randomUUID().slice(0, 8)}`
// An OCAD 12 test map from ocad2geojson's test data, 1:15 000.
const fixture = fileURLToPath(new URL('../../worker/test/fixtures/ocad/basic-1.ocd', import.meta.url))

test.afterAll(async () => {
  const { data: club } = await admin.from('clubs').select('id').eq('name', clubName).maybeSingle()
  if (club) {
    const { data: versions } = await admin.from('map_versions').select('original_path, tiles_path').eq('club_id', club.id)
    for (const v of versions ?? []) {
      await admin.storage.from('map-originals').remove([v.original_path])
      if (v.tiles_path) await admin.storage.from('map-tiles').remove([v.tiles_path])
    }
    await admin.from('clubs').delete().eq('id', club.id)
  }
  await deleteUsers(users)
})

/** Non-white pixels the viewer has drawn so far. */
function inkedPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    let inked = 0
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>('[data-testid="map-viewer"] canvas')) {
      const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data ?? []
      for (let i = 0; i < data.length; i += 4)
        if ((data[i + 3] ?? 0) > 0 && (data[i] ?? 255) + (data[i + 1] ?? 255) + (data[i + 2] ?? 255) < 600) inked++
    }
    return inked
  })
}

test('an admin uploads a map, it is processed and shown, and members can open it', async ({ browser }) => {
  test.setTimeout(180_000)
  const [ada, mo, oz] = await Promise.all([createUser('Ada Admin'), createUser('Mo Member'), createUser('Oz Outsider')])
  users.push(ada, mo, oz)

  const adaPage = await pageFor(browser, ada)
  await adaPage.goto('/')
  await adaPage.getByLabel('Club name').fill(clubName)
  await adaPage.getByRole('button', { name: 'Create club' }).click()
  await expect(adaPage.getByRole('heading', { level: 1, name: clubName })).toBeVisible()
  const clubId = adaPage.url().split('/clubs/')[1] ?? ''
  await admin.from('club_members').insert({ club_id: clubId, user_id: mo.id, role: 'member' })

  // Upload through the form.
  await adaPage.getByRole('navigation', { name: 'Club' }).getByRole('link', { name: 'Maps' }).click()
  await adaPage.getByLabel('Map file').setInputFiles(fixture)
  await expect(adaPage.getByLabel('Map name')).toHaveValue('basic-1')
  await adaPage.getByLabel('Map name').fill('Test forest')
  await expect(adaPage.getByText('The scale is read from the OCAD file.')).toBeVisible()
  await adaPage.getByRole('button', { name: 'Upload', exact: true }).click()

  // The list follows processing and then links to the map.
  await expect(adaPage.getByText('Version 1 · 1:15 000 · OCAD')).toBeVisible({ timeout: 120_000 })
  await adaPage.getByRole('link', { name: 'Test forest' }).click()

  // The viewer draws the map and measures on it.
  const viewer = adaPage.getByTestId('map-viewer')
  await expect(viewer).toBeVisible()
  await expect.poll(() => inkedPixels(adaPage), { timeout: 30_000 }).toBeGreaterThan(20)
  await adaPage.getByRole('button', { name: 'Measure' }).click()
  const box = await viewer.boundingBox()
  if (!box) throw new Error('viewer has no size')
  await adaPage.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5)
  await adaPage.mouse.dblclick(box.x + box.width * 0.7, box.y + box.height * 0.5)
  await expect(adaPage.getByTestId('measured-length')).toHaveText(/^[\d .]+ m · [\d.]+ mm at 1:15 000$/)

  // A member sees the map and opens it.
  const moPage = await pageFor(browser, mo)
  await moPage.goto(`/clubs/${clubId}/maps`)
  await moPage.getByRole('link', { name: 'Test forest' }).click()
  await expect.poll(() => inkedPixels(moPage), { timeout: 30_000 }).toBeGreaterThan(20)
  await expect(moPage.getByRole('button', { name: 'Delete version' })).toHaveCount(0)
  await expect(moPage.getByRole('heading', { name: 'Upload a map' })).toHaveCount(0)

  // An outsider gets neither the club nor the map.
  const ozPage = await pageFor(browser, oz)
  await ozPage.goto(`/clubs/${clubId}/maps`)
  await expect(ozPage.getByText('This club does not exist, or you are not a member of it.')).toBeVisible()
})

test('a file that is not a map fails with an explanation for the admin', async ({ browser }) => {
  test.setTimeout(120_000)
  const ada = await createUser('Ada Admin')
  users.push(ada)
  const page = await pageFor(browser, ada)
  await page.goto('/')
  await page.getByLabel('Club name').fill(`${clubName} 2`)
  await page.getByRole('button', { name: 'Create club' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const clubId = page.url().split('/clubs/')[1] ?? ''
  await page.goto(`/clubs/${clubId}/maps`)

  await page
    .getByLabel('Map file')
    .setInputFiles({ name: 'notes.ocd', mimeType: 'application/octet-stream', buffer: Buffer.from('not a map') })
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  await expect(page.getByText(/could not be processed: the file is not an OCAD map\./)).toBeVisible({ timeout: 60_000 })

  await page.getByLabel('Map file').setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('jpg') })
  await expect(page.getByText('Choose an OCAD (.ocd) or PDF file.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Upload', exact: true })).toBeDisabled()

  const { data: versions } = await admin.from('map_versions').select('original_path').eq('club_id', clubId)
  for (const v of versions ?? []) await admin.storage.from('map-originals').remove([v.original_path])
  await admin.from('clubs').delete().eq('id', clubId)
})

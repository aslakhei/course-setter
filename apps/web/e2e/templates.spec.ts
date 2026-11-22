import type { EventDoc, PageElementSpec } from '@course-setter/core'
import { expect, type Page, test } from '@playwright/test'
import { admin, clubWithPdfMap, createUser, deleteUsers, pageFor, pdfMap, removeClub, type TestUser } from './users.ts'

const users: TestUser[] = []
const clubs: string[] = []

test.afterAll(async () => {
  for (const id of clubs) await removeClub(id)
  await deleteUsers(users)
})

const LOGO = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><circle cx="30" cy="30" r="28" fill="#1f5a3a"/></svg>',
)

async function saved(eventId: string): Promise<EventDoc> {
  const { data } = await admin.from('events').select('doc').eq('id', eventId).single()
  return data?.doc as EventDoc
}

async function waitSaved(page: Page) {
  await expect(page.getByTestId('save-status')).not.toHaveText(/^Saved/)
  await expect(page.getByTestId('save-status')).toHaveText(/^Saved/, { timeout: 15_000 })
}

test('club branding fills in a universal template, for every course or one', async ({ browser }) => {
  test.setTimeout(240_000)
  const ada = await createUser('Ada Admin')
  users.push(ada)
  const { clubId, mapVersionId } = await clubWithPdfMap(ada, 'Branding club', pdfMap(300, 200), 10000)
  clubs.push(clubId)
  const page = await pageFor(browser, ada)
  await page.setViewportSize({ width: 1500, height: 950 })

  // The logo in the club images, marked as a sponsor too; then the branding.
  await page.goto(`/clubs/${clubId}/settings`)
  const images = page.getByRole('region', { name: 'Club images' })
  await images.getByLabel('Image file').setInputFiles({ name: 'Logo.svg', mimeType: 'image/svg+xml', buffer: LOGO })
  await images.getByRole('button', { name: 'Upload image' }).click()
  await expect(images.getByText(/^SVG/)).toBeVisible({ timeout: 60_000 })
  await images.getByLabel('Logo is a sponsor').click()
  await expect(images.getByLabel('Logo is a sponsor')).toBeChecked()
  const branding = page.getByRole('region', { name: 'Branding' })
  await branding.getByTitle('Logo').click()
  await branding.getByLabel('Club colour 1').fill('#1f5a3a')
  await branding.getByRole('button', { name: 'Save' }).click()
  await expect(branding.getByText('Saved')).toBeVisible()
  const { data: club } = await admin.from('clubs').select('logo_asset_id, colour').eq('id', clubId).single()
  expect(club?.colour).toBe('#1f5a3a')
  const logoId = club?.logo_asset_id

  const doc: EventDoc = {
    schemaVersion: 1,
    standard: 'isom',
    controls: [{ id: 'a', kind: 'control', code: 31, position: [1500, 1000] }],
    courses: [
      { id: 'K', name: 'Long', controls: ['a'], printScale: 10000, bends: {}, numberPositions: {} },
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

  // Header band for every course: the club colour and logo.
  await page.goto(`/clubs/${clubId}/events/${eventId}?view=print&mode=layout`)
  await page.getByRole('complementary', { name: 'Layout' }).getByRole('button', { name: 'Templates' }).click()
  const gallery = page.getByRole('dialog', { name: 'Templates' })
  await expect(gallery.getByRole('img', { name: 'Header band' })).toBeVisible()
  await gallery.getByRole('button', { name: /^Header band/ }).click()
  await gallery.getByRole('button', { name: 'Use this template' }).click()
  await expect(gallery).toHaveCount(0)
  await waitSaved(page)
  let now = await saved(eventId)
  const elements = now.printLayout?.elements ?? []
  const band = elements.find(e => e.kind === 'shape') as Extract<PageElementSpec, { kind: 'shape' }>
  expect(band.fill?.color).toBe('#1f5a3a')
  expect(elements.find(e => e.kind === 'image')).toMatchObject({ asset: logoId })

  // Competition for Long only: its own layout, with the sponsor and a line round the map.
  await page.getByRole('complementary', { name: 'Layout' }).getByRole('button', { name: 'Templates' }).click()
  await gallery.getByRole('button', { name: /^Competition/ }).click()
  await gallery.getByText('Only Long', { exact: true }).click()
  await gallery.getByRole('button', { name: 'Use this template' }).click()
  await waitSaved(page)
  now = await saved(eventId)
  const own = now.courses.find(c => c.id === 'K')?.print?.ownLayout
  expect(own?.mapArea?.stroke?.color).toBe('#1f5a3a')
  // The logo is the club logo and the one sponsor.
  expect(own?.elements.filter(e => e.kind === 'image').map(e => (e.kind === 'image' ? e.asset : null))).toEqual([logoId, logoId])
  // The shared layout (Header band) is unchanged for Short.
  expect(now.printLayout?.elements.length).toBe(elements.length)
})

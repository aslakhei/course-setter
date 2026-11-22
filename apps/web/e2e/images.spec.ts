import type { EventDoc } from '@course-setter/core'
import { expect, test } from '@playwright/test'
import { admin, clubWithPdfMap, createUser, deleteUsers, JOB_WAIT, pageFor, pdfMap, removeClub, type TestUser } from './users.ts'

const users: TestUser[] = []
const clubs: string[] = []

test.afterAll(async () => {
  for (const id of clubs) await removeClub(id)
  await deleteUsers(users)
})

const LOGO = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#0b62a4"/><circle cx="60" cy="30" r="20" fill="#f08a24"/></svg>',
)
/** A 2 × 1 pixel PNG. */
const PIXELS = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGP4z8DAwMDAAAAfAAQBXd1+NQAAAABJRU5ErkJggg==', 'base64')

test('club images: an admin adds a logo, and a print layout with it makes a PDF', async ({ browser }) => {
  test.setTimeout(300_000)
  const ada = await createUser('Ada Admin')
  users.push(ada)
  const { clubId, mapVersionId } = await clubWithPdfMap(ada, 'Image club', pdfMap(300, 200), 10000)
  clubs.push(clubId)
  const page = await pageFor(browser, ada)

  // The club library, on the club's settings page.
  await page.goto(`/clubs/${clubId}/settings`)
  const library = page.getByRole('region', { name: 'Club images' })
  await expect(library.getByText('No images yet.')).toBeVisible()
  await library.getByLabel('Image file').setInputFiles({ name: 'Club logo.svg', mimeType: 'image/svg+xml', buffer: LOGO })
  await expect(library.getByLabel('Name')).toHaveValue('Club logo')
  await library.getByRole('button', { name: 'Upload image' }).click()
  await expect(library.getByText('SVG · 1 kB')).toBeVisible({ timeout: JOB_WAIT })
  // The thumbnail loads (decorative, so not an img role).
  await expect
    .poll(() => library.locator('img').evaluate(img => (img as HTMLImageElement).naturalWidth), { timeout: 15_000 })
    .toBeGreaterThan(0)

  // An event whose layout shows the logo prints.
  const { data: asset } = await admin.from('layout_assets').select('id').eq('club_id', clubId).single()
  const doc: EventDoc = {
    schemaVersion: 1,
    standard: 'isom',
    controls: [{ id: 'a', kind: 'control', code: 31, position: [1500, 1000] }],
    courses: [{ id: 'K', name: 'Long', controls: ['a'], printScale: 10000, bends: {}, numberPositions: {} }],
    specials: [],
    printLayout: { elements: [{ id: 'logo', kind: 'image', anchor: 'tr', offset: [10, 10], size: [40, 20], asset: asset?.id ?? '' }] },
  }
  const event = await admin
    .from('events')
    .insert({ club_id: clubId, name: 'Night', map_version_id: mapVersionId, doc, created_by: ada.id })
    .select('id')
    .single()
  if (event.error) throw event.error
  await admin.from('event_revisions').insert({ event_id: event.data.id, revision: 1, doc })
  await page.goto(`/clubs/${clubId}/events/${event.data.id}?view=print`)
  await page.getByRole('button', { name: 'Make PDF' }).click()
  await expect(page.getByTestId('export').getByRole('button', { name: /^Download/ })).toBeVisible({ timeout: JOB_WAIT })

  // Deleting the logo removes it from the library.
  page.once('dialog', dialog => dialog.accept())
  await page.goto(`/clubs/${clubId}/settings`)
  await library.getByRole('button', { name: 'Delete Club logo' }).click()
  await expect(library.getByText('No images yet.')).toBeVisible()
})

test('your images: anyone keeps their own images, and a file that is not an image fails with a reason', async ({ browser }) => {
  test.setTimeout(300_000)
  const mo = await createUser('Mo Member')
  users.push(mo)
  const page = await pageFor(browser, mo)
  await page.goto('/account')
  const library = page.getByRole('region', { name: 'Your images' })
  await library.getByLabel('Image file').setInputFiles({ name: 'dots.png', mimeType: 'image/png', buffer: PIXELS })
  await library.getByRole('button', { name: 'Upload image' }).click()
  await expect(library.getByText('PNG · 2 × 1 px · 1 kB')).toBeVisible({ timeout: JOB_WAIT })

  await library.getByLabel('Image file').setInputFiles({ name: 'fake.png', mimeType: 'image/png', buffer: LOGO })
  await library.getByRole('button', { name: 'Upload image' }).click()
  await expect(library.getByText('The file does not match its name')).toBeVisible({ timeout: JOB_WAIT })

  await library.getByLabel('Image file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') })
  await expect(library.getByText('Choose a PNG, JPEG, SVG or PDF file.')).toBeVisible()
})

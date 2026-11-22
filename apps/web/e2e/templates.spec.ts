import type { EventDoc, PageElementSpec } from '@course-setter/core'
import { expect, type Page, test } from '@playwright/test'
import { admin, clientFor, clubWithPdfMap, createUser, deleteUsers, JOB_WAIT, pageFor, pdfMap, removeClub, type TestUser } from './users.ts'

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
  await expect(images.getByText(/^SVG/)).toBeVisible({ timeout: JOB_WAIT })
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

/** A club library image uploaded through the API, waited for until it is ready. */
async function clubImage(user: TestUser, clubId: string, name: string): Promise<string> {
  const client = await clientFor(user)
  const started = await client.rpc('start_asset_upload', { scope: 'club', asset_name: name, kind: 'svg', club: clubId })
  if (started.error) throw started.error
  const reserved = started.data[0]
  if (!reserved) throw new Error('no upload')
  await client.storage.from('layout-assets').upload(reserved.upload_path, LOGO, { contentType: 'image/svg+xml' })
  await client.rpc('finish_asset_upload', { asset_id: reserved.asset_id })
  await expect
    .poll(async () => (await admin.from('layout_assets').select('status').eq('id', reserved.asset_id).single()).data?.status, {
      timeout: JOB_WAIT,
    })
    .toBe('ready')
  return reserved.asset_id
}

async function eventWith(clubId: string, mapVersionId: string, createdBy: string, layout: EventDoc['printLayout']): Promise<string> {
  const doc: EventDoc = {
    schemaVersion: 1,
    standard: 'isom',
    controls: [{ id: 'a', kind: 'control', code: 31, position: [1500, 1000] }],
    courses: [{ id: 'K', name: 'Long', controls: ['a'], printScale: 10000, bends: {}, numberPositions: {} }],
    specials: [],
    ...(layout ? { printLayout: layout } : {}),
  }
  const created = await admin
    .from('events')
    .insert({ club_id: clubId, name: 'Night', map_version_id: mapVersionId, doc, created_by: createdBy })
    .select('id')
    .single()
  if (created.error) throw created.error
  await admin.from('event_revisions').insert({ event_id: created.data.id, revision: 1, doc })
  return created.data.id
}

test('saved templates: a club template for its members, a personal one that follows its owner to another club', async ({ browser }) => {
  test.setTimeout(300_000)
  const [ada, mo] = await Promise.all([createUser('Ada Admin'), createUser('Mo Member')])
  users.push(ada, mo)
  const a = await clubWithPdfMap(ada, 'Club A', pdfMap(300, 200), 10000)
  const b = await clubWithPdfMap(ada, 'Club B', pdfMap(300, 200), 10000)
  clubs.push(a.clubId, b.clubId)
  await admin.from('club_members').insert({ club_id: a.clubId, user_id: mo.id, role: 'member' })
  const [logo, extra] = [await clubImage(ada, a.clubId, 'Logo A'), await clubImage(ada, a.clubId, 'Map of the area')]
  const client = await clientFor(ada)
  await client.rpc('set_club_branding', { club: a.clubId, logo_asset_id: logo, colour: '#1f5a3a' })
  await client.rpc('set_club_branding', { club: b.clubId, colour: '#c8102e' })

  // An event in club A with a band in the club colour, the club logo and another club image.
  const eventA = await eventWith(a.clubId, a.mapVersionId, ada.id, {
    elements: [
      {
        id: 'band',
        kind: 'shape',
        shape: 'rect',
        anchor: 'tl',
        offset: [0, 0],
        stretch: [0, 0],
        size: [1, 20],
        fill: { color: '#1f5a3a', opacity: 1 },
      },
      { id: 'logo', kind: 'image', anchor: 'tr', offset: [5, 3], size: [14, 14], asset: logo },
      { id: 'extra', kind: 'image', anchor: 'bl', offset: [8, 8], size: [30, 30], asset: extra },
    ],
  })
  await admin.from('event_members').insert({ event_id: eventA, user_id: mo.id })

  // Ada saves it as a club template and as one of her own.
  const page = await pageFor(browser, ada)
  await page.setViewportSize({ width: 1500, height: 950 })
  await page.goto(`/clubs/${a.clubId}/events/${eventA}?view=print&mode=layout`)
  await page.getByRole('complementary', { name: 'Layout' }).getByRole('button', { name: 'Templates' }).click()
  const gallery = page.getByRole('dialog', { name: 'Templates' })
  await gallery.getByLabel('Save the current layout as a template').fill('Club night')
  await gallery.getByText('Club A (admins)').click()
  await gallery.getByRole('button', { name: 'Save template' }).click()
  await expect(gallery.getByText('Saved “Club night”.')).toBeVisible()
  await gallery.getByLabel('Save the current layout as a template').fill('My style')
  await gallery.getByText('Mine', { exact: true }).click()
  await gallery.getByRole('button', { name: 'Save template' }).click()
  await expect(gallery.getByText('Saved “My style”.')).toBeVisible()
  const { data: rows } = await admin
    .from('layout_templates')
    .select('name, club_id, owner_id, layout')
    .in('name', ['Club night', 'My style'])
    .order('name')
  expect(rows?.map(t => [t.name, Boolean(t.club_id), Boolean(t.owner_id)])).toEqual([
    ['Club night', true, false],
    ['My style', false, true],
  ])
  // The club's colour and logo became tokens; the other image stays itself.
  const stored = JSON.stringify(rows?.[0]?.layout)
  expect(stored).toContain('{club.colour}')
  expect(stored).toContain('{club.logo}')
  expect(stored).toContain(extra)

  // Mo sees the club template but cannot save club templates.
  const moPage = await pageFor(browser, mo)
  await moPage.setViewportSize({ width: 1500, height: 950 })
  await moPage.goto(`/clubs/${a.clubId}/events/${eventA}?view=print&mode=layout`)
  await moPage.getByRole('complementary', { name: 'Layout' }).getByRole('button', { name: 'Templates' }).click()
  const moGallery = moPage.getByRole('dialog', { name: 'Templates' })
  await moGallery.getByText('Club A · 1').click()
  await expect(moGallery.getByRole('button', { name: /^Club night/ })).toBeVisible()
  await expect(moGallery.getByRole('radio', { name: 'Club A (admins)' })).toBeDisabled()
  await expect(moGallery.getByRole('button', { name: 'Delete template' })).toHaveCount(0)

  // In club B, Ada's own template takes club B's colour; club B has no logo, so none; the other image is copied into the event.
  const eventB = await eventWith(b.clubId, b.mapVersionId, ada.id, undefined)
  await page.goto(`/clubs/${b.clubId}/events/${eventB}?view=print&mode=layout`)
  await page.getByRole('complementary', { name: 'Layout' }).getByRole('button', { name: 'Templates' }).click()
  await gallery.getByText('Mine · 1').click()
  await gallery.getByRole('button', { name: /^My style/ }).click()
  await gallery.getByRole('button', { name: 'Use this template' }).click()
  await expect(gallery).toHaveCount(0)
  await waitSaved(page)
  const layout = (await saved(eventB)).printLayout
  const band = layout?.elements.find(e => e.kind === 'shape') as Extract<PageElementSpec, { kind: 'shape' }>
  expect(band.fill?.color).toBe('#c8102e')
  const imagesB = layout?.elements.filter(e => e.kind === 'image') as Extract<PageElementSpec, { kind: 'image' }>[]
  expect(imagesB).toHaveLength(1)
  const { data: copy } = await admin
    .from('layout_assets')
    .select('event_id, name')
    .eq('id', imagesB[0]?.asset ?? '')
    .single()
  expect(copy).toEqual({ event_id: eventB, name: 'Map of the area' })
})

// Deleting a club or an account end to end: the rows go at once, and the worker removes the files
// (map originals, tiles) that SQL cannot delete.
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { PDFDocument, rgb } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { localSupabase } from './local-supabase.ts'
import { startWorker, type TestWorker, waitFor } from './worker.ts'

const { url, secretKey, publishableKey } = localSupabase()
const admin = createClient(url, secretKey, { auth: { persistSession: false } })
const PT_PER_MM = 72 / 25.4

async function signedInUser(name: string): Promise<{ id: string; client: SupabaseClient }> {
  const email = `${name}-${randomUUID()}@example.com`
  const password = randomUUID()
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } })
  if (created.error) throw created.error
  const client = createClient(url, publishableKey, { auth: { persistSession: false } })
  const signedIn = await client.auth.signInWithPassword({ email, password })
  if (signedIn.error) throw signedIn.error
  return { id: created.data.user.id, client }
}

/** A club with a processed PDF map: an original and a tiles file in Storage. */
async function clubWithMap(user: { client: SupabaseClient }, name: string): Promise<string> {
  const club = await user.client.rpc('create_club', { club_name: name })
  if (club.error) throw club.error
  const pdf = await PDFDocument.create()
  // Not blank (blank maps are refused).
  pdf
    .addPage([100 * PT_PER_MM, 80 * PT_PER_MM])
    .drawCircle({ x: 50 * PT_PER_MM, y: 40 * PT_PER_MM, size: 2 * PT_PER_MM, color: rgb(0, 0, 0) })
  const started = await user.client.rpc('start_map_upload', {
    club: club.data,
    file_name: 'm.pdf',
    kind: 'pdf',
    map_name: 'M',
    scale: 10000,
  })
  if (started.error) throw started.error
  const { version_id, upload_path } = started.data[0]
  const put = await user.client.storage.from('map-originals').upload(upload_path, await pdf.save(), { contentType: 'application/pdf' })
  if (put.error) throw put.error
  const finished = await user.client.rpc('finish_map_upload', { map_version_id: version_id })
  if (finished.error) throw finished.error
  await waitFor(`version ${version_id}`, async () => {
    const { data } = await admin.from('map_versions').select('status').eq('id', version_id).single()
    return data?.status === 'ready' ? true : undefined
  })
  return club.data
}

/** Names of the club's files in a bucket (they all sit under <club id>/). */
async function filesOf(clubId: string, bucket: string): Promise<string[]> {
  const names: string[] = []
  const walk = async (prefix: string) => {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 })
    if (error) throw error
    for (const item of data ?? []) {
      if (item.id) names.push(`${prefix}/${item.name}`)
      else await walk(`${prefix}/${item.name}`)
    }
  }
  await walk(clubId)
  return names
}

const removed = (clubId: string) =>
  waitFor(
    `files of ${clubId} removed`,
    async () => {
      const left = [...(await filesOf(clubId, 'map-originals')), ...(await filesOf(clubId, 'map-tiles'))]
      return left.length === 0 ? true : undefined
    },
    60_000,
  )

describe('deleting clubs and accounts', () => {
  let worker: TestWorker
  const users: string[] = []

  beforeAll(async () => {
    worker = await startWorker()
  })

  afterAll(async () => {
    for (const id of users) await admin.auth.admin.deleteUser(id).catch(() => undefined)
    await worker.stop()
  })

  it('an admin deletes a club: its rows go and the worker removes its files', { timeout: 180_000 }, async () => {
    const ada = await signedInUser('ada')
    users.push(ada.id)
    const clubId = await clubWithMap(ada, 'Deleted club')
    expect((await filesOf(clubId, 'map-originals')).length).toBe(1)
    expect((await filesOf(clubId, 'map-tiles')).length).toBe(1)

    const deleted = await ada.client.rpc('delete_club', { club: clubId })
    expect(deleted.error).toBeNull()
    const { data: club } = await admin.from('clubs').select('id').eq('id', clubId)
    expect(club).toEqual([])
    await removed(clubId)
  })

  it('someone deletes their account: they are signed out for good, and a club they were alone in goes too', {
    timeout: 180_000,
  }, async () => {
    const bo = await signedInUser('bo')
    users.push(bo.id)
    const clubId = await clubWithMap(bo, 'Bo alone')

    const deleted = await bo.client.rpc('delete_my_account')
    expect(deleted.error).toBeNull()
    const user = await admin.auth.admin.getUserById(bo.id)
    expect(user.data.user).toBeNull()
    const { data: club } = await admin.from('clubs').select('id').eq('id', clubId)
    expect(club).toEqual([])
    await removed(clubId)
  })

  it('the only admin of a club with members is told to make someone else admin first', async () => {
    const cy = await signedInUser('cy')
    const di = await signedInUser('di')
    users.push(cy.id, di.id)
    const club = await cy.client.rpc('create_club', { club_name: 'Shared club' })
    if (club.error) throw club.error
    await admin.from('club_members').insert({ club_id: club.data, user_id: di.id, role: 'member' })

    const refused = await cy.client.rpc('delete_my_account')
    expect(refused.error).toMatchObject({ hint: 'only_admin' })
    expect(JSON.parse(refused.error?.details ?? '[]')).toEqual(['Shared club'])
    await admin.from('clubs').delete().eq('id', club.data)
  })
})

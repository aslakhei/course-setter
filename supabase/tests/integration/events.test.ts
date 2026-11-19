// Events through the API as the editor uses it: two people with access save the same event; the one
// saving from an out-of-date revision gets the conflict with who saved and when, and a member who has
// not been invited sees nothing.
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { localSupabase } from './local-supabase.ts'

const { url, secretKey, publishableKey } = localSupabase()
const admin = createClient(url, secretKey, { auth: { persistSession: false } })

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

describe('events', () => {
  let cleo: Awaited<ReturnType<typeof signedInUser>>
  let ivan: Awaited<ReturnType<typeof signedInUser>>
  let mo: Awaited<ReturnType<typeof signedInUser>>
  let clubId = ''
  let eventId = ''

  beforeAll(async () => {
    ;[cleo, ivan, mo] = await Promise.all([signedInUser('Cleo'), signedInUser('Ivan'), signedInUser('Mo')])
    const club = await cleo.client.rpc('create_club', { club_name: 'Events test club' })
    if (club.error) throw club.error
    clubId = club.data
    await admin.from('club_members').insert([
      { club_id: clubId, user_id: ivan.id, role: 'member' },
      { club_id: clubId, user_id: mo.id, role: 'member' },
    ])
    const map = await admin.from('maps').insert({ club_id: clubId, name: 'Skogen' }).select('id').single()
    const version = await admin
      .from('map_versions')
      .insert({
        map_id: map.data?.id,
        club_id: clubId,
        version: 1,
        kind: 'ocad',
        status: 'ready',
        file_name: 'a.ocd',
        original_path: `events-test/${randomUUID()}`,
        scale: 15000,
      })
      .select('id')
      .single()
    const created = await cleo.client.rpc('create_event', { club: clubId, event_name: 'Tuesday', map_version: version.data?.id ?? '' })
    if (created.error) throw created.error
    eventId = created.data
  })

  afterAll(async () => {
    await admin.from('clubs').delete().eq('id', clubId)
    for (const user of [cleo, ivan, mo]) if (user) await admin.auth.admin.deleteUser(user.id)
  })

  it('shows the event only to people with access, and lets them invite', async () => {
    expect((await mo.client.from('events').select('id')).data).toEqual([])
    expect((await ivan.client.from('events').select('id')).data).toEqual([])
    const invited = await cleo.client.from('event_members').insert({ event_id: eventId, user_id: ivan.id })
    expect(invited.error).toBeNull()
    expect((await ivan.client.from('events').select('id')).data).toEqual([{ id: eventId }])
    expect((await mo.client.from('events').select('id')).data).toEqual([])
  })

  it('refuses a save from an out-of-date revision and says who saved', async () => {
    const doc = { schemaVersion: 1, controls: [], courses: [] }
    const first = await ivan.client.rpc('save_event', { event: eventId, doc, expected_revision: 1 })
    expect(first).toMatchObject({ error: null, data: 2 })

    const stale = await cleo.client.rpc('save_event', { event: eventId, doc, expected_revision: 1 })
    expect(stale.error?.hint).toBe('conflict')
    expect(JSON.parse(stale.error?.details ?? '{}')).toMatchObject({ revision: 2, savedBy: 'Ivan', savedAt: expect.any(String) })

    const retried = await cleo.client.rpc('save_event', { event: eventId, doc, expected_revision: 2 })
    expect(retried).toMatchObject({ error: null, data: 3 })
  })
})

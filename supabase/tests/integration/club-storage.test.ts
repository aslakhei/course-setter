// Club map files through the real Storage API: only club members can create signed URLs for tiles,
// nobody (not even admins) can for originals. Users sign in with a password, which only local Supabase
// allows; the app itself uses Google.
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

describe('club map files in Storage', () => {
  let ada: Awaited<ReturnType<typeof signedInUser>>
  let oz: Awaited<ReturnType<typeof signedInUser>>
  let clubId = ''
  const tilePath = () => `${clubId}/map1/v1/tiles.pmtiles`
  const originalPath = () => `${clubId}/map1/v1/map.ocd`

  beforeAll(async () => {
    ada = await signedInUser('ada')
    oz = await signedInUser('oz')
    const club = await ada.client.rpc('create_club', { club_name: 'Storage test club' })
    if (club.error) throw club.error
    clubId = club.data
    // Tiles are written by the worker (secret key); the admin uploads the original.
    const tile = await admin.storage.from('map-tiles').upload(tilePath(), new Uint8Array([1, 2, 3]))
    if (tile.error) throw tile.error
    const original = await ada.client.storage.from('map-originals').upload(originalPath(), new Uint8Array([4, 5, 6]))
    if (original.error) throw original.error
  })

  afterAll(async () => {
    await admin.storage.from('map-tiles').remove([tilePath()])
    await admin.storage.from('map-originals').remove([originalPath()])
    await admin.from('clubs').delete().eq('id', clubId)
    for (const user of [ada, oz]) if (user) await admin.auth.admin.deleteUser(user.id)
  })

  it('lets a member create a signed URL for tiles', async () => {
    const { data, error } = await ada.client.storage.from('map-tiles').createSignedUrl(tilePath(), 60)
    expect(error).toBeNull()
    const res = await fetch(data?.signedUrl ?? '')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('refuses tiles to an outsider', async () => {
    const signed = await oz.client.storage.from('map-tiles').createSignedUrl(tilePath(), 60)
    expect(signed.error).not.toBeNull()
    const download = await oz.client.storage.from('map-tiles').download(tilePath())
    expect(download.error).not.toBeNull()
    const list = await oz.client.storage.from('map-tiles').list(clubId)
    expect(list.data ?? []).toEqual([])
  })

  it('never hands out originals, not even to the admin', async () => {
    const signed = await ada.client.storage.from('map-originals').createSignedUrl(originalPath(), 60)
    expect(signed.error).not.toBeNull()
    const download = await ada.client.storage.from('map-originals').download(originalPath())
    expect(download.error).not.toBeNull()
  })

  it('refuses uploads of originals by an outsider', async () => {
    const { error } = await oz.client.storage.from('map-originals').upload(`${clubId}/map1/v9/evil.ocd`, new Uint8Array([0]))
    expect(error).not.toBeNull()
  })

  it('shows the club to a member who joined through an invite link', async () => {
    const invite = await ada.client.from('club_invites').insert({ club_id: clubId }).select('token').single()
    if (invite.error) throw invite.error
    expect((await oz.client.from('clubs').select('id')).data).toEqual([])

    const joined = await oz.client.rpc('accept_invite', { invite_token: invite.data.token })
    expect(joined.error).toBeNull()
    expect(joined.data).toBe(clubId)
    expect((await oz.client.from('clubs').select('id')).data).toEqual([{ id: clubId }])
    expect((await oz.client.storage.from('map-tiles').createSignedUrl(tilePath(), 60)).error).toBeNull()
  })
})

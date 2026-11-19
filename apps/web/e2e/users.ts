import { randomUUID } from 'node:crypto'
import type { Browser, Page } from '@playwright/test'
import { createClient, type Session } from '@supabase/supabase-js'
import { localSupabase } from '../../../supabase/tests/integration/local-supabase.ts'

const supabase = localSupabase()
export const admin = createClient(supabase.url, supabase.secretKey, { auth: { persistSession: false } })

export type TestUser = { id: string; name: string; session: Session }

/**
 * A confirmed user with a password, signed in from Node. The app only offers Google sign-in; password
 * sign-in exists on local Supabase only, so tests get a real session without a test-only login page.
 */
export async function createUser(name: string): Promise<TestUser> {
  const email = `e2e-${randomUUID()}@example.com`
  const password = randomUUID()
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } })
  if (created.error) throw created.error
  const client = createClient(supabase.url, supabase.publishableKey, { auth: { persistSession: false } })
  const signedIn = await client.auth.signInWithPassword({ email, password })
  if (signedIn.error) throw signedIn.error
  return { id: created.data.user.id, name, session: signedIn.data.session }
}

export async function deleteUsers(users: TestUser[]) {
  for (const user of users) await admin.auth.admin.deleteUser(user.id)
}

/** A page in its own browser context, signed in as `user` (the session is where supabase-js keeps it). */
export async function pageFor(browser: Browser, user: TestUser): Promise<Page> {
  const context = await browser.newContext()
  const storageKey = `sb-${new URL(supabase.url).hostname.split('.')[0]}-auth-token`
  await context.addInitScript({
    content: `localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(JSON.stringify(user.session))})`,
  })
  return context.newPage()
}

/** A Supabase client signed in as `user`, for setting up data through the API. */
export async function clientFor(user: TestUser) {
  const client = createClient(supabase.url, supabase.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await client.auth.setSession(user.session)
  if (error) throw error
  return client
}

/** A club with `admin` as admin and one processed OCAD map (the worker must be running: see global-setup.ts). */
export async function clubWithMap(admin_: TestUser, clubName: string, ocdFile: string): Promise<{ clubId: string; mapVersionId: string }> {
  const client = await clientFor(admin_)
  const club = await client.rpc('create_club', { club_name: clubName })
  if (club.error) throw club.error
  const started = await client.rpc('start_map_upload', { club: club.data, file_name: 'map.ocd', kind: 'ocad', map_name: 'Test forest' })
  if (started.error) throw started.error
  const { version_id, upload_path } = started.data[0]
  const { readFileSync } = await import('node:fs')
  const put = await client.storage
    .from('map-originals')
    .upload(upload_path, readFileSync(ocdFile), { contentType: 'application/octet-stream' })
  if (put.error) throw put.error
  const finished = await client.rpc('finish_map_upload', { map_version_id: version_id })
  if (finished.error) throw finished.error
  for (let i = 0; i < 300; i++) {
    const { data } = await admin.from('map_versions').select('status').eq('id', version_id).single()
    if (data?.status === 'ready') return { clubId: club.data, mapVersionId: version_id }
    if (data?.status === 'failed') throw new Error('test map failed to process')
    await new Promise(resolve => setTimeout(resolve, 400))
  }
  throw new Error('test map was not processed in time')
}

/** Remove a club with its map files. */
export async function removeClub(clubId: string) {
  const { data: versions } = await admin.from('map_versions').select('original_path, tiles_path').eq('club_id', clubId)
  for (const v of versions ?? []) {
    await admin.storage.from('map-originals').remove([v.original_path])
    if (v.tiles_path) await admin.storage.from('map-tiles').remove([v.tiles_path])
  }
  await admin.from('events').delete().eq('club_id', clubId)
  await admin.from('clubs').delete().eq('id', clubId)
}

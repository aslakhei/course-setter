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
  const { readFileSync } = await import('node:fs')
  return clubWithMapFile(admin_, clubName, { kind: 'ocad', bytes: readFileSync(ocdFile) })
}

/** A club with `admin` as admin and one processed PDF map at `scale`: quick to print, as it stays vector. */
export async function clubWithPdfMap(admin_: TestUser, clubName: string, pdf: Uint8Array, scale: number) {
  return clubWithMapFile(admin_, clubName, { kind: 'pdf', bytes: pdf, scale })
}

async function clubWithMapFile(
  admin_: TestUser,
  clubName: string,
  map: { kind: 'ocad' | 'pdf'; bytes: Uint8Array; scale?: number },
): Promise<{ clubId: string; mapVersionId: string }> {
  const client = await clientFor(admin_)
  const club = await client.rpc('create_club', { club_name: clubName })
  if (club.error) throw club.error
  const started = await client.rpc('start_map_upload', {
    club: club.data,
    file_name: map.kind === 'pdf' ? 'map.pdf' : 'map.ocd',
    kind: map.kind,
    map_name: 'Test forest',
    ...(map.scale ? { scale: map.scale } : {}),
  })
  if (started.error) throw started.error
  const { version_id, upload_path } = started.data[0]
  const put = await client.storage
    .from('map-originals')
    .upload(upload_path, map.bytes, { contentType: map.kind === 'pdf' ? 'application/pdf' : 'application/octet-stream' })
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

/**
 * A plain PDF map, `widthMm` × `heightMm`: a pale ground with a dark 20 mm grid, written by hand (a
 * catalog, the page tree, one page and its drawing) so the tests need no PDF library.
 */
export function pdfMap(widthMm: number, heightMm: number): Uint8Array {
  const pt = (mm: number) => +((mm * 72) / 25.4).toFixed(2)
  const [w, h] = [pt(widthMm), pt(heightMm)]
  const drawing = ['1 0.96 0.85 rg', `0 0 ${w} ${h} re f`, '0.25 0.25 0.25 RG', '0.6 w']
  for (let x = 20; x < widthMm; x += 20) drawing.push(`${pt(x)} 0 m ${pt(x)} ${h} l`)
  for (let y = 20; y < heightMm; y += 20) drawing.push(`0 ${pt(y)} m ${w} ${pt(y)} l`)
  drawing.push('S')
  const content = drawing.join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]
  // Every character is ASCII, so string lengths are byte offsets.
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((o, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  out += offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(out)
}

/** Remove a club with its map files and PDF exports. */
export async function removeClub(clubId: string) {
  const { data: exports } = await admin.from('exports').select('path').eq('club_id', clubId)
  const exportPaths = (exports ?? []).map(x => x.path).filter((p): p is string => Boolean(p))
  if (exportPaths.length) await admin.storage.from('exports').remove(exportPaths)
  const { data: versions } = await admin.from('map_versions').select('original_path, tiles_path').eq('club_id', clubId)
  for (const v of versions ?? []) {
    await admin.storage.from('map-originals').remove([v.original_path])
    if (v.tiles_path) await admin.storage.from('map-tiles').remove([v.tiles_path])
  }
  await admin.from('events').delete().eq('club_id', clubId)
  await admin.from('clubs').delete().eq('id', clubId)
}

/** Upload another version of a club's map (same file is fine: it lines up as unchanged). */
export async function uploadNewVersion(admin_: TestUser, clubId: string, mapId: string, ocdFile: string): Promise<string> {
  const client = await clientFor(admin_)
  const started = await client.rpc('start_map_upload', { club: clubId, file_name: 'map-v2.ocd', kind: 'ocad', map_id: mapId })
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
    if (data?.status === 'ready') return version_id
    if (data?.status === 'failed' || data?.status === 'needs_alignment') throw new Error(`new version is ${data.status}`)
    await new Promise(resolve => setTimeout(resolve, 400))
  }
  throw new Error('new version was not processed in time')
}

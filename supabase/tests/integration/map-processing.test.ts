// Map upload and processing end to end: an admin uploads a map through the upload flow, the worker
// turns it into a PMTiles archive and fills in the version, members get the tiles; broken files fail
// with a code the app can explain; deleting removes the files. See worker.ts for which worker.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { PDFDocument } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { localSupabase } from './local-supabase.ts'
import { startWorker, type TestWorker, waitFor } from './worker.ts'

const { url, secretKey, publishableKey } = localSupabase()
const admin = createClient(url, secretKey, { auth: { persistSession: false } })
const fixture = readFileSync(fileURLToPath(new URL('../../../apps/worker/test/fixtures/ocad/basic-1.ocd', import.meta.url)))

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

type Version = {
  id: string
  status: string
  error_code: string | null
  scale: number | null
  ocad_version: string | null
  tiles_path: string | null
}

describe('map processing', () => {
  let worker: TestWorker
  let ada: Awaited<ReturnType<typeof signedInUser>>
  let mo: Awaited<ReturnType<typeof signedInUser>>
  let clubId = ''

  async function upload(fileName: string, bytes: Uint8Array, version?: { mapId: string; scale?: number }): Promise<string> {
    const kind = fileName.endsWith('.pdf') ? 'pdf' : 'ocad'
    const started = await ada.client.rpc('start_map_upload', {
      club: clubId,
      file_name: fileName,
      kind,
      ...(version ? { map_id: version.mapId } : { map_name: fileName }),
      ...(kind === 'pdf' ? { scale: version?.scale ?? 15000 } : {}),
    })
    if (started.error) throw started.error
    const { version_id, upload_path } = started.data[0]
    const put = await ada.client.storage
      .from('map-originals')
      .upload(upload_path, bytes, { contentType: kind === 'pdf' ? 'application/pdf' : 'application/octet-stream' })
    if (put.error) throw put.error
    const finished = await ada.client.rpc('finish_map_upload', { map_version_id: version_id })
    if (finished.error) throw finished.error
    return version_id
  }

  const versionWhen = (id: string, done: (v: Version) => boolean) =>
    waitFor(`map version ${id}`, async () => {
      const { data } = await admin
        .from('map_versions')
        .select('id, status, error_code, scale, ocad_version, tiles_path')
        .eq('id', id)
        .maybeSingle()
      return data && done(data as Version) ? (data as Version) : undefined
    })

  beforeAll(async () => {
    worker = await startWorker()
    ada = await signedInUser('ada')
    mo = await signedInUser('mo')
    const club = await ada.client.rpc('create_club', { club_name: 'Map processing club' })
    if (club.error) throw club.error
    clubId = club.data
    await admin.from('club_members').insert({ club_id: clubId, user_id: mo.id, role: 'member' })
  })

  afterAll(async () => {
    const { data: versions } = await admin.from('map_versions').select('id, original_path, tiles_path').eq('club_id', clubId)
    for (const v of versions ?? []) {
      await admin.storage.from('map-originals').remove([v.original_path])
      if (v.tiles_path) await admin.storage.from('map-tiles').remove([v.tiles_path])
      await worker.sql`delete from public.jobs where payload ->> 'map_version_id' = ${v.id}`
    }
    await admin.from('clubs').delete().eq('id', clubId)
    for (const user of [ada, mo]) if (user) await admin.auth.admin.deleteUser(user.id)
    await worker.stop()
  })

  it('turns an uploaded OCAD map into tiles that members can open', { timeout: 120_000 }, async () => {
    const id = await upload('basic-1.ocd', fixture)
    const v = await versionWhen(id, v => v.status !== 'processing')
    expect(v).toMatchObject({ status: 'ready', error_code: null, scale: 15000, ocad_version: '12' })
    expect(v.tiles_path).toBe(`${clubId}/${v.tiles_path?.split('/')[1]}/${id}/tiles.pmtiles`)

    // The member sees the ready version and can read its tiles through a signed URL.
    const seen = await mo.client.from('map_versions').select('id, frame, tiles').eq('id', id).single()
    expect(seen.error).toBeNull()
    expect(seen.data?.frame).toMatchObject({ minX: expect.any(Number), maxY: expect.any(Number) })
    const signed = await mo.client.storage.from('map-tiles').createSignedUrl(v.tiles_path ?? '', 60)
    expect(signed.error).toBeNull()
    const head = await fetch(signed.data?.signedUrl ?? '', { headers: { range: 'bytes=0-6' } })
    expect(head.status).toBe(206)
    expect(await head.text()).toBe('PMTiles')
  })

  it('lines up new versions automatically when it can, and waits for the admin when it cannot', { timeout: 180_000 }, async () => {
    const first = await upload('lined-up.ocd', fixture)
    await versionWhen(first, v => v.status === 'ready')
    const { data: row } = await admin.from('map_versions').select('map_id').eq('id', first).single()
    const mapId = row?.map_id ?? ''

    // The same OCAD map again: same georeferencing, so nothing moved.
    const second = await upload('lined-up-2.ocd', fixture, { mapId })
    await versionWhen(second, v => v.status !== 'processing')
    const auto = await admin
      .from('map_versions')
      .select('status, previous_version_id, transform_method, transform_from_previous')
      .eq('id', second)
      .single()
    expect(auto.data).toEqual({
      status: 'ready',
      previous_version_id: first,
      transform_method: 'identity',
      transform_from_previous: { a: 1, b: 0, tx: 0, ty: 0 },
    })

    // A PDF has no georeferencing: it waits until an admin has matched points.
    const pdf = await PDFDocument.create()
    pdf.addPage([400, 300]).drawCircle({ x: 200, y: 150, size: 20 })
    const third = await upload('lined-up.pdf', await pdf.save(), { mapId, scale: 15000 })
    const waiting = await versionWhen(third, v => v.status !== 'processing')
    expect(waiting.status).toBe('needs_alignment')
    expect((await mo.client.from('map_versions').select('id').eq('id', third)).data).toEqual([])

    const saved = await ada.client.rpc('set_map_version_alignment', {
      map_version_id: third,
      transform: { a: 1.0002, b: -0.01, tx: 15.5, ty: -3 },
      rms_m: 1.4,
    })
    expect(saved.error).toBeNull()
    const done = await admin
      .from('map_versions')
      .select('status, previous_version_id, transform_method, transform_rms_m')
      .eq('id', third)
      .single()
    expect(done.data).toEqual({ status: 'ready', previous_version_id: second, transform_method: 'points', transform_rms_m: 1.4 })
  })

  it('fails a file that is not an OCAD map with a code the app can explain', { timeout: 60_000 }, async () => {
    const id = await upload('notes.ocd', new TextEncoder().encode('this is not a map'))
    const v = await versionWhen(id, v => v.status !== 'processing')
    expect(v).toMatchObject({ status: 'failed', error_code: 'not_ocad' })
  })

  it('removes the files when a version is deleted', { timeout: 120_000 }, async () => {
    const id = await upload('to-delete.ocd', fixture)
    const ready = await versionWhen(id, v => v.status === 'ready')
    const { data: row } = await admin.from('map_versions').select('map_id, original_path').eq('id', id).single()

    expect((await ada.client.rpc('delete_map_version', { map_version_id: id })).error).toBeNull()
    await waitFor('version row removed', async () => {
      const { data } = await admin.from('map_versions').select('id').eq('id', id).maybeSingle()
      return data === null ? true : undefined
    })
    expect((await admin.storage.from('map-originals').download(row?.original_path ?? '')).error).not.toBeNull()
    expect((await admin.storage.from('map-tiles').download(ready.tiles_path ?? '')).error).not.toBeNull()
    expect(
      (
        await admin
          .from('maps')
          .select('id')
          .eq('id', row?.map_id ?? '')
      ).data,
    ).toEqual([])
  })
})

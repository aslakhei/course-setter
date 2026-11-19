// Moving an event to a new map version keeps its controls on the same terrain features. Version 1 is a
// PDF map with black dots at known places; version 2 is the same map turned 3° and shifted (as a redrawn
// map would be), lined up with the exact transform. An event with controls on the dots is moved to
// version 2 the way the editor does it, and every control must land on a dot in version 2's tiles.
import { randomUUID } from 'node:crypto'
import { type EventDoc, moveDocToVersion, type Point, type Similarity, type TileGrid, transformBetween } from '@course-setter/core'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { PDFDocument, rgb } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isDark, pixelAt, readArchive } from '../../../apps/worker/src/maps/test-helpers.ts'
import { localSupabase } from './local-supabase.ts'
import { startWorker, type TestWorker, waitFor } from './worker.ts'

const { url, secretKey, publishableKey } = localSupabase()
const admin = createClient(url, secretKey, { auth: { persistSession: false } })

const PT_PER_MM = 72 / 25.4
const SCALE = 10000 // 1 mm on paper = 10 m
const PAGE: Point = [200, 150] // mm
/** Paper positions (mm from the bottom-left corner) of the features controls are put on. */
const DOTS: Point[] = [
  [20, 20],
  [60, 110],
  [100, 75],
  [150, 40],
  [180, 130],
]
// Version 2: the drawing turned 3° about the page centre and moved 8 mm right, 5 mm down.
const TURN = (3 * Math.PI) / 180
const SHIFT: Point = [8, -5]
const onVersion2 = ([x, y]: Point): Point => {
  const [cx, cy] = [PAGE[0] / 2, PAGE[1] / 2]
  const [dx, dy] = [x - cx, y - cy]
  return [cx + dx * Math.cos(TURN) - dy * Math.sin(TURN) + SHIFT[0], cy + dx * Math.sin(TURN) + dy * Math.cos(TURN) + SHIFT[1]]
}
/** The same in ground metres: frame = paper mm × scale / 1000, origin at the page's bottom-left. */
const toFrame = ([x, y]: Point): Point => [(x * SCALE) / 1000, (y * SCALE) / 1000]
const exactTransform = (): Similarity => {
  const c = toFrame([PAGE[0] / 2, PAGE[1] / 2])
  const s = toFrame(SHIFT)
  const a = Math.cos(TURN)
  const b = Math.sin(TURN)
  return { a, b, tx: c[0] + s[0] - (a * c[0] - b * c[1]), ty: c[1] + s[1] - (b * c[0] + a * c[1]) }
}

async function pdfWithDots(dots: Point[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([PAGE[0] * PT_PER_MM, PAGE[1] * PT_PER_MM])
  for (const [x, y] of dots) page.drawCircle({ x: x * PT_PER_MM, y: y * PT_PER_MM, size: 0.8 * PT_PER_MM, color: rgb(0, 0, 0) })
  return doc.save()
}

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

describe('moving an event to a new map version', () => {
  let worker: TestWorker
  let ada: Awaited<ReturnType<typeof signedInUser>>
  let clubId = ''

  async function uploadPdf(bytes: Uint8Array, mapId?: string): Promise<string> {
    const started = await ada.client.rpc('start_map_upload', {
      club: clubId,
      file_name: 'map.pdf',
      kind: 'pdf',
      scale: SCALE,
      ...(mapId ? { map_id: mapId } : { map_name: 'Dots' }),
    })
    if (started.error) throw started.error
    const { version_id, upload_path } = started.data[0]
    const put = await ada.client.storage.from('map-originals').upload(upload_path, bytes, { contentType: 'application/pdf' })
    if (put.error) throw put.error
    const finished = await ada.client.rpc('finish_map_upload', { map_version_id: version_id })
    if (finished.error) throw finished.error
    await waitFor(`version ${version_id}`, async () => {
      const { data } = await admin.from('map_versions').select('status').eq('id', version_id).single()
      return data && data.status !== 'processing' ? data.status : undefined
    })
    return version_id
  }

  beforeAll(async () => {
    worker = await startWorker()
    ada = await signedInUser('ada')
    const club = await ada.client.rpc('create_club', { club_name: 'Event move club' })
    if (club.error) throw club.error
    clubId = club.data
  })

  afterAll(async () => {
    const { data: versions } = await admin.from('map_versions').select('id, original_path, tiles_path').eq('club_id', clubId)
    await admin.from('events').delete().eq('club_id', clubId)
    for (const v of versions ?? []) {
      await admin.storage.from('map-originals').remove([v.original_path])
      if (v.tiles_path) await admin.storage.from('map-tiles').remove([v.tiles_path])
      await worker.sql`delete from public.jobs where payload ->> 'map_version_id' = ${v.id}`
    }
    await admin.from('clubs').delete().eq('id', clubId)
    if (ada) await admin.auth.admin.deleteUser(ada.id)
    await worker.stop()
  })

  it('keeps every control on the same feature on a turned and shifted new version', { timeout: 180_000 }, async () => {
    const v1 = await uploadPdf(await pdfWithDots(DOTS))
    const { data: first } = await admin.from('map_versions').select('map_id').eq('id', v1).single()
    const v2 = await uploadPdf(await pdfWithDots(DOTS.map(onVersion2)), first?.map_id)
    // A PDF has no georeferencing: lined up by hand, here with the exact answer.
    const aligned = await ada.client.rpc('set_map_version_alignment', { map_version_id: v2, transform: exactTransform(), rms_m: 0 })
    expect(aligned.error).toBeNull()

    // An event on version 1 with a control on each dot.
    const created = await ada.client.rpc('create_event', { club: clubId, event_name: 'Dots training', map_version: v1 })
    if (created.error) throw created.error
    const doc: EventDoc = {
      schemaVersion: 1,
      standard: 'isom',
      controls: DOTS.map((p, i) => ({ id: `c${i}`, kind: 'control' as const, code: 31 + i, position: toFrame(p) })),
      courses: [],
    }
    const saved = await ada.client.rpc('save_event', { event: created.data, doc, expected_revision: 1 })
    expect(saved.error).toBeNull()

    // What the editor does: the transform along the version chain, applied to the document, saved together with the new version.
    const { data: rows } = await ada.client
      .from('map_versions')
      .select('id, previous_version_id, transform_from_previous, tiles, tiles_path')
      .in('id', [v1, v2])
    const links = (rows ?? []).map(r => ({
      id: r.id,
      previousVersionId: r.previous_version_id,
      transform: r.transform_from_previous as Similarity | null,
    }))
    const transform = transformBetween(links, v1, v2)
    if (!transform) throw new Error('no transform from version 1 to 2')
    const target = rows?.find(r => r.id === v2)
    const grid = target?.tiles as TileGrid
    const { doc: moved, outside } = moveDocToVersion(doc, transform, grid.extent)
    expect(outside).toEqual([])
    const result = await ada.client.rpc('move_event_to_version', { event: created.data, map_version: v2, doc: moved, expected_revision: 2 })
    expect(result).toMatchObject({ error: null, data: 3 })

    // Every control of the stored event lies on a dot in version 2's tiles; the old positions do not.
    const { data: event } = await admin.from('events').select('map_version_id, doc').eq('id', created.data).single()
    expect(event?.map_version_id).toBe(v2)
    const download = await admin.storage.from('map-tiles').download(target?.tiles_path ?? '')
    if (download.error) throw download.error
    const reader = readArchive(Buffer.from(await download.data.arrayBuffer()))
    const finest = grid.levels.length - 1
    if (!event) throw new Error('event missing after the move')
    const stored = (event.doc as EventDoc).controls
    for (const control of stored) {
      expect(isDark(await pixelAt(reader, grid, finest, control.position[0], control.position[1]))).toBe(true)
    }
    let unmovedOnDots = 0
    for (const control of doc.controls) {
      if (isDark(await pixelAt(reader, grid, finest, control.position[0], control.position[1]))) unmovedOnDots++
    }
    expect(unmovedOnDots).toBe(0)
  })
})

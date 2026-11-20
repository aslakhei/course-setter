// PDF export end to end: a member asks for a PDF of a course, the worker makes it from the uploaded
// map, the member downloads it (and nobody else can); expired exports are cleaned up by the next one.
import { randomUUID } from 'node:crypto'
import { addControl, addCourse, emptyDoc, insertCourseControl } from '@course-setter/core'
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

async function dotMap(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([300 * PT_PER_MM, 200 * PT_PER_MM])
  page.drawCircle({ x: 100 * PT_PER_MM, y: 100 * PT_PER_MM, size: 0.6 * PT_PER_MM, color: rgb(0, 0, 0) })
  return doc.save()
}

type Export = { id: string; status: string; path: string | null; file_name: string | null; error: string | null }

describe('PDF export', () => {
  let worker: TestWorker
  let ada: Awaited<ReturnType<typeof signedInUser>>
  let mo: Awaited<ReturnType<typeof signedInUser>>
  let clubId = ''
  let eventId = ''

  const exportWhen = (id: string) =>
    waitFor(
      `export ${id}`,
      async () => {
        const { data } = await admin.from('exports').select('id, status, path, file_name, error').eq('id', id).single()
        return data && (data.status === 'ready' || data.status === 'failed') ? (data as Export) : undefined
      },
      120_000,
    )

  beforeAll(async () => {
    worker = await startWorker()
    ada = await signedInUser('ada')
    mo = await signedInUser('mo')
    const club = await ada.client.rpc('create_club', { club_name: 'Export club' })
    if (club.error) throw club.error
    clubId = club.data
    await admin.from('club_members').insert({ club_id: clubId, user_id: mo.id, role: 'member' })

    // A PDF map at 1:10 000, ready.
    const started = await ada.client.rpc('start_map_upload', {
      club: clubId,
      file_name: 'dots.pdf',
      kind: 'pdf',
      map_name: 'Dots',
      scale: 10000,
    })
    if (started.error) throw started.error
    const { version_id, upload_path } = started.data[0]
    const put = await ada.client.storage.from('map-originals').upload(upload_path, await dotMap(), { contentType: 'application/pdf' })
    if (put.error) throw put.error
    const finished = await ada.client.rpc('finish_map_upload', { map_version_id: version_id })
    if (finished.error) throw finished.error
    await waitFor(`version ${version_id}`, async () => {
      const { data } = await admin.from('map_versions').select('status').eq('id', version_id).single()
      return data?.status === 'ready' ? true : undefined
    })

    // An event with one course: two controls 1 km apart.
    const created = await ada.client.rpc('create_event', { club: clubId, event_name: 'Night', map_version: version_id })
    if (created.error) throw created.error
    eventId = created.data
    let doc = emptyDoc(10000)
    doc = addControl(doc, { id: 'a', kind: 'control', position: [1000, 1000] })
    doc = addControl(doc, { id: 'b', kind: 'control', position: [2000, 1000] })
    doc = addCourse(doc, { id: 'K', name: 'Short', printScale: 10000 })
    doc = insertCourseControl(doc, 'K', 'a')
    doc = insertCourseControl(doc, 'K', 'b')
    const saved = await ada.client.rpc('save_event', { event: eventId, doc, expected_revision: 1 })
    if (saved.error) throw saved.error
  })

  afterAll(async () => {
    const { data: exports } = await admin.from('exports').select('id, path').eq('club_id', clubId)
    const paths = (exports ?? []).map(x => x.path).filter((p): p is string => Boolean(p))
    if (paths.length) await admin.storage.from('exports').remove(paths)
    for (const x of exports ?? []) await worker.sql`delete from public.jobs where payload ->> 'export_id' = ${x.id}`
    const { data: versions } = await admin.from('map_versions').select('id, original_path, tiles_path').eq('club_id', clubId)
    await admin.from('events').delete().eq('club_id', clubId)
    for (const v of versions ?? []) {
      await admin.storage.from('map-originals').remove([v.original_path])
      if (v.tiles_path) await admin.storage.from('map-tiles').remove([v.tiles_path])
      await worker.sql`delete from public.jobs where payload ->> 'map_version_id' = ${v.id}`
    }
    await admin.from('clubs').delete().eq('id', clubId)
    for (const u of [ada, mo]) if (u) await admin.auth.admin.deleteUser(u.id)
    await worker.stop()
  })

  it('makes the PDF, which only the person who asked for it can download', { timeout: 180_000 }, async () => {
    const requested = await ada.client.rpc('request_export', { event: eventId, course_ids: ['K'] })
    if (requested.error) throw requested.error
    const done = await exportWhen(requested.data)
    expect(done).toMatchObject({ status: 'ready', file_name: 'Night - Short.pdf', error: null })

    const download = await ada.client.storage.from('exports').download(done.path as string)
    if (download.error) throw download.error
    const pdf = await PDFDocument.load(new Uint8Array(await download.data.arrayBuffer()))
    expect(pdf.getPageCount()).toBe(1)
    // A4, landscape for this wide course.
    expect(pdf.getPage(0).getWidth() / PT_PER_MM).toBeCloseTo(297, 1)

    const theirs = await mo.client.storage.from('exports').download(done.path as string)
    expect(theirs.error).not.toBeNull()
    const signed = await ada.client.storage.from('exports').createSignedUrl(done.path as string, 60, { download: done.file_name as string })
    expect(signed.error).toBeNull()
  })

  it('removes the files of expired exports when the next export runs', { timeout: 180_000 }, async () => {
    const first = await ada.client.rpc('request_export', { event: eventId, course_ids: ['K'] })
    if (first.error) throw first.error
    const old = await exportWhen(first.data)
    await admin
      .from('exports')
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq('id', old.id)

    const second = await ada.client.rpc('request_export', { event: eventId, course_ids: ['K'] })
    if (second.error) throw second.error
    await exportWhen(second.data)
    const { data } = await admin.from('exports').select('status, path').eq('id', old.id).single()
    expect(data).toEqual({ status: 'expired', path: null })
    const listed = await admin.storage.from('exports').list(`${clubId}/${eventId}/${old.id}`)
    expect(listed.data).toEqual([])
  })
})

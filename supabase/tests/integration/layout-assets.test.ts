// Layout images end to end: uploads through the upload flow and the Storage policies, the worker checks
// and measures them, who can read them, broken files fail with a code, deleting removes the files.
// See worker.ts for which worker.
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { PDFDocument, rgb } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { localSupabase } from './local-supabase.ts'
import { startWorker, type TestWorker, waitFor } from './worker.ts'

const { url, secretKey, publishableKey } = localSupabase()
const admin = createClient(url, secretKey, { auth: { persistSession: false } })
const BUCKET = 'layout-assets'

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

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#0b62a4"/></svg>'
const CONTENT_TYPES = { png: 'image/png', jpeg: 'image/jpeg', svg: 'image/svg+xml', pdf: 'application/pdf' } as const
type Kind = keyof typeof CONTENT_TYPES
type Asset = {
  id: string
  status: string
  kind: Kind
  width: number | null
  height: number | null
  error_code: string | null
  original_path: string
  preview_path: string | null
}

async function pdfLogo(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([200, 100]).drawRectangle({ x: 10, y: 10, width: 180, height: 80, color: rgb(0.8, 0.1, 0.1) })
  return doc.save()
}

describe('layout images', () => {
  let worker: TestWorker
  let ada: Awaited<ReturnType<typeof signedInUser>>
  let mo: Awaited<ReturnType<typeof signedInUser>>
  let oz: Awaited<ReturnType<typeof signedInUser>>
  let clubId = ''

  async function upload(
    who: { client: SupabaseClient },
    scope: { scope: 'club'; club: string } | { scope: 'personal' },
    kind: Kind,
    bytes: Uint8Array | string,
  ): Promise<string> {
    const started = await who.client.rpc('start_asset_upload', { ...scope, asset_name: `A ${kind}`, kind })
    if (started.error) throw started.error
    const { asset_id, upload_path } = started.data[0]
    const put = await who.client.storage.from(BUCKET).upload(upload_path, bytes, { contentType: CONTENT_TYPES[kind] })
    if (put.error) throw put.error
    const finished = await who.client.rpc('finish_asset_upload', { asset_id })
    if (finished.error) throw finished.error
    return asset_id
  }

  const processed = (id: string) =>
    waitFor(`image ${id}`, async () => {
      const { data } = await admin
        .from('layout_assets')
        .select('id, status, kind, width, height, error_code, original_path, preview_path')
        .eq('id', id)
        .maybeSingle()
      return data && (data.status === 'ready' || data.status === 'failed') ? (data as Asset) : undefined
    })

  beforeAll(async () => {
    worker = await startWorker()
    ;[ada, mo, oz] = await Promise.all([signedInUser('ada'), signedInUser('mo'), signedInUser('oz')])
    const club = await ada.client.rpc('create_club', { club_name: 'Layout images club' })
    if (club.error) throw club.error
    clubId = club.data
    await admin.from('club_members').insert({ club_id: clubId, user_id: mo.id, role: 'member' })
  })

  afterAll(async () => {
    // As its admin (the function refuses everyone else); the club's images and their files go with it.
    if (ada && clubId) await ada.client.rpc('delete_club', { club: clubId })
    for (const u of [ada, mo, oz]) if (u) await admin.auth.admin.deleteUser(u.id)
    await worker.stop()
  })

  it('processes a club logo: measured, readable by members, not by outsiders', { timeout: 120_000 }, async () => {
    const id = await upload(ada, { scope: 'club', club: clubId }, 'svg', SVG)
    const asset = await processed(id)
    expect(asset).toMatchObject({ status: 'ready', kind: 'svg', width: 120, height: 60, error_code: null })

    const forMo = await mo.client.storage.from(BUCKET).createSignedUrl(asset.original_path, 60)
    expect(forMo.error).toBeNull()
    expect((await fetch(forMo.data?.signedUrl ?? '')).status).toBe(200)
    const forOz = await oz.client.storage.from(BUCKET).createSignedUrl(asset.original_path, 60)
    expect(forOz.data).toBeNull()
    expect((await oz.client.from('layout_assets').select('id').eq('id', id)).data).toEqual([])
  })

  it('makes a preview of a PDF image', { timeout: 120_000 }, async () => {
    const id = await upload(ada, { scope: 'club', club: clubId }, 'pdf', await pdfLogo())
    const asset = await processed(id)
    expect(asset).toMatchObject({ status: 'ready', kind: 'pdf', width: 200, height: 100 })
    expect(asset.preview_path).toMatch(/\/preview\.png$/)
    const preview = await mo.client.storage.from(BUCKET).download(asset.preview_path ?? '')
    expect(preview.error).toBeNull()
    expect(
      Buffer.from(await (preview.data as Blob).arrayBuffer())
        .subarray(1, 4)
        .toString(),
    ).toBe('PNG')
  })

  it('keeps personal images to their owner', { timeout: 120_000 }, async () => {
    const id = await upload(mo, { scope: 'personal' }, 'svg', SVG)
    const asset = await processed(id)
    expect(asset.status).toBe('ready')
    expect((await ada.client.from('layout_assets').select('id').eq('id', id)).data).toEqual([])
    expect((await ada.client.storage.from(BUCKET).createSignedUrl(asset.original_path, 60)).data).toBeNull()
    expect((await mo.client.storage.from(BUCKET).createSignedUrl(asset.original_path, 60)).error).toBeNull()
  })

  it('only lets the uploader put the file at the path it was given', async () => {
    const started = await ada.client.rpc('start_asset_upload', { scope: 'club', club: clubId, asset_name: 'X', kind: 'png' })
    if (started.error) throw started.error
    const { upload_path } = started.data[0]
    const byMo = await mo.client.storage.from(BUCKET).upload(upload_path, SVG, { contentType: 'image/png' })
    expect(byMo.error).not.toBeNull()
    const elsewhere = await ada.client.storage
      .from(BUCKET)
      .upload(`${clubId}/library/${randomUUID()}/original.png`, SVG, { contentType: 'image/png' })
    expect(elsewhere.error).not.toBeNull()
    const tooBig = await ada.client.storage.from(BUCKET).upload(upload_path, new Uint8Array(6 * 1024 * 1024), { contentType: 'image/png' })
    expect(tooBig.error).not.toBeNull()
  })

  it('fails a file that is not what it says, with a code', { timeout: 120_000 }, async () => {
    const id = await upload(ada, { scope: 'club', club: clubId }, 'png', SVG)
    expect(await processed(id)).toMatchObject({ status: 'failed', error_code: 'wrong_type' })
  })

  it('removes the files when an image is deleted', { timeout: 120_000 }, async () => {
    const id = await upload(ada, { scope: 'club', club: clubId }, 'pdf', await pdfLogo())
    const asset = await processed(id)
    const deleted = await ada.client.rpc('delete_layout_asset', { asset_id: id })
    expect(deleted.error).toBeNull()
    const folder = asset.original_path.replace(/\/[^/]+$/, '')
    await waitFor('files removed', async () => {
      const { data } = await admin.storage.from(BUCKET).list(folder)
      return data && data.length === 0 ? true : undefined
    })
  })
})

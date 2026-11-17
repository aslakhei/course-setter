// Map tiles are stored as one PMTiles archive per map version in a private bucket and read by the
// browser through a signed URL with HTTP Range requests. This checks Supabase Storage supports that.
import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { localSupabase } from './local-supabase.ts'

const BUCKET = 'range-test'
const PATH = 'archive.bin'

describe('Supabase Storage', () => {
  const { url, secretKey, publishableKey } = localSupabase()
  const admin = createClient(url, secretKey, { auth: { persistSession: false } })
  const content = randomBytes(64 * 1024)

  beforeAll(async () => {
    // Leftovers from an interrupted run (errors are returned, not thrown, and ignored here).
    await admin.storage.emptyBucket(BUCKET)
    await admin.storage.deleteBucket(BUCKET)
    const { error } = await admin.storage.createBucket(BUCKET, { public: false })
    if (error) throw error
    const up = await admin.storage.from(BUCKET).upload(PATH, content, { contentType: 'application/octet-stream' })
    if (up.error) throw up.error
  })

  afterAll(async () => {
    await admin.storage.emptyBucket(BUCKET)
    await admin.storage.deleteBucket(BUCKET)
  })

  it('serves byte ranges from a private bucket through a signed URL', async () => {
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(PATH, 60)
    if (error) throw error

    const res = await fetch(data.signedUrl, { headers: { Range: 'bytes=1000-1999' } })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe(`bytes 1000-1999/${content.length}`)
    expect(Buffer.from(await res.arrayBuffer()).equals(content.subarray(1000, 2000))).toBe(true)
  })

  it('does not serve the private file without a signed URL', async () => {
    const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${PATH}`, { headers: { apikey: publishableKey } })
    expect(res.ok).toBe(false)
  })
})

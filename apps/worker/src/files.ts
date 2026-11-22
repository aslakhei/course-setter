// The delete_files job (see migrations account_and_club_deletion and create_layout_assets): remove files
// Storage will not let SQL delete, after a club, an account or an image is deleted. Files already gone are fine, so a retry is harmless.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { JobHandler } from './jobs.ts'

const BUCKETS = new Set(['map-originals', 'map-tiles', 'exports', 'layout-assets'])
/** Names per remove request. */
const CHUNK = 100

type File = { bucket: string; name: string }

const isFile = (f: unknown): f is File =>
  typeof f === 'object' && f !== null && typeof (f as File).bucket === 'string' && typeof (f as File).name === 'string'

export function fileJobHandlers(db: SupabaseClient): Record<string, JobHandler> {
  return {
    async delete_files(job) {
      const files = Array.isArray(job.payload.files) ? job.payload.files.filter(isFile) : []
      const byBucket = new Map<string, string[]>()
      for (const { bucket, name } of files) {
        if (!BUCKETS.has(bucket)) throw new Error(`delete_files: unexpected bucket ${bucket}`)
        byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), name])
      }
      let removed = 0
      for (const [bucket, names] of byBucket) {
        for (let i = 0; i < names.length; i += CHUNK) {
          const { data, error } = await db.storage.from(bucket).remove(names.slice(i, i + CHUNK))
          if (error) throw new Error(`removing files from ${bucket}: ${error.message}`)
          removed += data?.length ?? 0
        }
      }
      return { removed }
    },
  }
}

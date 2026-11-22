// The process_layout_asset job (see migration create_layout_assets): check an uploaded image, read its
// natural size, store a preview of a PDF, and mark the image ready (or failed with a code the app
// translates).
import type { SupabaseClient } from '@supabase/supabase-js'
import type { JobHandler } from '../jobs.ts'
import { AssetError, type AssetKind, inspectImage } from './image.ts'

export const ASSETS = 'layout-assets'

type AssetRow = { id: string; kind: AssetKind; status: string; original_path: string }

export function assetJobHandlers(db: SupabaseClient): Record<string, JobHandler> {
  async function markFailed(id: string, code: string) {
    const { error } = await db.from('layout_assets').update({ status: 'failed', error_code: code }).eq('id', id).eq('status', 'processing')
    if (error) throw new Error(`marking image ${id} failed: ${error.message}`)
  }

  return {
    async process_layout_asset(job) {
      const id = job.payload.asset_id
      if (typeof id !== 'string') throw new Error('payload.asset_id missing')
      const found = await db.from('layout_assets').select('id, kind, status, original_path').eq('id', id).maybeSingle()
      if (found.error) throw new Error(`reading image ${id}: ${found.error.message}`)
      const asset = found.data as AssetRow | null
      // Deleted (or already handled) since the job was queued.
      if (asset?.status !== 'processing') return { skipped: asset?.status ?? 'missing' }
      try {
        const download = await db.storage.from(ASSETS).download(asset.original_path)
        if (download.error) throw new Error(`downloading ${asset.original_path}: ${download.error.message}`)
        const file = Buffer.from(await download.data.arrayBuffer())
        const inspected = await inspectImage(file, asset.kind)

        let previewPath: string | null = null
        if (inspected.preview) {
          previewPath = asset.original_path.replace(/[^/]+$/, 'preview.png')
          const upload = await db.storage.from(ASSETS).upload(previewPath, inspected.preview, { contentType: 'image/png', upsert: true })
          if (upload.error) throw new Error(`uploading the preview: ${upload.error.message}`)
        }
        const updated = await db
          .from('layout_assets')
          .update({
            status: 'ready',
            width: inspected.width,
            height: inspected.height,
            bytes: file.length,
            preview_path: previewPath,
            error_code: null,
          })
          .eq('id', asset.id)
          .eq('status', 'processing')
          .select('id')
        if (updated.error) throw new Error(`saving image ${asset.id}: ${updated.error.message}`)
        if (updated.data.length === 0) {
          // Deleted while we were working: leave nothing behind.
          if (previewPath) await db.storage.from(ASSETS).remove([previewPath])
          return { skipped: 'deleted while processing' }
        }
        return { kind: inspected.kind, width: inspected.width, height: inspected.height }
      } catch (err) {
        if (err instanceof AssetError) {
          await markFailed(asset.id, err.code)
          return { failed: err.code }
        }
        // Unexpected (network, storage, a bug): retried; the last attempt marks the image failed.
        if (job.attempts >= job.max_attempts) await markFailed(asset.id, 'processing_failed')
        throw err
      }
    },
  }
}

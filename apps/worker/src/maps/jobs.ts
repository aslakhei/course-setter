// Job handlers for map versions (see migration create_maps for the life cycle).
import { maxZoom, tileGrid } from '@course-setter/core'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { JobHandler } from '../jobs.ts'
import { loadOcad } from './ocad.ts'
import { loadPdf } from './pdf.ts'
import { writePmtiles } from './pmtiles.ts'
import { buildTiles } from './pyramid.ts'
import { MapError, type MapSource } from './source.ts'

const ORIGINALS = 'map-originals'
const TILES = 'map-tiles'

type VersionRow = {
  id: string
  map_id: string
  club_id: string
  kind: 'ocad' | 'pdf'
  status: string
  original_path: string
  tiles_path: string | null
  scale: number | null
}

export function mapJobHandlers(db: SupabaseClient): Record<string, JobHandler> {
  async function version(job: { payload: Record<string, unknown> }): Promise<VersionRow | null> {
    const id = job.payload.map_version_id
    if (typeof id !== 'string') throw new Error('payload.map_version_id missing')
    const { data, error } = await db
      .from('map_versions')
      .select('id, map_id, club_id, kind, status, original_path, tiles_path, scale')
      .eq('id', id)
      .maybeSingle()
    if (error) throw new Error(`reading map version ${id}: ${error.message}`)
    return data as VersionRow | null
  }

  async function markFailed(id: string, code: string, message: string) {
    const { error } = await db
      .from('map_versions')
      .update({ status: 'failed', error_code: code, error_message: message, processed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'processing')
    if (error) throw new Error(`marking map version ${id} failed: ${error.message}`)
  }

  return {
    async process_map_version(job) {
      const v = await version(job)
      // Deleted (or already handled) since the job was queued.
      if (!v || v.status !== 'processing') return { skipped: v?.status ?? 'missing' }
      try {
        const download = await db.storage.from(ORIGINALS).download(v.original_path)
        if (download.error) throw new Error(`downloading ${v.original_path}: ${download.error.message}`)
        const file = Buffer.from(await download.data.arrayBuffer())

        const source: MapSource = v.kind === 'ocad' ? await loadOcad(file) : loadPdf(file, v.scale ?? 0)
        const grid = tileGrid({ widthMm: source.widthMm, heightMm: source.heightMm, scale: source.scale, origin: source.origin })
        const tiles = await buildTiles(source, grid)
        if (tiles.length === 0) throw new MapError('empty_map', 'The map is blank: every tile is white.')

        const archive = writePmtiles(tiles, { kind: source.kind, scale: source.scale, grid }, 0, maxZoom(grid))
        const tilesPath = `${v.club_id}/${v.map_id}/${v.id}/tiles.pmtiles`
        const upload = await db.storage.from(TILES).upload(tilesPath, archive, { contentType: 'application/octet-stream', upsert: true })
        if (upload.error) throw new Error(`uploading tiles: ${upload.error.message}`)

        const updated = await db
          .from('map_versions')
          .update({
            status: 'ready',
            scale: source.scale,
            paper_width_mm: source.widthMm,
            paper_height_mm: source.heightMm,
            frame: grid.extent,
            georef: source.georef,
            ocad_version: source.ocadVersion,
            tiles_path: tilesPath,
            tiles: grid,
            error_code: null,
            error_message: null,
            processed_at: new Date().toISOString(),
          })
          .eq('id', v.id)
          .eq('status', 'processing')
          .select('id')
        if (updated.error) throw new Error(`saving map version: ${updated.error.message}`)
        if (updated.data.length === 0) {
          // Deleted while we were working: leave nothing behind.
          await db.storage.from(TILES).remove([tilesPath])
          return { skipped: 'deleted while processing' }
        }
        return { tiles: tiles.length, bytes: archive.length, zoomLevels: grid.levels.length }
      } catch (err) {
        if (err instanceof MapError) {
          await markFailed(v.id, err.code, err.message)
          return { failed: err.code }
        }
        // Unexpected (network, storage, a bug): retried; the last attempt marks the version failed.
        if (job.attempts >= job.max_attempts) await markFailed(v.id, 'processing_failed', (err as Error).message)
        throw err
      }
    },

    async delete_map_version(job) {
      const v = await version(job)
      if (!v) return { skipped: 'missing' }
      if (v.status !== 'deleted') return { skipped: v.status }
      const removed = await db.storage.from(ORIGINALS).remove([v.original_path])
      if (removed.error) throw new Error(`removing original: ${removed.error.message}`)
      const tilesPath = v.tiles_path ?? `${v.club_id}/${v.map_id}/${v.id}/tiles.pmtiles`
      const removedTiles = await db.storage.from(TILES).remove([tilesPath])
      if (removedTiles.error) throw new Error(`removing tiles: ${removedTiles.error.message}`)

      const deleted = await db.from('map_versions').delete().eq('id', v.id)
      if (deleted.error) throw new Error(`deleting map version: ${deleted.error.message}`)
      const rest = await db.from('map_versions').select('id', { count: 'exact', head: true }).eq('map_id', v.map_id)
      if (rest.error) throw new Error(`counting versions: ${rest.error.message}`)
      if (rest.count === 0) {
        const map = await db.from('maps').delete().eq('id', v.map_id)
        if (map.error) throw new Error(`deleting map: ${map.error.message}`)
      }
      return { deleted: v.id, mapDeleted: rest.count === 0 }
    },
  }
}

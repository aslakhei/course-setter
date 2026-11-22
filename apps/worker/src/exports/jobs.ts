// The export_pdf job (see migration create_exports): print the courses of an export, upload the file,
// mark the export ready. Afterwards it removes files of exports that have expired, so cleaning up needs
// no scheduled wake-ups of the worker.
import { type PageContext, parseDoc } from '@course-setter/core'
import { MissingAssetError } from '@course-setter/core/pdf'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { JobHandler } from '../jobs.ts'
import { MapError } from '../maps/source.ts'
import { makeExport } from './render.ts'

const EXPORTS = 'exports'
const ORIGINALS = 'map-originals'

type ExportRow = {
  id: string
  event_id: string
  club_id: string
  revision: number
  course_ids: string[]
  separate: boolean
  status: string
}

export function exportJobHandlers(db: SupabaseClient): Record<string, JobHandler> {
  async function fail(id: string, message: string) {
    const { error } = await db
      .from('exports')
      .update({ status: 'failed', error: message, finished_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw new Error(`marking export ${id} failed: ${error.message}`)
  }

  async function removeExpired(): Promise<number> {
    const { data, error } = await db
      .from('exports')
      .select('id, path')
      .in('status', ['ready', 'failed'])
      .lt('expires_at', new Date().toISOString())
      .limit(100)
    if (error) throw new Error(`reading expired exports: ${error.message}`)
    const rows = (data ?? []) as { id: string; path: string | null }[]
    const paths = rows.map(r => r.path).filter((p): p is string => Boolean(p))
    if (paths.length) {
      const removed = await db.storage.from(EXPORTS).remove(paths)
      if (removed.error) throw new Error(`removing expired exports: ${removed.error.message}`)
    }
    if (rows.length) {
      const updated = await db
        .from('exports')
        .update({ status: 'expired', path: null })
        .in(
          'id',
          rows.map(r => r.id),
        )
      if (updated.error) throw new Error(`marking exports expired: ${updated.error.message}`)
    }
    return rows.length
  }

  return {
    async export_pdf(job) {
      const id = job.payload.export_id
      if (typeof id !== 'string') throw new Error('payload.export_id missing')
      const found = await db
        .from('exports')
        .select('id, event_id, club_id, revision, course_ids, separate, status')
        .eq('id', id)
        .maybeSingle()
      if (found.error) throw new Error(`reading export ${id}: ${found.error.message}`)
      const x = found.data as ExportRow | null
      if (!x || (x.status !== 'queued' && x.status !== 'running')) return { skipped: x?.status ?? 'missing' }
      await db.from('exports').update({ status: 'running' }).eq('id', id)

      try {
        const event = await db
          .from('events')
          .select('name, map_version_id, event_date, clubs(name), profiles!events_created_by_fkey(display_name)')
          .eq('id', x.event_id)
          .single()
        if (event.error) throw new Error(`reading event: ${event.error.message}`)
        const revision = await db.from('event_revisions').select('doc').eq('event_id', x.event_id).eq('revision', x.revision).single()
        if (revision.error) throw new Error(`reading event revision ${x.revision}: ${revision.error.message}`)
        const version = await db
          .from('map_versions')
          .select('kind, scale, original_path, contour_interval, mapper, map_year, maps(name)')
          .eq('id', event.data.map_version_id)
          .single()
        if (version.error) throw new Error(`reading map version: ${version.error.message}`)
        const download = await db.storage.from(ORIGINALS).download(version.data.original_path)
        if (download.error) throw new Error(`downloading the map: ${download.error.message}`)

        const file = await makeExport({
          doc: parseDoc(revision.data.doc, version.data.scale),
          eventName: event.data.name,
          context: pageContext(event.data, version.data),
          courseIds: x.course_ids,
          separate: x.separate,
          map: { kind: version.data.kind, scale: version.data.scale, file: Buffer.from(await download.data.arrayBuffer()) },
        })
        // Storage keys stay plain; the file name people see is kept on the row (and used for the download).
        const path = `${x.club_id}/${x.event_id}/${x.id}/export.${file.contentType === 'application/zip' ? 'zip' : 'pdf'}`
        const upload = await db.storage.from(EXPORTS).upload(path, file.bytes, { contentType: file.contentType, upsert: true })
        if (upload.error) throw new Error(`uploading the export: ${upload.error.message}`)
        const done = await db
          .from('exports')
          .update({ status: 'ready', path, file_name: file.fileName, error: null, finished_at: new Date().toISOString() })
          .eq('id', id)
        if (done.error) throw new Error(`saving the export: ${done.error.message}`)
        const expired = await removeExpired()
        return { bytes: file.bytes.length, fileName: file.fileName, expired }
      } catch (err) {
        if (err instanceof MapError || err instanceof MissingAssetError) {
          await fail(id, err.message)
          return { failed: err.code }
        }
        // Unexpected (network, storage, a bug): retried; the last attempt marks the export failed.
        if (job.attempts >= job.max_attempts) await fail(id, (err as Error).message)
        throw err
      }
    },
  }
}

/** A related row as supabase-js returns it: an object, or (without generated types) possibly an array. */
const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

/** The print layout's fields that are not in the event document. */
function pageContext(
  event: { event_date: string | null; clubs: unknown; profiles: unknown },
  version: { contour_interval: number | null; mapper: string | null; map_year: number | null; maps: unknown },
): PageContext {
  return {
    eventDate: event.event_date,
    clubName: one(event.clubs as { name: string } | null)?.name ?? null,
    setter: one(event.profiles as { display_name: string | null } | null)?.display_name ?? null,
    map: {
      name: one(version.maps as { name: string } | null)?.name ?? null,
      contour: version.contour_interval === null ? null : Number(version.contour_interval),
      mapper: version.mapper,
      year: version.map_year,
    },
  }
}

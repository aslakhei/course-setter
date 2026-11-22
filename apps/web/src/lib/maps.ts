// Data access for maps and map versions. Admins see every version (also while uploading, processing or
// failed); members only ready ones. Uploads go straight from the browser to Storage, framed by the
// start_map_upload / finish_map_upload functions (see migration create_maps).
import type { Similarity, TileGrid, VersionLink } from '@course-setter/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from './api.ts'
import type { Database } from './database.types.ts'
import { supabase } from './supabase.ts'

export type MapKind = Database['public']['Enums']['map_kind']
export type VersionStatus = Database['public']['Enums']['map_version_status']

export type MapVersionSummary = {
  id: string
  version: number
  kind: MapKind
  status: VersionStatus
  fileName: string
  scale: number | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  /** The version this one was lined up with, and how (null for a first version). */
  previousVersionId: string | null
  transformMethod: 'identity' | 'georef' | 'points' | null
  transformRms: number | null
}

export type ClubMap = { id: string; name: string; versions: MapVersionSummary[] }

/** What printed courses can show about a map version (null: not given). */
export type MapDetails = { contourInterval: number | null; mapper: string | null; year: number | null }

export type MapVersionDetail = MapVersionSummary &
  MapDetails & {
    mapId: string
    tilesPath: string | null
    tiles: TileGrid | null
    transform: Similarity | null
  }

/** 50 MB: the Supabase free plan's limit per file (also set on the bucket). */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
export const COMMON_SCALES = [4000, 5000, 7500, 10000, 15000] as const

const SIGNED_URL_SECONDS = 60 * 60

export type VersionWithLink = VersionLink & { version: number; status: VersionStatus; tiles: TileGrid | null }

export const mapKeys = {
  links: (mapId: string) => ['map-links', mapId] as const,
  maps: (clubId: string) => ['maps', clubId] as const,
  version: (versionId: string) => ['map-version', versionId] as const,
  tilesUrl: (path: string) => ['tiles-url', path] as const,
}

const versionColumns =
  'id, version, kind, status, file_name, scale, error_code, error_message, created_at, previous_version_id, transform_method, transform_rms_m'

type VersionRow = {
  id: string
  version: number
  kind: MapKind
  status: VersionStatus
  file_name: string
  scale: number | null
  error_code: string | null
  error_message: string | null
  created_at: string
  previous_version_id: string | null
  transform_method: string | null
  transform_rms_m: number | null
}

function summary(r: VersionRow): MapVersionSummary {
  return {
    id: r.id,
    version: r.version,
    kind: r.kind,
    status: r.status,
    fileName: r.file_name,
    scale: r.scale,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    createdAt: r.created_at,
    previousVersionId: r.previous_version_id,
    transformMethod: r.transform_method as MapVersionSummary['transformMethod'],
    transformRms: r.transform_rms_m,
  }
}

/** Newest first. */
export function sortVersions(versions: MapVersionSummary[]): MapVersionSummary[] {
  return [...versions].sort((a, b) => b.version - a.version)
}

/** The newest ready version, which the viewer opens by default. */
export function latestReady(map: ClubMap): MapVersionSummary | undefined {
  return sortVersions(map.versions).find(v => v.status === 'ready')
}

/** An upload not finished after this long was abandoned (the page was closed mid-upload). */
const UPLOAD_GIVE_UP_MS = 15 * 60 * 1000

export function uploadAbandoned(v: MapVersionSummary, now = Date.now()): boolean {
  return v.status === 'uploading' && now - Date.parse(v.createdAt) > UPLOAD_GIVE_UP_MS
}

export const isBusy = (v: MapVersionSummary) => v.status === 'processing' || (v.status === 'uploading' && !uploadAbandoned(v))

export function useMaps(clubId: string) {
  return useQuery({
    queryKey: mapKeys.maps(clubId),
    queryFn: async (): Promise<ClubMap[]> => {
      const { data, error } = await supabase
        .from('maps')
        .select(`id, name, map_versions(${versionColumns})`)
        .eq('club_id', clubId)
        .order('name')
      if (error) throw new ApiError(error)
      return (data ?? []).map(m => ({ id: m.id, name: m.name, versions: sortVersions(m.map_versions.map(summary)) }))
    },
    // While a version is being processed, look again every few seconds.
    refetchInterval: query => (query.state.data?.some(m => m.versions.some(isBusy)) ? 3000 : false),
  })
}

export function useMapVersion(versionId: string | undefined) {
  return useQuery({
    queryKey: mapKeys.version(versionId ?? ''),
    enabled: Boolean(versionId),
    queryFn: async (): Promise<MapVersionDetail | null> => {
      const { data, error } = await supabase
        .from('map_versions')
        .select(`${versionColumns}, map_id, tiles_path, tiles, transform_from_previous, contour_interval, mapper, map_year`)
        .eq('id', versionId ?? '')
        .maybeSingle()
      if (error) throw new ApiError(error)
      if (!data) return null
      return {
        ...summary(data),
        mapId: data.map_id,
        tilesPath: data.tiles_path,
        tiles: data.tiles as TileGrid | null,
        transform: data.transform_from_previous as Similarity | null,
        contourInterval: data.contour_interval === null ? null : Number(data.contour_interval),
        mapper: data.mapper,
        year: data.map_year,
      }
    },
  })
}

/** A signed URL for a version's tile archive, renewed well before it expires. */
export function useTilesUrl(tilesPath: string | null | undefined) {
  return useQuery({
    queryKey: mapKeys.tilesUrl(tilesPath ?? ''),
    enabled: Boolean(tilesPath),
    staleTime: (SIGNED_URL_SECONDS - 600) * 1000,
    refetchInterval: (SIGNED_URL_SECONDS - 600) * 1000,
    queryFn: async (): Promise<string> => {
      const { data, error } = await supabase.storage.from('map-tiles').createSignedUrl(tilesPath ?? '', SIGNED_URL_SECONDS)
      if (error) throw new Error(error.message)
      return data.signedUrl
    },
  })
}

export function kindOf(fileName: string): MapKind | null {
  const name = fileName.toLowerCase()
  if (name.endsWith('.ocd')) return 'ocad'
  if (name.endsWith('.pdf')) return 'pdf'
  return null
}

/** "Skogen 2026.ocd" -> "Skogen 2026" */
export function nameFromFile(fileName: string): string {
  return fileName.replace(/\.(ocd|pdf)$/i, '').trim()
}

/** A new map (`name`) or a new version of an existing one (`mapId`). */
export type UploadInput = { file: File; name?: string; mapId?: string; scale?: number }

/** Upload a map or a new version of one: reserve the version, upload the file to its path, queue processing. */
export function useUploadMap(clubId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ file, name, mapId, scale }: UploadInput): Promise<{ mapId: string; versionId: string }> => {
      const kind = kindOf(file.name)
      if (!kind) throw new Error('unsupported file type')
      const started = await supabase.rpc('start_map_upload', {
        club: clubId,
        file_name: file.name,
        kind,
        ...(mapId ? { map_id: mapId } : { map_name: (name ?? '').trim() }),
        ...(kind === 'pdf' ? { scale } : {}),
      })
      if (started.error) throw new ApiError(started.error)
      const reserved = started.data[0]
      if (!reserved) throw new Error('start_map_upload returned nothing')
      const uploaded = await supabase.storage
        .from('map-originals')
        .upload(reserved.upload_path, file, { contentType: kind === 'pdf' ? 'application/pdf' : 'application/octet-stream' })
      if (uploaded.error) throw new Error(uploaded.error.message)
      const finished = await supabase.rpc('finish_map_upload', { map_version_id: reserved.version_id })
      if (finished.error) throw new ApiError(finished.error)
      return { mapId: reserved.upload_path.split('/')[1] ?? '', versionId: reserved.version_id }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: mapKeys.maps(clubId) }),
  })
}

export function useRenameMap(clubId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ mapId, name }: { mapId: string; name: string }) => {
      const { error } = await supabase.from('maps').update({ name: name.trim() }).eq('id', mapId)
      if (error) throw new ApiError(error)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mapKeys.maps(clubId) }),
  })
}

export function useDeleteMapVersion(clubId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (versionId: string) => {
      const { error } = await supabase.rpc('delete_map_version', { map_version_id: versionId })
      if (error) throw new ApiError(error)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mapKeys.maps(clubId) }),
  })
}

/** Save the transform an admin found by matching points; the version becomes ready. */
export function useSaveAlignment(clubId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ versionId, transform, rms }: { versionId: string; transform: Similarity; rms: number }) => {
      const { error } = await supabase.rpc('set_map_version_alignment', { map_version_id: versionId, transform, rms_m: rms })
      if (error) throw new ApiError(error)
    },
    onSuccess: (_data, { versionId }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: mapKeys.maps(clubId) }),
        queryClient.invalidateQueries({ queryKey: mapKeys.version(versionId) }),
      ]),
  })
}

/** Save a version's details (admins); a detail that is null is cleared. */
export function useSetMapDetails() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ versionId, details }: { versionId: string; details: MapDetails }) => {
      const { error } = await supabase.rpc('set_map_version_details', {
        map_version_id: versionId,
        ...(details.contourInterval !== null ? { contour_interval: details.contourInterval } : {}),
        ...(details.mapper ? { mapper: details.mapper } : {}),
        ...(details.year !== null ? { map_year: details.year } : {}),
      })
      if (error) throw new ApiError(error)
    },
    onSuccess: (_data, { versionId }) => queryClient.invalidateQueries({ queryKey: mapKeys.version(versionId) }),
  })
}

/** Every version of a map with how it was lined up with the one before (for moving events). */
export function useVersionLinks(mapId: string | undefined) {
  return useQuery({
    queryKey: mapKeys.links(mapId ?? ''),
    enabled: Boolean(mapId),
    queryFn: async (): Promise<VersionWithLink[]> => {
      const { data, error } = await supabase
        .from('map_versions')
        .select('id, version, status, previous_version_id, transform_from_previous, tiles')
        .eq('map_id', mapId ?? '')
      if (error) throw new ApiError(error)
      return (data ?? []).map(v => ({
        id: v.id,
        version: v.version,
        status: v.status,
        previousVersionId: v.previous_version_id,
        transform: v.transform_from_previous as Similarity | null,
        tiles: v.tiles as TileGrid | null,
      }))
    },
  })
}

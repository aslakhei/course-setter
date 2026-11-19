// Data access for maps and map versions. Admins see every version (also while uploading, processing or
// failed); members only ready ones. Uploads go straight from the browser to Storage, framed by the
// start_map_upload / finish_map_upload functions (see migration create_maps).
import type { TileGrid } from '@course-setter/core'
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
}

export type ClubMap = { id: string; name: string; versions: MapVersionSummary[] }

export type MapVersionDetail = MapVersionSummary & { mapId: string; tilesPath: string | null; tiles: TileGrid | null }

/** 50 MB: the Supabase free plan's limit per file (also set on the bucket). */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
export const COMMON_SCALES = [4000, 5000, 7500, 10000, 15000] as const

const SIGNED_URL_SECONDS = 60 * 60

export const mapKeys = {
  maps: (clubId: string) => ['maps', clubId] as const,
  version: (versionId: string) => ['map-version', versionId] as const,
  tilesUrl: (path: string) => ['tiles-url', path] as const,
}

const versionColumns = 'id, version, kind, status, file_name, scale, error_code, error_message, created_at'

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

const isBusy = (v: MapVersionSummary) => v.status === 'uploading' || v.status === 'processing'

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
        .select(`${versionColumns}, map_id, tiles_path, tiles`)
        .eq('id', versionId ?? '')
        .maybeSingle()
      if (error) throw new ApiError(error)
      if (!data) return null
      return { ...summary(data), mapId: data.map_id, tilesPath: data.tiles_path, tiles: data.tiles as TileGrid | null }
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

export type UploadInput = { file: File; name: string; scale?: number }

/** Upload a new map: reserve the version, upload the file to its path, queue processing. */
export function useUploadMap(clubId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ file, name, scale }: UploadInput): Promise<{ mapId: string; versionId: string }> => {
      const kind = kindOf(file.name)
      if (!kind) throw new Error('unsupported file type')
      const started = await supabase.rpc('start_map_upload', {
        club: clubId,
        file_name: file.name,
        kind,
        map_name: name.trim(),
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

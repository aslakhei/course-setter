// Images for print layouts (see migration create_layout_assets): the club library, an event's own
// images and a person's own. Uploads go straight from the browser to Storage, framed by
// start_asset_upload / finish_asset_upload; the worker checks each file and measures it.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ApiError } from './api.ts'
import type { Database } from './database.types.ts'
import { supabase } from './supabase.ts'

export type AssetKind = Database['public']['Enums']['asset_kind']
export type AssetStatus = Database['public']['Enums']['asset_status']

/** Where images live: the club library, an event, or the signed-in person's own. */
export type AssetScope = { scope: 'club'; clubId: string } | { scope: 'event'; eventId: string } | { scope: 'personal' }

export type LayoutAsset = {
  id: string
  name: string
  kind: AssetKind
  status: AssetStatus
  /** Natural size: pixels (PNG, JPEG), user units (SVG), points (PDF); null until processed. */
  width: number | null
  height: number | null
  bytes: number | null
  errorCode: string | null
  originalPath: string
  /** A PNG the browser can show for a PDF image. */
  previewPath: string | null
  createdAt: string
}

/** 5 MB, also set on the bucket. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.svg,.pdf'
const CONTENT_TYPES: Record<AssetKind, string> = { png: 'image/png', jpeg: 'image/jpeg', svg: 'image/svg+xml', pdf: 'application/pdf' }
const SIGNED_URL_SECONDS = 60 * 60

/** The kind of an image file by its name (the worker checks its content). */
export function assetKindOf(fileName: string): AssetKind | null {
  const name = fileName.toLowerCase()
  if (name.endsWith('.png')) return 'png'
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'jpeg'
  if (name.endsWith('.svg')) return 'svg'
  if (name.endsWith('.pdf')) return 'pdf'
  return null
}

/** "Club logo.svg" -> "Club logo" */
export const assetNameFromFile = (fileName: string) =>
  fileName
    .replace(/\.(png|jpe?g|svg|pdf)$/i, '')
    .trim()
    .slice(0, 100)

const scopeKey = (s: AssetScope) => (s.scope === 'club' ? s.clubId : s.scope === 'event' ? s.eventId : 'personal')
export const assetKeys = {
  library: (s: AssetScope) => ['layout-assets', s.scope, scopeKey(s)] as const,
  images: (ids: string[]) => ['layout-asset-images', ...ids] as const,
}

const columns = 'id, name, kind, status, width, height, bytes, error_code, original_path, preview_path, created_at'
type Row = {
  id: string
  name: string
  kind: AssetKind
  status: AssetStatus
  width: number | null
  height: number | null
  bytes: number | null
  error_code: string | null
  original_path: string
  preview_path: string | null
  created_at: string
}
const toAsset = (r: Row): LayoutAsset => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  status: r.status,
  width: r.width,
  height: r.height,
  bytes: r.bytes,
  errorCode: r.error_code,
  originalPath: r.original_path,
  previewPath: r.preview_path,
  createdAt: r.created_at,
})

const busy = (a: LayoutAsset) => a.status === 'uploading' || a.status === 'processing'

/** The images of a scope, newest first; looked at again every few seconds while one is being processed. */
export function useLibrary(scope: AssetScope) {
  return useQuery({
    queryKey: assetKeys.library(scope),
    queryFn: async (): Promise<LayoutAsset[]> => {
      let query = supabase.from('layout_assets').select(columns).order('created_at', { ascending: false })
      if (scope.scope === 'club') query = query.eq('club_id', scope.clubId).is('event_id', null)
      else if (scope.scope === 'event') query = query.eq('event_id', scope.eventId)
      // Row-level security shows only one's own personal images.
      else query = query.not('owner_id', 'is', null)
      const { data, error } = await query
      if (error) throw new ApiError(error)
      return (data ?? []).map(toAsset)
    },
    refetchInterval: query => (query.state.data?.some(busy) ? 3000 : false),
  })
}

/** Add an image to a scope: reserve it, upload the file to its path, queue the check. */
export function useUploadAsset(scope: AssetScope) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ file, name }: { file: File; name: string }): Promise<string> => {
      const kind = assetKindOf(file.name)
      if (!kind) throw new Error('unsupported file type')
      const started = await supabase.rpc('start_asset_upload', {
        scope: scope.scope,
        asset_name: name.trim(),
        kind,
        ...(scope.scope === 'club' ? { club: scope.clubId } : scope.scope === 'event' ? { event: scope.eventId } : {}),
      })
      if (started.error) throw new ApiError(started.error)
      const reserved = started.data[0]
      if (!reserved) throw new Error('start_asset_upload returned nothing')
      const uploaded = await supabase.storage.from('layout-assets').upload(reserved.upload_path, file, { contentType: CONTENT_TYPES[kind] })
      if (uploaded.error) throw new Error(uploaded.error.message)
      const finished = await supabase.rpc('finish_asset_upload', { asset_id: reserved.asset_id })
      if (finished.error) throw new ApiError(finished.error)
      return reserved.asset_id
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: assetKeys.library(scope) }),
  })
}

export function useDeleteAsset(scope: AssetScope) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (assetId: string) => {
      const { error } = await supabase.rpc('delete_layout_asset', { asset_id: assetId })
      if (error) throw new ApiError(error)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: assetKeys.library(scope) }),
  })
}

/** The path the browser shows for an image: the original, or a PDF's PNG preview. */
export const shownPath = (a: Pick<LayoutAsset, 'kind' | 'originalPath' | 'previewPath'>) =>
  a.kind === 'pdf' ? a.previewPath : a.originalPath

/** Signed URLs for paths, renewed well before they expire. */
export function useSignedUrls(paths: string[]) {
  return useQuery({
    queryKey: ['layout-asset-urls', ...paths],
    enabled: paths.length > 0,
    staleTime: (SIGNED_URL_SECONDS - 600) * 1000,
    refetchInterval: (SIGNED_URL_SECONDS - 600) * 1000,
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await supabase.storage.from('layout-assets').createSignedUrls(paths, SIGNED_URL_SECONDS)
      if (error) throw new Error(error.message)
      return new Map((data ?? []).flatMap(d => (d.path && d.signedUrl ? [[d.path, d.signedUrl] as const] : [])))
    },
  })
}

/**
 * The images with these ids that the signed-in person may see (any status), looked at again every few
 * seconds while one is being uploaded or checked (an image just added to a layout).
 */
export function useAssetRows(ids: string[]) {
  return useQuery({
    queryKey: assetKeys.images(ids),
    enabled: ids.length > 0,
    queryFn: async (): Promise<LayoutAsset[]> => {
      const { data, error } = await supabase.from('layout_assets').select(columns).in('id', ids)
      if (error) throw new ApiError(error)
      return (data ?? []).map(toAsset)
    },
    refetchInterval: query => (query.state.data?.some(busy) ? 3000 : false),
  })
}

/**
 * A copy of an image in an event's own images, for a layout of that event: a personal image is only
 * its owner's to see, a copy in the event is everyone's with access to the event. The file is copied in
 * Storage (the owner may read it; the event path accepts it) and checked again like any upload.
 */
export function useCopyToEvent(eventId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (asset: LayoutAsset): Promise<string> => {
      const started = await supabase.rpc('start_asset_upload', { scope: 'event', asset_name: asset.name, kind: asset.kind, event: eventId })
      if (started.error) throw new ApiError(started.error)
      const reserved = started.data[0]
      if (!reserved) throw new Error('start_asset_upload returned nothing')
      const copied = await supabase.storage.from('layout-assets').copy(asset.originalPath, reserved.upload_path)
      if (copied.error) throw new Error(copied.error.message)
      const finished = await supabase.rpc('finish_asset_upload', { asset_id: reserved.asset_id })
      if (finished.error) throw new ApiError(finished.error)
      return reserved.asset_id
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: assetKeys.library({ scope: 'event', eventId }) }),
  })
}

/**
 * The images with these ids that the signed-in person may see, loaded and ready to draw on a canvas
 * (missing ones stay out: the print view draws a placeholder for them). `loaded` changes when one comes in.
 */
export function useAssetImages(ids: string[]): { images: Map<string, HTMLImageElement>; loaded: number } {
  const rows = useAssetRows(ids)
  const assets = (rows.data ?? []).filter(a => a.status === 'ready')
  const paths = assets.flatMap(a => {
    const p = shownPath(a)
    return p ? [p] : []
  })
  const urls = useSignedUrls(paths)
  const [state, setState] = useState<{ images: Map<string, HTMLImageElement>; loaded: number }>({ images: new Map(), loaded: 0 })

  // Loaded again when the URLs change, not when the same rows come back as new arrays.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by the URLs
  useEffect(() => {
    if (!urls.data) return
    let current = true
    for (const a of assets) {
      const path = shownPath(a)
      const url = path ? urls.data.get(path) : undefined
      if (!url) continue
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.onload = () => {
        if (!current) return
        setState(s => ({ images: new Map(s.images).set(a.id, image), loaded: s.loaded + 1 }))
      }
      image.src = url
    }
    return () => {
      current = false
    }
  }, [urls.data])

  return state
}

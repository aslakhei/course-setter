// PDF exports (see migration create_exports): request_export() queues a PDF of some of an event's
// courses, as the event is at its saved revision; the worker makes it and marks it ready. Row-level
// security shows people only their own exports, and lets them download the file for 24 hours.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from './api.ts'
import { supabase } from './supabase.ts'

export type ExportStatus = 'queued' | 'running' | 'ready' | 'failed' | 'expired'

export type ExportSummary = {
  id: string
  courseIds: string[]
  separate: boolean
  status: ExportStatus
  path: string | null
  fileName: string | null
  error: string | null
  createdAt: string
  finishedAt: string | null
  expiresAt: string
}

/** How many recent exports the print view lists. */
const RECENT = 5

export const exportKeys = { list: (eventId: string) => ['exports', eventId] as const }

export const isPending = (x: ExportSummary) => x.status === 'queued' || x.status === 'running'

/** The user's recent exports of an event, newest first; while one is being made, looked at again every 2 s. */
export function useExports(eventId: string) {
  return useQuery({
    queryKey: exportKeys.list(eventId),
    queryFn: async (): Promise<ExportSummary[]> => {
      const { data, error } = await supabase
        .from('exports')
        .select('id, course_ids, separate, status, path, file_name, error, created_at, finished_at, expires_at')
        .eq('event_id', eventId)
        .neq('status', 'expired')
        .order('created_at', { ascending: false })
        .limit(RECENT)
      if (error) throw new ApiError(error)
      return (data ?? []).map(x => ({
        id: x.id,
        courseIds: x.course_ids,
        separate: x.separate,
        status: x.status,
        path: x.path,
        fileName: x.file_name,
        error: x.error,
        createdAt: x.created_at,
        finishedAt: x.finished_at,
        expiresAt: x.expires_at,
      }))
    },
    refetchInterval: query => (query.state.data?.some(isPending) ? 2000 : false),
  })
}

export function useRequestExport(eventId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ courseIds, separate }: { courseIds: string[]; separate: boolean }): Promise<string> => {
      const { data, error } = await supabase.rpc('request_export', { event: eventId, course_ids: courseIds, separate })
      if (error) throw new ApiError(error)
      return data
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: exportKeys.list(eventId) }),
  })
}

/** A short-lived link that downloads a ready export under its file name. */
export async function downloadUrl(x: ExportSummary): Promise<string> {
  if (!x.path) throw new Error('the export has no file')
  const { data, error } = await supabase.storage.from('exports').createSignedUrl(x.path, 60, { download: x.fileName ?? true })
  if (error) throw new Error(error.message)
  return data.signedUrl
}

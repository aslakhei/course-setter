// Data access for events. Row-level security limits everything to the events the user has access to
// (creator, club admins, invited members). The course document is saved with save_event(), which
// refuses a save based on an out-of-date revision (see migration create_events).
import type { EventDoc } from '@course-setter/core'
import type { PostgrestError } from '@supabase/supabase-js'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from './api.ts'
import { supabase } from './supabase.ts'

export type EventSummary = {
  id: string
  name: string
  date: string | null
  mapName: string
  mapVersion: number
  updatedAt: string
  createdBy: string | null
}

export type EventDetail = {
  id: string
  clubId: string
  name: string
  date: string | null
  mapVersionId: string
  doc: unknown
  revision: number
  createdBy: string | null
}

export type EventMember = { userId: string; name: string; avatarUrl: string | null; invitedBy: string | null }

/** Someone else saved the event since this revision; their save wins until the user decides. */
export class SaveConflict extends Error {
  readonly revision: number
  readonly savedBy: string | null
  readonly savedAt: string
  constructor(details: { revision: number; savedBy: string | null; savedAt: string }) {
    super('someone else saved this event')
    this.revision = details.revision
    this.savedBy = details.savedBy
    this.savedAt = details.savedAt
  }
}

export const eventKeys = {
  list: (clubId: string) => ['events', clubId] as const,
  detail: (eventId: string) => ['event', eventId] as const,
  members: (eventId: string) => ['event-members', eventId] as const,
}

export function useEvents(clubId: string) {
  return useQuery({
    queryKey: eventKeys.list(clubId),
    queryFn: async (): Promise<EventSummary[]> => {
      const { data, error } = await supabase
        .from('events')
        .select('id, name, event_date, updated_at, created_by, map_versions(version, maps(name))')
        .eq('club_id', clubId)
        .order('event_date', { ascending: false, nullsFirst: true })
        .order('updated_at', { ascending: false })
      if (error) throw new ApiError(error)
      return (data ?? []).map(e => ({
        id: e.id,
        name: e.name,
        date: e.event_date,
        mapName: e.map_versions.maps.name,
        mapVersion: e.map_versions.version,
        updatedAt: e.updated_at,
        createdBy: e.created_by,
      }))
    },
  })
}

/** `null` when the event does not exist or the user has no access. */
export function useEvent(eventId: string) {
  return useQuery({
    queryKey: eventKeys.detail(eventId),
    // The editor holds its own copy while editing; never refetch it behind the user's back.
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<EventDetail | null> => fetchEvent(eventId),
  })
}

export async function fetchEvent(eventId: string): Promise<EventDetail | null> {
  const { data, error } = await supabase
    .from('events')
    .select('id, club_id, name, event_date, map_version_id, doc, revision, created_by')
    .eq('id', eventId)
    .maybeSingle()
  if (error) throw new ApiError(error)
  if (!data) return null
  return {
    id: data.id,
    clubId: data.club_id,
    name: data.name,
    date: data.event_date,
    mapVersionId: data.map_version_id,
    doc: data.doc,
    revision: data.revision,
    createdBy: data.created_by,
  }
}

export function useCreateEvent(clubId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ name, mapVersionId, date }: { name: string; mapVersionId: string; date: string | null }) => {
      const { data, error } = await supabase.rpc('create_event', {
        club: clubId,
        event_name: name.trim(),
        map_version: mapVersionId,
        ...(date ? { event_date: date } : {}),
      })
      if (error) throw new ApiError(error)
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: eventKeys.list(clubId) }),
  })
}

export function useDeleteEvent(clubId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (eventId: string) => {
      const { error } = await supabase.from('events').delete().eq('id', eventId)
      if (error) throw new ApiError(error)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: eventKeys.list(clubId) }),
  })
}

export function useRenameEvent(clubId: string, eventId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from('events').update({ name: name.trim() }).eq('id', eventId)
      if (error) throw new ApiError(error)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: eventKeys.list(clubId) }),
  })
}

function conflictFrom(error: PostgrestError): SaveConflict | null {
  if (error.hint !== 'conflict') return null
  try {
    const details = JSON.parse(error.details ?? '{}') as { revision: number; savedBy: string | null; savedAt: string }
    return new SaveConflict(details)
  } catch {
    return new SaveConflict({ revision: Number.NaN, savedBy: null, savedAt: new Date().toISOString() })
  }
}

/** Save the document; returns the new revision, or throws SaveConflict when someone else saved first. */
export async function saveEvent(eventId: string, doc: EventDoc, expectedRevision: number): Promise<number> {
  const { data, error } = await supabase.rpc('save_event', { event: eventId, doc, expected_revision: expectedRevision })
  if (error) throw conflictFrom(error) ?? new ApiError(error)
  return data
}

/** A new event with `doc`, on the same map version: used to keep the user's version when they take someone else's. */
export async function saveAsCopy(event: EventDetail, name: string, doc: EventDoc): Promise<string> {
  const created = await supabase.rpc('create_event', {
    club: event.clubId,
    event_name: name,
    map_version: event.mapVersionId,
    ...(event.date ? { event_date: event.date } : {}),
  })
  if (created.error) throw new ApiError(created.error)
  await saveEvent(created.data, doc, 1)
  return created.data
}

export function useEventMembers(eventId: string) {
  return useQuery({
    queryKey: eventKeys.members(eventId),
    queryFn: async (): Promise<EventMember[]> => {
      const { data, error } = await supabase
        .from('event_members')
        .select('user_id, invited_by, profiles!event_members_user_id_fkey(display_name, avatar_url)')
        .eq('event_id', eventId)
      if (error) throw new ApiError(error)
      return (data ?? []).map(m => ({
        userId: m.user_id,
        name: m.profiles.display_name ?? '',
        avatarUrl: m.profiles.avatar_url,
        invitedBy: m.invited_by,
      }))
    },
  })
}

export function useInviteToEvent(eventId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.from('event_members').insert({ event_id: eventId, user_id: userId })
      if (error) throw new ApiError(error)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: eventKeys.members(eventId) }),
  })
}

/** Remove someone's access, or leave the event when `userId` is the signed-in user. */
export function useRemoveFromEvent(eventId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.from('event_members').delete().eq('event_id', eventId).eq('user_id', userId)
      if (error) throw new ApiError(error)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: eventKeys.members(eventId) }),
  })
}

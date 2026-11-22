// Data access for clubs, members and invite links. Row-level security decides what each user gets;
// these hooks only shape the queries and keep the TanStack Query cache in sync after changes.
import type { PostgrestError } from '@supabase/supabase-js'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Database } from './database.types.ts'
import { supabase } from './supabase.ts'

export type ClubRole = Database['public']['Enums']['club_role']
export type MyClub = { id: string; name: string; role: ClubRole; logoAssetId: string | null }
/** A club and its branding for print templates (logo: a club library image; colours #rrggbb). */
export type Club = {
  id: string
  name: string
  logoAssetId: string | null
  colour: string | null
  colour2: string | null
  colour3: string | null
}
export type Member = { userId: string; role: ClubRole; joinedAt: string; name: string; avatarUrl: string | null }
export type Invite = { id: string; token: string; createdAt: string; expiresAt: string; revokedAt: string | null }
export type InviteInfo = { clubId: string; clubName: string; status: 'valid' | 'expired' | 'revoked'; alreadyMember: boolean }

const CODES: Record<string, ApiError['code']> = {
  last_admin: 'lastAdmin',
  invalid_invite: 'invalidInvite',
  too_many_exports: 'tooManyExports',
  too_many_images: 'tooManyImages',
}

/** An error the UI can explain: `code` picks the message, anything else shows as "something went wrong". */
export class ApiError extends Error {
  readonly code: 'lastAdmin' | 'invalidInvite' | 'tooManyExports' | 'tooManyImages' | 'unknown'
  constructor(error: PostgrestError) {
    super(error.message)
    this.code = CODES[error.hint] ?? 'unknown'
  }
}

function check<T>({ data, error }: { data: T; error: PostgrestError | null }): T {
  if (error) throw new ApiError(error)
  return data
}

/** Like check, for queries that return a list (no rows is an empty list, never null). */
function rows<T>({ data, error }: { data: T[] | null; error: PostgrestError | null }): T[] {
  if (error) throw new ApiError(error)
  return data ?? []
}

export const keys = {
  myClubs: (userId: string) => ['my-clubs', userId] as const,
  club: (clubId: string) => ['club', clubId] as const,
  members: (clubId: string) => ['members', clubId] as const,
  invites: (clubId: string) => ['invites', clubId] as const,
  invite: (token: string) => ['invite', token] as const,
}

export function useMyClubs(userId: string) {
  return useQuery({
    queryKey: keys.myClubs(userId),
    queryFn: async (): Promise<MyClub[]> => {
      const result = rows(await supabase.from('club_members').select('role, clubs(id, name, logo_asset_id)').eq('user_id', userId))
      return result
        .map(r => ({ id: r.clubs.id, name: r.clubs.name, role: r.role, logoAssetId: r.clubs.logo_asset_id }))
        .sort((a, b) => a.name.localeCompare(b.name))
    },
  })
}

/** `null` when the club does not exist or the user is not a member (RLS hides it either way). */
export function useClub(clubId: string) {
  return useQuery({
    queryKey: keys.club(clubId),
    queryFn: async (): Promise<Club | null> => {
      const row = check(
        await supabase.from('clubs').select('id, name, logo_asset_id, colour, colour2, colour3').eq('id', clubId).maybeSingle(),
      )
      return (
        row && {
          id: row.id,
          name: row.name,
          logoAssetId: row.logo_asset_id,
          colour: row.colour,
          colour2: row.colour2,
          colour3: row.colour3,
        }
      )
    },
  })
}

export function useMembers(clubId: string) {
  return useQuery({
    queryKey: keys.members(clubId),
    queryFn: async (): Promise<Member[]> => {
      const result = rows(
        await supabase
          .from('club_members')
          .select('user_id, role, joined_at, profiles(display_name, avatar_url)')
          .eq('club_id', clubId)
          .order('joined_at'),
      )
      return result.map(r => ({
        userId: r.user_id,
        role: r.role,
        joinedAt: r.joined_at,
        name: r.profiles.display_name ?? '',
        avatarUrl: r.profiles.avatar_url,
      }))
    },
  })
}

export function useInvites(clubId: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.invites(clubId),
    enabled,
    queryFn: async (): Promise<Invite[]> => {
      const result = rows(
        await supabase
          .from('club_invites')
          .select('id, token, created_at, expires_at, revoked_at')
          .eq('club_id', clubId)
          .order('created_at', { ascending: false }),
      )
      return result.map(r => ({ id: r.id, token: r.token, createdAt: r.created_at, expiresAt: r.expires_at, revokedAt: r.revoked_at }))
    },
  })
}

/** `null` when the token is unknown. */
export function useInviteInfo(token: string) {
  return useQuery({
    queryKey: keys.invite(token),
    queryFn: async (): Promise<InviteInfo | null> => {
      const [row] = rows(await supabase.rpc('invite_info', { invite_token: token }))
      if (!row) return null
      return { clubId: row.club_id, clubName: row.club_name, status: row.status as InviteInfo['status'], alreadyMember: row.already_member }
    },
  })
}

export function useCreateClub() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) => check(await supabase.rpc('create_club', { club_name: name })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-clubs'] }),
  })
}

/** Set the club's logo and (up to three) colours (admins); null clears one. */
export function useSetBranding(clubId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (b: { logoAssetId: string | null; colour: string | null; colour2: string | null; colour3: string | null }) => {
      check(
        await supabase.rpc('set_club_branding', {
          club: clubId,
          ...(b.logoAssetId ? { logo_asset_id: b.logoAssetId } : {}),
          ...(b.colour ? { colour: b.colour } : {}),
          ...(b.colour2 ? { colour2: b.colour2 } : {}),
          ...(b.colour3 ? { colour3: b.colour3 } : {}),
        }),
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.club(clubId) })
      // The club mark in the club list shows the logo.
      queryClient.invalidateQueries({ queryKey: ['my-clubs'] })
    },
  })
}

export function useRenameClub(clubId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) => {
      check(await supabase.from('clubs').update({ name: name.trim() }).eq('id', clubId))
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.club(clubId) }),
        queryClient.invalidateQueries({ queryKey: ['my-clubs'] }),
      ]),
  })
}

export function useSetRole(clubId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: ClubRole }) => {
      check(await supabase.from('club_members').update({ role }).eq('club_id', clubId).eq('user_id', userId))
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.members(clubId) }),
  })
}

/** Remove a member, or leave the club when `userId` is the signed-in user. */
export function useRemoveMember(clubId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (userId: string) => {
      check(await supabase.from('club_members').delete().eq('club_id', clubId).eq('user_id', userId))
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.members(clubId) }),
        queryClient.invalidateQueries({ queryKey: ['my-clubs'] }),
      ]),
  })
}

export function useCreateInvite(clubId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (validDays: number) => {
      const expiresAt = new Date(Date.now() + validDays * 24 * 60 * 60 * 1000).toISOString()
      check(await supabase.from('club_invites').insert({ club_id: clubId, expires_at: expiresAt }))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.invites(clubId) }),
  })
}

export function useRevokeInvite(clubId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (inviteId: string) => {
      check(await supabase.from('club_invites').update({ revoked_at: new Date().toISOString() }).eq('id', inviteId))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.invites(clubId) }),
  })
}

export function useAcceptInvite() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (token: string) => check(await supabase.rpc('accept_invite', { invite_token: token })),
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

export function inviteUrl(token: string): string {
  return `${window.location.origin}/invite/${token}`
}

export function isActive(invite: Invite, now = Date.now()): boolean {
  return invite.revokedAt === null && Date.parse(invite.expiresAt) > now
}

// The signed-in user's own data, deleting their account, and deleting a club (see migration
// account_and_club_deletion).
import type { PostgrestError } from '@supabase/supabase-js'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError } from './api.ts'
import { saveFile } from './download.ts'
import { supabase } from './supabase.ts'

/** Everything stored about the user, saved as a JSON file. */
export async function downloadMyData() {
  const { data, error } = await supabase.rpc('my_data')
  if (error) throw new ApiError(error)
  saveFile('course-setter-my-data.json', new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' }))
}

/** The account cannot be deleted while the user is the only admin of these clubs (which have other members). */
export class OnlyAdmin extends Error {
  readonly clubs: string[]
  constructor(error: PostgrestError) {
    super(error.message)
    let clubs: string[] = []
    try {
      clubs = JSON.parse(error.details ?? '[]') as string[]
    } catch {}
    this.clubs = clubs
  }
}

export function useDeleteAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('delete_my_account')
      if (error) throw error.hint === 'only_admin' ? new OnlyAdmin(error) : new ApiError(error)
      // The account is gone: forget the session here (there is none left to sign out of on the server).
      await supabase.auth.signOut({ scope: 'local' })
      queryClient.clear()
    },
  })
}

export function useDeleteClub(clubId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('delete_club', { club: clubId })
      if (error) throw new ApiError(error)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-clubs'] }),
  })
}

// Saved print layout templates (see migration layout_templates): the club's (admins save, everyone in
// the club uses them) and one's own (only oneself, in any club). Layouts are stored with club tokens
// and checked with core when they are read; broken ones are left out.
import { type PrintLayout, parseTemplate } from '@course-setter/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from './api.ts'
import { supabase } from './supabase.ts'

export type TemplateScope = 'club' | 'personal'
export type SavedTemplate = {
  id: string
  name: string
  scope: TemplateScope
  layout: PrintLayout
  madeBy: string | null
  createdBy: string | null
  updatedAt: string
}

export const templateKeys = { list: (clubId: string) => ['layout-templates', clubId] as const }

/** The club's templates and one's own, by name. */
export function useTemplates(clubId: string) {
  return useQuery({
    queryKey: templateKeys.list(clubId),
    queryFn: async (): Promise<SavedTemplate[]> => {
      const { data, error } = await supabase
        .from('layout_templates')
        .select('id, club_id, owner_id, name, layout, created_by, updated_at, profiles!layout_templates_created_by_fkey(display_name)')
        .or(`club_id.eq.${clubId},owner_id.not.is.null`)
        .order('name')
      if (error) throw new ApiError(error)
      return (data ?? []).flatMap(r => {
        const layout = parseTemplate(r.layout)
        if (!layout) return []
        const profile = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles
        return [
          {
            id: r.id,
            name: r.name,
            scope: r.club_id ? 'club' : 'personal',
            layout,
            madeBy: profile?.display_name ?? null,
            createdBy: r.created_by,
            updatedAt: r.updated_at,
          } satisfies SavedTemplate,
        ]
      })
    },
  })
}

/**
 * Save a layout (already with club tokens) as a template; one of the same name in the same place is
 * replaced. Returns whether one was replaced.
 */
export function useSaveTemplate(clubId: string, userId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      name,
      scope,
      layout,
      existing,
    }: {
      name: string
      scope: TemplateScope
      layout: PrintLayout
      existing: SavedTemplate[]
    }): Promise<boolean> => {
      const trimmed = name.trim()
      const same = existing.find(t => t.scope === scope && t.name.toLowerCase() === trimmed.toLowerCase())
      const json = JSON.parse(JSON.stringify(layout))
      const { error } = same
        ? await supabase.from('layout_templates').update({ layout: json, updated_at: new Date().toISOString() }).eq('id', same.id)
        : await supabase
            .from('layout_templates')
            .insert({ name: trimmed, layout: json, created_by: userId, ...(scope === 'club' ? { club_id: clubId } : { owner_id: userId }) })
      if (error) throw new ApiError(error)
      return Boolean(same)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: templateKeys.list(clubId) }),
  })
}

export function useDeleteTemplate(clubId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('layout_templates').delete().eq('id', id)
      if (error) throw new ApiError(error)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: templateKeys.list(clubId) }),
  })
}

import type { Session } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.ts'

/** Current auth session: `undefined` while loading, `null` when signed out. */
export function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    // Also fires once with the initial session (after the OAuth redirect code is exchanged).
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  return session
}

/** Display name from the user's profile row (proves RLS lets a user read their own profile). */
export function useDisplayName(session: Session | null | undefined): string | undefined {
  const [name, setName] = useState<string>()
  const userId = session?.user.id

  useEffect(() => {
    if (!userId) {
      setName(undefined)
      return
    }
    let cancelled = false
    void supabase
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .single()
      .then(({ data, error }) => {
        if (error) console.error('Could not load profile:', error.message)
        if (!cancelled) setName(data?.display_name ?? undefined)
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  return name
}

export function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
}

export function signOut() {
  return supabase.auth.signOut()
}

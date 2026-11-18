import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.ts'

/** `undefined` while loading, `null` when signed out. */
export type SessionState = Session | null | undefined

export const SessionContext = createContext<SessionState>(undefined)

/** Tracks the Supabase auth session; used once, by the provider in main.tsx. */
export function useSupabaseSession(): SessionState {
  const [session, setSession] = useState<SessionState>(undefined)

  useEffect(() => {
    // Also fires once with the initial session (after the OAuth redirect code is exchanged).
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  return session
}

export function useSession(): SessionState {
  return useContext(SessionContext)
}

/** Signs in with Google and comes back to the current page (an invite link stays an invite link). */
export function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href } })
}

export function signOut() {
  return supabase.auth.signOut()
}

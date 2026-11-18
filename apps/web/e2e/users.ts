import { randomUUID } from 'node:crypto'
import type { Browser, Page } from '@playwright/test'
import { createClient, type Session } from '@supabase/supabase-js'
import { localSupabase } from '../../../supabase/tests/integration/local-supabase.ts'

const supabase = localSupabase()
export const admin = createClient(supabase.url, supabase.secretKey, { auth: { persistSession: false } })

export type TestUser = { id: string; name: string; session: Session }

/**
 * A confirmed user with a password, signed in from Node. The app only offers Google sign-in; password
 * sign-in exists on local Supabase only, so tests get a real session without a test-only login page.
 */
export async function createUser(name: string): Promise<TestUser> {
  const email = `e2e-${randomUUID()}@example.com`
  const password = randomUUID()
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } })
  if (created.error) throw created.error
  const client = createClient(supabase.url, supabase.publishableKey, { auth: { persistSession: false } })
  const signedIn = await client.auth.signInWithPassword({ email, password })
  if (signedIn.error) throw signedIn.error
  return { id: created.data.user.id, name, session: signedIn.data.session }
}

export async function deleteUsers(users: TestUser[]) {
  for (const user of users) await admin.auth.admin.deleteUser(user.id)
}

/** A page in its own browser context, signed in as `user` (the session is where supabase-js keeps it). */
export async function pageFor(browser: Browser, user: TestUser): Promise<Page> {
  const context = await browser.newContext()
  const storageKey = `sb-${new URL(supabase.url).hostname.split('.')[0]}-auth-token`
  await context.addInitScript({
    content: `localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(JSON.stringify(user.session))})`,
  })
  return context.newPage()
}

import { execSync } from 'node:child_process'

export type LocalSupabase = { url: string; secretKey: string; publishableKey: string }

/** URL and keys of the running local Supabase (`pnpm db:start`), read from `supabase status`. */
export function localSupabase(): LocalSupabase {
  let raw: string
  try {
    raw = execSync('supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    throw new Error('Local Supabase is not running; start it with `pnpm db:start`')
  }
  const s = JSON.parse(raw.slice(raw.indexOf('{'))) as Record<string, string | undefined>
  const url = s.API_URL
  const secretKey = s.SECRET_KEY ?? s.SERVICE_ROLE_KEY
  const publishableKey = s.PUBLISHABLE_KEY ?? s.ANON_KEY
  if (!url || !secretKey || !publishableKey) throw new Error(`Unexpected supabase status output: ${Object.keys(s).join(', ')}`)
  return { url, secretKey, publishableKey }
}

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type Job = {
  id: number
  type: string
  payload: Record<string, unknown>
  attempts: number
  max_attempts: number
}

/** The job queue as the worker sees it (the `jobs` table and its functions, see migration create_jobs). */
export type JobQueue = {
  /** Claim the next due job, or `null` when there is none. */
  claim(workerId: string): Promise<Job | null>
  complete(jobId: number, result: unknown): Promise<void>
  fail(jobId: number, error: string): Promise<void>
}

/** Supabase client with the secret key (service role): server only, bypasses row-level security. */
export function serviceClient(url: string, secretKey: string): SupabaseClient {
  return createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** Queue backed by Supabase; needs the secret key (service role), so it only ever runs on the server. */
export function supabaseQueue(db: SupabaseClient): JobQueue {
  return {
    async claim(workerId) {
      const { data, error } = await db.rpc('claim_job', { worker: workerId })
      if (error) throw new Error(`claim_job: ${error.message}`)
      return ((data as Job[] | null) ?? [])[0] ?? null
    },
    async complete(jobId, result) {
      const { error } = await db.rpc('complete_job', { job_id: jobId, job_result: result ?? null })
      if (error) throw new Error(`complete_job: ${error.message}`)
    },
    async fail(jobId, message) {
      const { error } = await db.rpc('fail_job', { job_id: jobId, job_error: message })
      if (error) throw new Error(`fail_job: ${error.message}`)
    },
  }
}

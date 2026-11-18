// The whole job path against local Supabase: inserting a job makes the database call the worker over
// HTTP (trigger -> pg_net), and the worker claims, runs and reports it. See worker.ts for which worker.
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { localSupabase } from './local-supabase.ts'
import { startWorker, type TestWorker, waitFor } from './worker.ts'

type JobRow = { id: number; status: string; attempts: number; result: unknown; error: string | null }

describe('job queue', () => {
  const { url, secretKey } = localSupabase()
  const admin = createClient(url, secretKey, { auth: { persistSession: false } })
  let worker: TestWorker

  const job = (id: number, until: (job: JobRow) => boolean) =>
    waitFor(`job ${id}`, async () => {
      const [row] = await worker.sql<JobRow[]>`select id, status, attempts, result, error from public.jobs where id = ${id}`
      return row && until(row) ? row : undefined
    })

  beforeAll(async () => {
    worker = await startWorker()
  })

  afterAll(async () => {
    await worker.sql`delete from public.jobs where type = 'ping' and payload ->> 'test' = 'job-queue'`
    await worker.stop()
  })

  it('runs a ping job as soon as it is inserted', async () => {
    const { data, error } = await admin
      .from('jobs')
      .insert({ type: 'ping', payload: { test: 'job-queue' } })
      .select('id')
      .single()
    if (error) throw error

    expect(await job(data.id, j => j.status === 'done')).toMatchObject({ status: 'done', attempts: 1, result: { pong: true }, error: null })
  })

  it('retries a failing job and then marks it failed', async () => {
    const { data, error } = await admin
      .from('jobs')
      .insert({ type: 'ping', payload: { test: 'job-queue', fail: true }, max_attempts: 2 })
      .select('id')
      .single()
    if (error) throw error

    const first = await job(data.id, j => j.attempts === 1 && j.status === 'queued')
    expect(first.error).toBe('ping asked to fail')

    // Skip the backoff and run the sweep that pg_cron runs every minute: it pokes the worker again.
    await worker.sql`update public.jobs set run_after = now() where id = ${data.id}`
    await worker.sql`select private.sweep_jobs()`

    expect(await job(data.id, j => j.status === 'failed')).toMatchObject({ status: 'failed', attempts: 2, error: 'ping asked to fail' })
  })
})

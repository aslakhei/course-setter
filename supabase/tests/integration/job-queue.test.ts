// The whole job path against local Supabase: inserting a job makes the database call the worker over
// HTTP (trigger -> pg_net), and the worker claims, runs and reports it.
//
// By default the worker runs in this process and the database container reaches it through the Docker
// host. To test a worker container instead (as CI does with the built image), set JOB_WORKER_URL to its
// /jobs/run URL as seen from the database container, and JOB_WORKER_SECRET to its WORKER_SECRET.
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drain } from '../../../apps/worker/src/jobs.ts'
import { supabaseQueue } from '../../../apps/worker/src/queue.ts'
import { createServer } from '../../../apps/worker/src/server.ts'
import { localSupabase } from './local-supabase.ts'

const external = process.env.JOB_WORKER_URL ? { url: process.env.JOB_WORKER_URL, secret: process.env.JOB_WORKER_SECRET ?? '' } : null

type JobRow = { id: number; status: string; attempts: number; result: unknown; error: string | null }

describe('job queue', () => {
  const { url, secretKey, dbUrl } = localSupabase()
  const admin = createClient(url, secretKey, { auth: { persistSession: false } })
  const sql = postgres(dbUrl, { onnotice: () => {} })
  const secret = external?.secret ?? randomBytes(16).toString('hex')
  const server = createServer({ secret, drain: () => drain(supabaseQueue(url, secretKey), 'integration-test') })

  async function setWorkerEndpoint(workerUrl: string | null, workerSecret: string | null) {
    await sql`delete from vault.secrets where name in ('worker_url', 'worker_secret')`
    if (workerUrl && workerSecret) {
      await sql`select vault.create_secret(${workerUrl}, 'worker_url'), vault.create_secret(${workerSecret}, 'worker_secret')`
    }
  }

  async function waitForJob(id: number, until: (job: JobRow) => boolean): Promise<JobRow> {
    const deadline = Date.now() + 20_000
    for (;;) {
      const [job] = await sql<JobRow[]>`select id, status, attempts, result, error from public.jobs where id = ${id}`
      if (job && until(job)) return job
      if (Date.now() > deadline) throw new Error(`job ${id} stuck: ${JSON.stringify(job)}`)
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }

  beforeAll(async () => {
    if (external) {
      await setWorkerEndpoint(external.url, secret)
      return
    }
    await new Promise<void>(resolve => server.listen(0, '0.0.0.0', resolve))
    const { port } = server.address() as AddressInfo
    // Docker Desktop resolves host.docker.internal to this machine from inside containers.
    await setWorkerEndpoint(`http://host.docker.internal:${port}/jobs/run`, secret)
  })

  afterAll(async () => {
    await setWorkerEndpoint(null, null)
    await sql`delete from public.jobs where type = 'ping' and payload ->> 'test' = 'job-queue'`
    await sql.end()
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()))
  })

  it('runs a ping job as soon as it is inserted', async () => {
    const { data, error } = await admin
      .from('jobs')
      .insert({ type: 'ping', payload: { test: 'job-queue' } })
      .select('id')
      .single()
    if (error) throw error

    const job = await waitForJob(data.id, j => j.status === 'done')
    expect(job).toMatchObject({ status: 'done', attempts: 1, result: { pong: true }, error: null })
  })

  it('retries a failing job and then marks it failed', async () => {
    const { data, error } = await admin
      .from('jobs')
      .insert({ type: 'ping', payload: { test: 'job-queue', fail: true }, max_attempts: 2 })
      .select('id')
      .single()
    if (error) throw error

    const first = await waitForJob(data.id, j => j.attempts === 1 && j.status === 'queued')
    expect(first.error).toBe('ping asked to fail')

    // Skip the backoff and run the sweep that pg_cron runs every minute: it pokes the worker again.
    await sql`update public.jobs set run_after = now() where id = ${data.id}`
    await sql`select private.sweep_jobs()`

    const last = await waitForJob(data.id, j => j.status === 'failed')
    expect(last).toMatchObject({ status: 'failed', attempts: 2, error: 'ping asked to fail' })
  })
})

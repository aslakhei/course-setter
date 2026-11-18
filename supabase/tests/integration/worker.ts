// A worker the local database can reach, for tests that go through the job queue.
//
// By default the worker runs in this process and the database container reaches it through the Docker
// host (Docker Desktop resolves host.docker.internal). To test a worker container instead (as CI does
// with the built image), set JOB_WORKER_URL to its /jobs/run URL as seen from the database container,
// and JOB_WORKER_SECRET to its WORKER_SECRET.
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import postgres from 'postgres'
import { allHandlers, drain } from '../../../apps/worker/src/jobs.ts'
import { serviceClient, supabaseQueue } from '../../../apps/worker/src/queue.ts'
import { createServer } from '../../../apps/worker/src/server.ts'
import { localSupabase } from './local-supabase.ts'

export type TestWorker = { sql: postgres.Sql; stop: () => Promise<void> }

/** Point the database's Vault secrets at a worker; `stop` clears them and stops an in-process worker. */
export async function startWorker(): Promise<TestWorker> {
  const { url, secretKey, dbUrl } = localSupabase()
  const sql = postgres(dbUrl, { onnotice: () => {} })
  const external = process.env.JOB_WORKER_URL
  const secret = external ? (process.env.JOB_WORKER_SECRET ?? '') : randomBytes(16).toString('hex')

  let workerUrl = external ?? ''
  let server: ReturnType<typeof createServer> | undefined
  if (!external) {
    const db = serviceClient(url, secretKey)
    server = createServer({ secret, drain: () => drain(supabaseQueue(db), 'integration-test', allHandlers(db)) })
    await new Promise<void>(resolve => server?.listen(0, '0.0.0.0', resolve))
    workerUrl = `http://host.docker.internal:${(server.address() as AddressInfo).port}/jobs/run`
  }

  await sql`delete from vault.secrets where name in ('worker_url', 'worker_secret')`
  await sql`select vault.create_secret(${workerUrl}, 'worker_url'), vault.create_secret(${secret}, 'worker_secret')`

  return {
    sql,
    async stop() {
      await sql`delete from vault.secrets where name in ('worker_url', 'worker_secret')`
      await sql.end()
      if (server?.listening) await new Promise<void>(resolve => server?.close(() => resolve()))
    },
  }
}

/** Poll until `check` returns a value (not undefined), or fail after `timeoutMs`. */
export async function waitFor<T>(what: string, check: () => Promise<T | undefined>, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise(resolve => setTimeout(resolve, 300))
  }
}

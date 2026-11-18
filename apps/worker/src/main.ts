import { hostname } from 'node:os'
import { drain } from './jobs.ts'
import { supabaseQueue } from './queue.ts'
import { createServer, type ServerOptions } from './server.ts'

// Cloud Run provides PORT; 8080 is its default.
const port = Number(process.env.PORT ?? 8080)
const { SUPABASE_URL, SUPABASE_SECRET_KEY, WORKER_SECRET } = process.env

let jobs: ServerOptions = {}
if (SUPABASE_URL && SUPABASE_SECRET_KEY && WORKER_SECRET) {
  const queue = supabaseQueue(SUPABASE_URL, SUPABASE_SECRET_KEY)
  // K_REVISION is set by Cloud Run; it shows which deployment ran a job.
  const workerId = [process.env.K_REVISION, hostname()].filter(Boolean).join('/')
  jobs = { secret: WORKER_SECRET, drain: () => drain(queue, workerId) }
} else {
  console.warn('SUPABASE_URL, SUPABASE_SECRET_KEY or WORKER_SECRET not set: /jobs/run is disabled')
}

const server = createServer(jobs).listen(port, () => {
  console.log(`worker listening on :${port}`)
})

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)))
}

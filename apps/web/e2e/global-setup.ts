// Map tests need a worker the local database can reach: the worker container in CI (JOB_WORKER_URL),
// otherwise one in this process. See supabase/tests/integration/worker.ts.
import { startWorker } from '../../../supabase/tests/integration/worker.ts'

export default async function globalSetup() {
  const worker = await startWorker()
  return () => worker.stop()
}

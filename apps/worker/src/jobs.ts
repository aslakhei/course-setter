import type { Job, JobQueue } from './queue.ts'

/** Runs one job and returns its result; throwing fails the attempt (it is retried until max_attempts). */
export type JobHandler = (job: Job) => Promise<unknown>

export const handlers: Record<string, JobHandler> = {
  // Health check through the whole queue. `{ "fail": true }` makes it fail, to exercise retries.
  async ping(job) {
    if (job.payload.fail === true) throw new Error('ping asked to fail')
    return { pong: true }
  },
}

export type DrainResult = { done: number; failed: number }

/** Claim and run jobs until none are due. */
export async function drain(queue: JobQueue, workerId: string, jobHandlers: Record<string, JobHandler> = handlers): Promise<DrainResult> {
  const counts: DrainResult = { done: 0, failed: 0 }
  for (let job = await queue.claim(workerId); job; job = await queue.claim(workerId)) {
    const handler = Object.hasOwn(jobHandlers, job.type) ? jobHandlers[job.type] : undefined
    try {
      if (!handler) throw new Error(`unknown job type "${job.type}"`)
      await queue.complete(job.id, await handler(job))
      counts.done++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`job ${job.id} (${job.type}) attempt ${job.attempts}/${job.max_attempts} failed: ${message}`)
      await queue.fail(job.id, message)
      counts.failed++
    }
  }
  return counts
}

import { describe, expect, it, vi } from 'vitest'
import { drain, handlers } from './jobs.ts'
import type { Job, JobQueue } from './queue.ts'

/** In-memory queue that hands out the given jobs once and records the outcome of each. */
function fakeQueue(jobs: Partial<Job>[]) {
  const pending = jobs.map((j, i) => ({ id: i + 1, type: 'ping', payload: {}, attempts: 1, max_attempts: 3, ...j }))
  const completed = new Map<number, unknown>()
  const failed = new Map<number, string>()
  const queue: JobQueue = {
    claim: async () => pending.shift() ?? null,
    complete: async (id, result) => void completed.set(id, result),
    fail: async (id, error) => void failed.set(id, error),
  }
  return { queue, completed, failed }
}

describe('drain', () => {
  it('runs every due job and reports the outcome of each', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { queue, completed, failed } = fakeQueue([
      { type: 'ping' },
      { type: 'ping', payload: { fail: true } },
      { type: 'nonsense' },
      { type: 'toString' }, // not mistaken for a handler via the prototype
    ])

    expect(await drain(queue, 'w1')).toEqual({ done: 1, failed: 3 })
    expect(completed).toEqual(new Map([[1, { pong: true }]]))
    expect(failed).toEqual(
      new Map([
        [2, 'ping asked to fail'],
        [3, 'unknown job type "nonsense"'],
        [4, 'unknown job type "toString"'],
      ]),
    )
  })

  it('returns at once when the queue is empty', async () => {
    expect(await drain(fakeQueue([]).queue, 'w1', handlers)).toEqual({ done: 0, failed: 0 })
  })
})

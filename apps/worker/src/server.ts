import { timingSafeEqual } from 'node:crypto'
import { createServer as createHttpServer, type Server, type ServerResponse } from 'node:http'
import type { DrainResult } from './jobs.ts'

export type ServerOptions = {
  /** Shared secret the database sends in `x-worker-secret` (Vault secret `worker_secret`). */
  secret?: string
  /** Runs due jobs; called for each authorised `POST /jobs/run`. */
  drain?: () => Promise<DrainResult>
}

/**
 * HTTP entry point of the worker.
 * - `GET /health`: liveness.
 * - `POST /jobs/run`: sent by the database when jobs are added or due; answers when the queue is drained.
 */
export function createServer({ secret, drain }: ServerOptions = {}): Server {
  return createHttpServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      return json(res, 200, { status: 'ok' })
    }
    if (req.method === 'POST' && req.url === '/jobs/run') {
      req.resume() // the body is not used
      if (!secret || !drain) return json(res, 503, { error: 'job queue not configured' })
      if (!sameSecret(req.headers['x-worker-secret'], secret)) return json(res, 401, { error: 'unauthorised' })
      drain().then(
        result => json(res, 200, result),
        err => {
          console.error('draining the job queue failed:', err)
          json(res, 500, { error: 'drain failed' })
        },
      )
      return
    }
    json(res, 404, { error: 'not found' })
  })
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

function sameSecret(given: string | string[] | undefined, expected: string): boolean {
  if (typeof given !== 'string') return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

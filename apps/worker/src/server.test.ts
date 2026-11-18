import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createServer, type ServerOptions } from './server.ts'

async function listen(options?: ServerOptions) {
  const server = createServer(options)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }
}

describe('worker HTTP server', () => {
  const drain = vi.fn(async () => ({ done: 2, failed: 1 }))
  let ctx: Awaited<ReturnType<typeof listen>>

  beforeAll(async () => {
    ctx = await listen({ secret: 's3cret', drain })
  })
  afterAll(() => new Promise<void>(resolve => ctx.server.close(() => resolve())))

  it('reports health', async () => {
    const res = await fetch(`${ctx.base}/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('returns 404 for unknown routes', async () => {
    const res = await fetch(`${ctx.base}/nope`)
    expect(res.status).toBe(404)
  })

  it('drains the queue when called with the shared secret', async () => {
    const res = await fetch(`${ctx.base}/jobs/run`, { method: 'POST', headers: { 'x-worker-secret': 's3cret' }, body: '{}' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ done: 2, failed: 1 })
    expect(drain).toHaveBeenCalledOnce()
  })

  it('rejects a missing or wrong secret without running jobs', async () => {
    drain.mockClear()
    for (const headers of [{}, { 'x-worker-secret': 'nope' }, { 'x-worker-secret': 's3cret-but-longer' }]) {
      const res = await fetch(`${ctx.base}/jobs/run`, { method: 'POST', headers })
      expect(res.status).toBe(401)
    }
    expect(drain).not.toHaveBeenCalled()
  })

  it('reports a failed drain as 500', async () => {
    drain.mockRejectedValueOnce(new Error('database down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await fetch(`${ctx.base}/jobs/run`, { method: 'POST', headers: { 'x-worker-secret': 's3cret' } })
    expect(res.status).toBe(500)
  })
})

describe('worker without queue configuration', () => {
  it('refuses /jobs/run', async () => {
    const { server, base } = await listen()
    const res = await fetch(`${base}/jobs/run`, { method: 'POST', headers: { 'x-worker-secret': '' } })
    expect(res.status).toBe(503)
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
})

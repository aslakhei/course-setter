import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createGuardServer, parseBudgetPush, removePublicAccess } from './budget-guard.ts'

const push = (data: unknown) =>
  JSON.stringify({ message: { data: Buffer.from(JSON.stringify(data)).toString('base64') }, subscription: 's' })

describe('parseBudgetPush', () => {
  it('reads cost and budget from a Pub/Sub push', () => {
    expect(parseBudgetPush(push({ costAmount: 0.4, budgetAmount: 1, currencyCode: 'NOK' }))).toMatchObject({
      costAmount: 0.4,
      budgetAmount: 1,
    })
  })

  it('rejects anything else', () => {
    for (const body of ['', 'nope', '{}', JSON.stringify({ message: { data: 'bm9wZQ==' } }), push({ costAmount: '1' })]) {
      expect(parseBudgetPush(body)).toBeNull()
    }
  })
})

describe('budget guard server', () => {
  const disableWorker = vi.fn(async () => {})
  const server = createGuardServer({ disableWorker })
  let base = ''

  beforeAll(async () => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterAll(() => new Promise<void>(resolve => server.close(() => resolve())))

  const send = (body: string) => fetch(base, { method: 'POST', body })

  it('leaves the worker alone while under budget', async () => {
    expect((await send(push({ costAmount: 0.99, budgetAmount: 1 }))).status).toBe(204)
    expect(disableWorker).not.toHaveBeenCalled()
  })

  it('disables the worker when the budget is reached', async () => {
    expect((await send(push({ costAmount: 1, budgetAmount: 1 }))).status).toBe(204)
    expect(disableWorker).toHaveBeenCalledOnce()
  })

  it('asks Pub/Sub to retry when disabling fails', async () => {
    disableWorker.mockRejectedValueOnce(new Error('denied'))
    expect((await send(push({ costAmount: 5, budgetAmount: 1 }))).status).toBe(500)
  })

  it('acknowledges messages it cannot read', async () => {
    disableWorker.mockClear()
    expect((await send('garbage')).status).toBe(204)
    expect(disableWorker).not.toHaveBeenCalled()
  })
})

describe('removePublicAccess', () => {
  it('replaces the service IAM policy with an empty one using the metadata token', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, _init?: RequestInit) =>
      String(url).startsWith('http://metadata') ? Response.json({ access_token: 'tok' }) : new Response('{}'),
    )
    await removePublicAccess('worker', 'proj', 'europe-north1', fetchFn as typeof fetch)

    const [url, init] = fetchFn.mock.calls[1] ?? []
    expect(url).toBe('https://run.googleapis.com/v2/projects/proj/locations/europe-north1/services/worker:setIamPolicy')
    expect(init?.headers).toMatchObject({ authorization: 'Bearer tok' })
    expect(JSON.parse(String(init?.body))).toEqual({ policy: { bindings: [] } })
  })

  it('fails loudly when the API refuses', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      String(url).startsWith('http://metadata') ? Response.json({ access_token: 'tok' }) : new Response('nope', { status: 403 }),
    )
    await expect(removePublicAccess('worker', 'p', 'r', fetchFn as typeof fetch)).rejects.toThrow('HTTP 403')
  })
})

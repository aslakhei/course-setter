// Budget guard: a separate Cloud Run service (same image, `node src/budget-guard.ts`) that receives the
// Google Cloud budget notifications through Pub/Sub. When the month's cost reaches the budget it removes
// public access to the worker, so nothing can start a worker instance (and cost money) any more.
// Redeploying the worker (the Deploy workflow) makes it public again. See scripts/setup-gcp.sh.
import { createServer as createHttpServer, type IncomingMessage, type Server } from 'node:http'

/** The fields we use from a budget notification (https://cloud.google.com/billing/docs/how-to/budgets-programmatic-notifications). */
export type BudgetNotification = { budgetDisplayName?: string; costAmount: number; budgetAmount: number; currencyCode?: string }

/** Decode a Pub/Sub push body; `null` if it is not a budget notification. */
export function parseBudgetPush(body: string): BudgetNotification | null {
  try {
    const push = JSON.parse(body) as { message?: { data?: string } }
    if (!push.message?.data) return null
    const n = JSON.parse(Buffer.from(push.message.data, 'base64').toString('utf8')) as Partial<BudgetNotification>
    if (typeof n.costAmount !== 'number' || typeof n.budgetAmount !== 'number') return null
    return n as BudgetNotification
  } catch {
    return null
  }
}

export const overBudget = (n: BudgetNotification) => n.costAmount >= n.budgetAmount

export type GuardOptions = {
  /** Cuts off the worker; throwing makes Pub/Sub retry the notification. */
  disableWorker: () => Promise<void>
}

export function createGuardServer({ disableWorker }: GuardOptions): Server {
  return createHttpServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/') {
      res.writeHead(404).end()
      return
    }
    const notification = parseBudgetPush(await readBody(req))
    if (!notification) {
      // Acknowledge anyway: retrying a message we cannot read would not help.
      console.warn('ignoring a message that is not a budget notification')
      res.writeHead(204).end()
      return
    }
    const { costAmount, budgetAmount, currencyCode = '' } = notification
    if (!overBudget(notification)) {
      res.writeHead(204).end()
      return
    }
    console.warn(`cost ${costAmount} ${currencyCode} reached the budget of ${budgetAmount} ${currencyCode}: disabling the worker`)
    try {
      await disableWorker()
      res.writeHead(204).end()
    } catch (err) {
      console.error('disabling the worker failed:', err)
      res.writeHead(500).end()
    }
  })
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/** Remove every IAM binding of a Cloud Run service (including allUsers -> invoker), using the service's own identity. */
export async function removePublicAccess(service: string, project: string, region: string, fetchFn: typeof fetch = fetch): Promise<void> {
  const tokenRes = await fetchFn('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
    headers: { 'metadata-flavor': 'Google' },
  })
  if (!tokenRes.ok) throw new Error(`metadata token: HTTP ${tokenRes.status}`)
  const { access_token } = (await tokenRes.json()) as { access_token: string }

  const url = `https://run.googleapis.com/v2/projects/${project}/locations/${region}/services/${service}:setIamPolicy`
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ policy: { bindings: [] } }),
  })
  if (!res.ok) throw new Error(`setIamPolicy: HTTP ${res.status} ${await res.text()}`)
}

if (import.meta.main) {
  const { GUARDED_SERVICE = 'worker', GCP_PROJECT_ID, GCP_REGION = 'europe-north1', PORT = '8080' } = process.env
  if (!GCP_PROJECT_ID) throw new Error('GCP_PROJECT_ID is not set')
  const server = createGuardServer({ disableWorker: () => removePublicAccess(GUARDED_SERVICE, GCP_PROJECT_ID, GCP_REGION) })
  server.listen(Number(PORT), () => console.log(`budget guard for ${GUARDED_SERVICE} listening on :${PORT}`))
  process.on('SIGTERM', () => server.close(() => process.exit(0)))
}

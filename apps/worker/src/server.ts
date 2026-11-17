import { createServer as createHttpServer, type Server } from 'node:http'

/** HTTP entry point of the worker. Job handling is added with the job queue. */
export function createServer(): Server {
  return createHttpServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'ok' }))
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'not found' }))
  })
}

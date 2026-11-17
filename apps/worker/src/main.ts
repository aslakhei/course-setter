import { createServer } from './server.ts'

// Cloud Run provides PORT; 8080 is its default.
const port = Number(process.env.PORT ?? 8080)

const server = createServer().listen(port, () => {
  console.log(`worker listening on :${port}`)
})

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)))
}

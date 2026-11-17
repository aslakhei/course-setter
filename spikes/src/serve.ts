// Prototype: local static server for the tile viewer, with HTTP Range support (as PMTiles needs).
// Usage: pnpm --dir spikes serve   ->  http://127.0.0.1:8787
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { outPath } from './lib/util.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tilesDir = outPath('tiles')
const routes: Record<string, [string, string]> = {
  '/': [join(root, 'viewer/index.html'), 'text/html; charset=utf-8'],
  '/lib/ol.js': [join(root, 'node_modules/ol/dist/ol.js'), 'text/javascript'],
  '/lib/ol.css': [join(root, 'node_modules/ol/ol.css'), 'text/css'],
  '/lib/pmtiles.js': [join(root, 'node_modules/pmtiles/dist/pmtiles.js'), 'text/javascript'],
}

const PORT = 8787
createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
  if (url === '/tiles/') {
    const names = existsSync(tilesDir) ? readdirSync(tilesDir).filter(n => n.endsWith('.pmtiles')) : []
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(names))
    return
  }
  let file: string
  let type: string
  if (url.startsWith('/tiles/')) {
    file = join(tilesDir, basename(url)) // basename: no path traversal
    type = 'application/octet-stream'
  } else if (routes[url]) {
    ;[file, type] = routes[url]
  } else {
    res.writeHead(404).end()
    return
  }
  if (!existsSync(file)) {
    res.writeHead(404).end()
    return
  }
  const size = statSync(file).size
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '')
  if (range) {
    const start = Number(range[1])
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    res.writeHead(206, {
      'content-type': type,
      'content-range': `bytes ${start}-${end}/${size}`,
      'content-length': end - start + 1,
      'accept-ranges': 'bytes',
    })
    createReadStream(file, { start, end }).pipe(res)
  } else {
    res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' })
    createReadStream(file).pipe(res)
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Tile viewer: http://127.0.0.1:${PORT}`))

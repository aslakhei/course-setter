// The club's own map, tested only where it exists (spikes/maps/ is never committed: club property) and
// only when asked for, since it takes about a minute. Same check as the rendering spike: boulders
// (ISOM 204) from the OCAD file land on black pixels in the finest tiles. Run with
//   TEST_CLUB_MAP=1 pnpm --filter @course-setter/worker exec vitest run src/maps/club-map.test.ts
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tileGrid } from '@course-setter/core'
import { readOcad } from 'ocad2geojson'
import { describe, expect, it } from 'vitest'
import { loadOcad } from './ocad.ts'
import { writePmtiles } from './pmtiles.ts'
import { buildTiles } from './pyramid.ts'
import { isDark, pixelAt, readArchive } from './test-helpers.ts'

const dir = fileURLToPath(new URL('../../../../spikes/maps/', import.meta.url))
const file = existsSync(dir) ? readdirSync(dir).find(f => f.endsWith('.ocd')) : undefined

describe.skipIf(!file || process.env.TEST_CLUB_MAP !== '1')('the club map', () => {
  it('puts 40 known boulders on black pixels', { timeout: 300_000 }, async () => {
    const buffer = readFileSync(`${dir}${file}`)
    const map = await loadOcad(buffer)
    const grid = tileGrid({ widthMm: map.widthMm, heightMm: map.heightMm, scale: map.scale, origin: map.origin })
    const started = performance.now()
    const tiles = await buildTiles(map, grid)
    const archive = writePmtiles(tiles, {}, 0, grid.levels.length - 1)
    console.log(
      `${file}: ${tiles.length} tiles, ${(archive.length / 1e6).toFixed(1)} MB in ${((performance.now() - started) / 1000).toFixed(0)} s`,
    )

    const ocad = await readOcad(buffer, { quietWarnings: true })
    const boulders = (ocad.objects as unknown as Array<{ sym: number; coordinates: number[][] }>).filter(o => o.sym === 204000)
    expect(boulders.length).toBeGreaterThan(40)
    const picks = Array.from({ length: 40 }, (_, i) => boulders[Math.floor((i * boulders.length) / 40)])
    const ground = (units: number) => (units / 100 / 1000) * map.scale
    const reader = readArchive(archive)
    let hits = 0
    for (const b of picks) {
      const [x, y] = b?.coordinates[0] ?? [0, 0]
      if (isDark(await pixelAt(reader, grid, grid.levels.length - 1, ground(x ?? 0), ground(y ?? 0)))) hits++
    }
    expect(hits).toBeGreaterThanOrEqual(38)
  })
})

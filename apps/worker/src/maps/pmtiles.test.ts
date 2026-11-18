import { describe, expect, it } from 'vitest'
import { type Tile, writePmtiles } from './pmtiles.ts'
import { readArchive } from './test-helpers.ts'

const tile = (z: number, x: number, y: number, fill: number): Tile => ({ z, x, y, data: Uint8Array.from([z, x, y, fill]) })

describe('writePmtiles', () => {
  it('writes an archive the official reader reads back, metadata included', async () => {
    const tiles = [tile(0, 0, 0, 1), tile(1, 0, 0, 2), tile(1, 1, 1, 3)]
    const reader = readArchive(writePmtiles(tiles, { scale: 15000 }, 0, 1))
    const header = await reader.getHeader()
    expect(header).toMatchObject({ specVersion: 3, minZoom: 0, maxZoom: 1, numAddressedTiles: 3, tileType: 2 })
    expect(await reader.getMetadata()).toEqual({ scale: 15000 })
    for (const t of tiles) expect(new Uint8Array((await reader.getZxy(t.z, t.x, t.y))?.data ?? [])).toEqual(t.data)
    expect(await reader.getZxy(1, 1, 0)).toBeUndefined()
  })

  it('stores identical tiles once', async () => {
    const same = Uint8Array.from([9, 9, 9])
    const archive = writePmtiles(
      [0, 1, 2, 3].map(i => ({ z: 2, x: i, y: 0, data: same })),
      {},
      2,
      2,
    )
    const header = await readArchive(archive).getHeader()
    expect(header.numTileContents).toBe(1)
    expect(header.numAddressedTiles).toBe(4)
  })

  it('splits a large directory into leaf directories', async () => {
    // 65 536 tiles of varying size at z 8: the root directory alone would not fit in the first 16 KiB.
    const tiles: Tile[] = []
    let seed = 42
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed / 2 ** 31
    }
    for (let x = 0; x < 256; x++) {
      for (let y = 0; y < 256; y++) {
        const data = new Uint8Array(4 + Math.floor(random() * 2000))
        data.set([x, y, x ^ y, 1])
        tiles.push({ z: 8, x, y, data })
      }
    }
    const archive = writePmtiles(tiles, {}, 8, 8)
    const reader = readArchive(archive)
    const header = await reader.getHeader()
    expect(header.leafDirectoryLength).toBeGreaterThan(0)
    expect(header.rootDirectoryLength).toBeLessThanOrEqual(16384 - 127)
    for (const [x, y] of [
      [0, 0],
      [64, 17],
      [255, 255],
    ] as const) {
      expect(Array.from(new Uint8Array((await reader.getZxy(8, x, y))?.data ?? [])).slice(0, 4)).toEqual([x, y, x ^ y, 1])
    }
  })
})

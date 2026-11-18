import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { type TileGrid, tilePixelAt } from '@course-setter/core'
import { PMTiles, type Source } from 'pmtiles'
import sharp from 'sharp'

/** An .ocd file from ocad2geojson's test data (AGPL-3.0, see test/fixtures/ocad/LICENSE-ocad2geojson). */
export function fixture(name: string): Buffer {
  return readFileSync(fileURLToPath(new URL(`../../test/fixtures/ocad/${name}`, import.meta.url)))
}

export function readArchive(archive: Buffer): PMTiles {
  const source: Source = {
    getKey: () => 'memory',
    getBytes: async (offset, length) => ({
      data: archive.buffer.slice(archive.byteOffset + offset, archive.byteOffset + offset + length) as ArrayBuffer,
    }),
  }
  return new PMTiles(source)
}

/** RGB of the pixel at frame point (x, y) in the archive's tile at zoom z; null when no tile is stored there. */
export async function pixelAt(reader: PMTiles, grid: TileGrid, z: number, x: number, y: number): Promise<[number, number, number] | null> {
  const { tileX, tileY, px, py } = tilePixelAt(grid, z, x, y)
  const tile = await reader.getZxy(z, tileX, tileY)
  if (!tile) return null
  const rgb = await sharp(Buffer.from(tile.data)).removeAlpha().raw().toBuffer()
  const i = (Math.floor(py) * grid.tileSize + Math.floor(px)) * 3
  return [rgb[i] as number, rgb[i + 1] as number, rgb[i + 2] as number]
}

export const isDark = (rgb: [number, number, number] | null) => rgb !== null && rgb[0] + rgb[1] + rgb[2] < 3 * 90

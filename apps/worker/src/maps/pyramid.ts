// Cut a map into its tile pyramid. Each level is rendered from the original (vector) map at that
// level's resolution, in strips of rows, and each strip is cut into tiles and compressed right away:
// memory stays bounded by one strip, whatever the map size, and coarse levels stay as sharp as
// the vector source allows (no blurring from downsampling).
import type { TileGrid } from '@course-setter/core'
import sharp from 'sharp'
import type { MapSource } from './source.ts'

export type EncodedTile = { z: number; x: number; y: number; data: Buffer }

/** A tile whose every channel is at least this light counts as blank paper and is not stored. */
const BLANK = 250
const ENCODE_BATCH = 16

export async function buildTiles(source: MapSource, grid: TileGrid, { stripRows = 16 } = {}): Promise<EncodedTile[]> {
  const size = grid.tileSize
  const stripPx = stripRows * size
  const tiles: EncodedTile[] = []
  for (const level of grid.levels) {
    const cols = Math.ceil(level.widthPx / size)
    for (let top = 0; top < level.heightPx; top += stripPx) {
      const height = Math.min(stripPx, level.heightPx - top)
      const strip = source.render({ x: 0, y: top, width: level.widthPx, height }, level.mmPerPx)
      const pending: Promise<EncodedTile>[] = []
      for (let row = 0; row * size < height; row++) {
        for (let col = 0; col < cols; col++) {
          const pixels = cutTile(strip, level.widthPx, height, col * size, row * size, size)
          if (!pixels) continue
          const [z, x, y] = [level.z, col, top / size + row]
          pending.push(encodePng(pixels, size).then(data => ({ z, x, y, data })))
          if (pending.length >= ENCODE_BATCH) tiles.push(...(await Promise.all(pending.splice(0))))
        }
      }
      tiles.push(...(await Promise.all(pending)))
    }
  }
  return tiles
}

/** The size × size tile at (left, top) of an RGB image, padded with white; null when it is blank. */
export function cutTile(rgb: Buffer, width: number, height: number, left: number, top: number, size: number): Buffer | null {
  const tile = Buffer.alloc(size * size * 3, 255)
  const columns = Math.min(size, width - left)
  let ink = false
  for (let y = 0; y < size && top + y < height; y++) {
    const from = ((top + y) * width + left) * 3
    const to = from + columns * 3
    rgb.copy(tile, y * size * 3, from, to)
    if (!ink) {
      for (let i = from; i < to; i++) {
        if ((rgb[i] as number) < BLANK) {
          ink = true
          break
        }
      }
    }
  }
  return ink ? tile : null
}

/** 256-colour palette PNG: lossless-looking for maps (few colours), unlike lossy WebP (FINDINGS). */
function encodePng(rgb: Buffer, size: number): Promise<Buffer> {
  return sharp(rgb, { raw: { width: size, height: size, channels: 3 } })
    .png({ palette: true, colours: 256, effort: 7 })
    .toBuffer()
}

// The tile pyramid of a map version, shared by the worker (which cuts the tiles) and the viewer
// (which places them). Coordinates are ground metres in the version's map frame, y up; tile (z, 0, 0)
// starts at the top-left corner of the map and tile rows count downwards, as OpenLayers expects.
import { paperMmToGroundM, type ScaleDenominator } from './scale.ts'

export const TILE_SIZE = 256
/** Paper millimetres per pixel at the finest level: 0.05 mm (508 dpi), enough to zoom in on any symbol. */
export const FINEST_PAPER_MM_PER_PX = 0.05

/** Extent in ground metres in a map frame. */
export type Extent = { minX: number; minY: number; maxX: number; maxY: number }

export type TileLevel = {
  z: number
  /** Paper millimetres per pixel. */
  mmPerPx: number
  /** Ground metres per pixel. */
  resolution: number
  widthPx: number
  heightPx: number
}

export type TileGrid = {
  tileSize: number
  /** Top-left corner of the map (and of tile z/0/0) in the map frame. */
  origin: [number, number]
  extent: Extent
  /** Index = zoom; z 0 is the coarsest level, the last one the finest. */
  levels: TileLevel[]
}

/**
 * The pyramid for a map `widthMm` × `heightMm` on paper at `scale`, whose top-left corner is at
 * `origin` in the map frame. Every level is the whole map; each coarser level halves the resolution
 * until the map fits in one tile.
 */
export function tileGrid({
  widthMm,
  heightMm,
  scale,
  origin,
  finestMmPerPx = FINEST_PAPER_MM_PER_PX,
}: {
  widthMm: number
  heightMm: number
  scale: ScaleDenominator
  origin: [number, number]
  finestMmPerPx?: number
}): TileGrid {
  if (!(widthMm > 0 && heightMm > 0)) throw new RangeError(`Invalid map size ${widthMm} × ${heightMm} mm`)
  const finestPx = Math.max(Math.ceil(widthMm / finestMmPerPx), Math.ceil(heightMm / finestMmPerPx))
  const maxZ = Math.max(0, Math.ceil(Math.log2(finestPx / TILE_SIZE)))
  const levels = Array.from({ length: maxZ + 1 }, (_, z): TileLevel => {
    const mmPerPx = finestMmPerPx * 2 ** (maxZ - z)
    return {
      z,
      mmPerPx,
      resolution: paperMmToGroundM(mmPerPx, scale),
      widthPx: Math.ceil(widthMm / mmPerPx),
      heightPx: Math.ceil(heightMm / mmPerPx),
    }
  })
  const [x, y] = origin
  return {
    tileSize: TILE_SIZE,
    origin,
    extent: { minX: x, minY: y - paperMmToGroundM(heightMm, scale), maxX: x + paperMmToGroundM(widthMm, scale), maxY: y },
    levels,
  }
}

export function maxZoom(grid: TileGrid): number {
  return grid.levels.length - 1
}

/** The tile at zoom `z` that holds the frame point (x, y), and the pixel within it. */
export function tilePixelAt(grid: TileGrid, z: number, x: number, y: number): { tileX: number; tileY: number; px: number; py: number } {
  const level = grid.levels[z]
  if (!level) throw new RangeError(`No zoom level ${z}`)
  const gx = (x - grid.origin[0]) / level.resolution
  const gy = (grid.origin[1] - y) / level.resolution
  const tileX = Math.floor(gx / grid.tileSize)
  const tileY = Math.floor(gy / grid.tileSize)
  return { tileX, tileY, px: gx - tileX * grid.tileSize, py: gy - tileY * grid.tileSize }
}

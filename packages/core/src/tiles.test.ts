import { describe, expect, it } from 'vitest'
import { maxZoom, tileGrid, tilePixelAt } from './tiles.ts'

describe('tileGrid', () => {
  // The club map from the rendering spike: 394 × 433 mm at 1:15 000.
  const grid = tileGrid({ widthMm: 394, heightMm: 433, scale: 15000, origin: [1000, 5000] })

  it('has a finest level of 0.05 mm per pixel and halves per level down to one tile', () => {
    const finest = grid.levels.at(-1)
    expect(finest).toMatchObject({ mmPerPx: 0.05, widthPx: 7880, heightPx: 8660 })
    expect(finest?.resolution).toBeCloseTo(0.75, 10)
    expect(maxZoom(grid)).toBe(6)
    expect(grid.levels[0]).toMatchObject({ z: 0, mmPerPx: 3.2, widthPx: 124, heightPx: 136 })
    for (const [z, level] of grid.levels.entries()) expect(level.resolution).toBeCloseTo(0.75 * 2 ** (6 - z), 10)
  })

  it('places the extent below and right of the top-left origin', () => {
    expect(grid.extent).toEqual({ minX: 1000, minY: 5000 - 6495, maxX: 1000 + 5910, maxY: 5000 })
  })

  it('needs only one level for a map that fits in a tile', () => {
    const small = tileGrid({ widthMm: 10, heightMm: 5, scale: 4000, origin: [0, 0] })
    expect(small.levels).toHaveLength(1)
    expect(small.levels[0]).toMatchObject({ widthPx: 200, heightPx: 100 })
  })

  it('rejects an empty map', () => {
    expect(() => tileGrid({ widthMm: 0, heightMm: 5, scale: 4000, origin: [0, 0] })).toThrow(RangeError)
  })
})

describe('tilePixelAt', () => {
  const grid = tileGrid({ widthMm: 394, heightMm: 433, scale: 15000, origin: [1000, 5000] })

  it('finds tile and pixel, counting rows downwards from the top-left corner', () => {
    expect(tilePixelAt(grid, 6, 1000, 5000)).toEqual({ tileX: 0, tileY: 0, px: 0, py: 0 })
    // 300 m right and 200 m down is pixel (400, 266.67) at 0.75 m/px: tile (1, 1).
    const p = tilePixelAt(grid, 6, 1300, 4800)
    expect(p).toMatchObject({ tileX: 1, tileY: 1 })
    expect(p.px).toBeCloseTo(144, 6)
    expect(p.py).toBeCloseTo(266.6667 - 256, 3)
    // At z 0 (48 m/px) the whole map is one tile.
    expect(tilePixelAt(grid, 0, 6000, 0)).toMatchObject({ tileX: 0, tileY: 0 })
  })
})

import { tileGrid } from '@course-setter/core'
import { PDFDocument, rgb } from 'pdf-lib'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { loadOcad } from './ocad.ts'
import { loadPdf } from './pdf.ts'
import { writePmtiles } from './pmtiles.ts'
import { buildTiles, cutTile } from './pyramid.ts'
import { MapError, PT_PER_MM } from './source.ts'
import { fixture, isDark, pixelAt, readArchive } from './test-helpers.ts'

describe('cutTile', () => {
  it('pads with white and skips blank tiles', () => {
    const image = Buffer.alloc(3 * 3 * 3, 255)
    expect(cutTile(image, 3, 3, 0, 0, 4)).toBeNull()
    image[4 * 3] = 0 // pixel (1, 1)
    const tile = cutTile(image, 3, 3, 0, 0, 4)
    expect(tile?.length).toBe(4 * 4 * 3)
    expect(tile?.[(1 * 4 + 1) * 3]).toBe(0)
    expect(tile?.[(3 * 4 + 3) * 3]).toBe(255)
  })
})

describe('buildTiles on an OCAD map', () => {
  it('gives the same pixels whether a level is rendered in strips or at once', { timeout: 60_000 }, async () => {
    const map = await loadOcad(fixture('basic-1.ocd'))
    // A coarse grid keeps the test fast: 0.4 mm per pixel at the finest level.
    const grid = tileGrid({ widthMm: map.widthMm, heightMm: map.heightMm, scale: map.scale, origin: map.origin, finestMmPerPx: 0.4 })
    const finest = grid.levels.at(-1)
    if (!finest) throw new Error('no levels')
    const tiles = await buildTiles(map, grid, { stripRows: 1 })
    expect(tiles.length).toBeGreaterThan(0)

    const whole = map.render({ x: 0, y: 0, width: finest.widthPx, height: finest.heightPx }, finest.mmPerPx)
    for (const t of tiles.filter(t => t.z === finest.z)) {
      const expected = cutTile(whole, finest.widthPx, finest.heightPx, t.x * 256, t.y * 256, 256)
      const got = await sharp(t.data).removeAlpha().raw().toBuffer()
      expect(expected).not.toBeNull()
      // Palette quantisation may move a colour slightly; anti-aliased edges may differ by a little.
      let off = 0
      for (let i = 0; i < got.length; i++) if (Math.abs((got[i] as number) - (expected?.[i] as number)) > 24) off++
      expect(off / got.length).toBeLessThan(0.01)
    }
  })
})

/** A blank PDF page of `widthMm` × `heightMm` with black dots at known paper positions (mm from the bottom-left corner). */
async function pdfWithDots(widthMm: number, heightMm: number, dots: [number, number][]): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([widthMm * PT_PER_MM, heightMm * PT_PER_MM])
  for (const [x, y] of dots) page.drawCircle({ x: x * PT_PER_MM, y: y * PT_PER_MM, size: 0.6 * PT_PER_MM, color: rgb(0, 0, 0) })
  return Buffer.from(await doc.save())
}

describe('buildTiles on a PDF map', () => {
  // Paper mm from the bottom-left corner of a 200 × 150 mm page.
  const dots: [number, number][] = [
    [10, 10],
    [100, 75],
    [187.5, 140.25],
    [33.3, 120],
    [150, 5],
  ]

  it('puts known points where the map frame says they are, at every zoom level', async () => {
    const scale = 10000
    const map = loadPdf(await pdfWithDots(200, 150, dots), scale)
    expect(map.widthMm).toBeCloseTo(200, 3)
    expect(map.heightMm).toBeCloseTo(150, 3)
    expect(map.origin[0]).toBe(0)
    expect(map.origin[1]).toBeCloseTo(1500, 3)

    const grid = tileGrid({ widthMm: map.widthMm, heightMm: map.heightMm, scale, origin: map.origin, finestMmPerPx: 0.1 })
    const reader = readArchive(writePmtiles(await buildTiles(map, grid, { stripRows: 2 }), {}, 0, grid.levels.length - 1))
    const finestZ = grid.levels.length - 1
    for (const [x, y] of dots) {
      // Paper mm × scale = ground metres, frame origin at the page's bottom-left corner.
      const frame = [(x * scale) / 1000, (y * scale) / 1000] as const
      expect(isDark(await pixelAt(reader, grid, finestZ, frame[0], frame[1]))).toBe(true)
      expect(isDark(await pixelAt(reader, grid, finestZ - 1, frame[0], frame[1]))).toBe(true)
      // 3 mm away on paper is blank.
      expect(isDark(await pixelAt(reader, grid, finestZ, frame[0] + 30, frame[1]))).toBe(false)
    }
  })

  it('rejects a file that is not a PDF', () => {
    expect(() => loadPdf(Buffer.from('not a pdf'), 10000)).toThrow(MapError)
  })
})

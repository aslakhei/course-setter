// Printing courses on real map files, rendered with mupdf and measured: the course lines up with the map
// and is at scale, PDF maps stay vector, OCAD maps come out as an image of the print area.
import {
  ALL_CONTROLS,
  addControl,
  addCourse,
  courseById,
  type EventDoc,
  emptyDoc,
  groundToPage,
  insertCourseControl,
  type Point,
  printPage,
  printSettingsOf,
  setPrintSettings,
} from '@course-setter/core'
import { unzipSync } from 'fflate'
import * as mupdf from 'mupdf'
import { PDFDocument, rgb } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { loadOcad } from '../maps/ocad.ts'
import { PT_PER_MM } from '../maps/source.ts'
import { fixture } from '../maps/test-helpers.ts'
import { makeExport, ocadRegion } from './render.ts'

const PX_PER_MM = 8

/** A PDF map 300 × 200 mm with black dots at known paper positions (mm from the bottom-left corner). */
const DOTS: Point[] = [
  [100, 100],
  [200, 100],
]
async function dotMap(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([300 * PT_PER_MM, 200 * PT_PER_MM])
  for (const [x, y] of DOTS) page.drawCircle({ x: x * PT_PER_MM, y: y * PT_PER_MM, size: 0.6 * PT_PER_MM, color: rgb(0, 0, 0) })
  return Buffer.from(await doc.save())
}

/** Controls on the dots (1:10 000 map: paper mm × 10 = ground metres, 1 km apart), in course K at 1:10 000. */
function dotEvent(courses = ['K']): EventDoc {
  let doc = emptyDoc(10000)
  doc = addControl(doc, { id: 'a', kind: 'control', position: [1000, 1000] })
  doc = addControl(doc, { id: 'b', kind: 'control', position: [2000, 1000] })
  for (const id of courses) {
    doc = addCourse(doc, { id, name: `Course ${id}`, printScale: 10000 })
    doc = insertCourseControl(doc, id, 'a')
    doc = insertCourseControl(doc, id, 'b')
  }
  return doc
}

type Raster = { px: (xMm: number, yUpMm: number) => [number, number, number]; heightMm: number }
function rasterise(pdf: Uint8Array, pageIndex = 0): Raster {
  const page = mupdf.Document.openDocument(pdf, 'application/pdf').loadPage(pageIndex)
  const k = PX_PER_MM / PT_PER_MM
  const pixmap = page.toPixmap(mupdf.Matrix.scale(k, k), mupdf.ColorSpace.DeviceRGB, false)
  const data = new Uint8Array(pixmap.getPixels())
  const [width, n] = [pixmap.getWidth(), pixmap.getNumberOfComponents()]
  const heightMm = pixmap.getHeight() / PX_PER_MM
  return {
    heightMm,
    px: (xMm, yUpMm) => {
      const i = (Math.round((heightMm - yUpMm) * PX_PER_MM) * width + Math.round(xMm * PX_PER_MM)) * n
      return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0]
    },
  }
}

/** Course purple (alone or multiplied onto light map colours): red and blue well above green, unlike brown or green map colours. */
const isPurple = ([r, g, b]: [number, number, number]) => r - g > 40 && b - g > 40
const isDark = ([r, g, b]: [number, number, number]) => r + g + b < 3 * 90

/** Centroid (page mm) of the pixels matching `test` within `r` mm of (cx, cy). */
function centroid(raster: Raster, cx: number, cy: number, r: number, test: (p: [number, number, number]) => boolean): Point {
  let [sx, sy, n] = [0, 0, 0]
  for (let x = cx - r; x <= cx + r; x += 1 / PX_PER_MM)
    for (let y = cy - r; y <= cy + r; y += 1 / PX_PER_MM) {
      if (Math.hypot(x - cx, y - cy) > r || !test(raster.px(x, y))) continue
      sx += x
      sy += y
      n++
    }
  return [sx / n, sy / n]
}

describe('printing on a PDF map', () => {
  it('puts the controls on their features at scale, and keeps the map vector', async () => {
    const doc = dotEvent()
    const file = await makeExport({
      doc,
      eventName: 'Night',
      courseIds: ['K'],
      separate: false,
      map: { kind: 'pdf', scale: 10000, file: await dotMap() },
    })
    expect(file).toMatchObject({ fileName: 'Night - Course K.pdf', contentType: 'application/pdf' })
    // No images in the PDF: the map page is placed as it is.
    expect(Buffer.from(file.bytes).includes('/Subtype /Image')).toBe(false)

    const course = courseById(doc, 'K')
    const settings = printSettingsOf(doc, course, 'Night')
    const layout = printPage(doc, course, 'Night', settings)
    const raster = rasterise(file.bytes)
    expect(raster.heightMm).toBeCloseTo(layout.size[1], 0)
    // Where the controls should be on the page.
    const cx = (layout.mapArea.minX + layout.mapArea.maxX) / 2
    const cy = (layout.mapArea.minY + layout.mapArea.maxY) / 2
    const expected: Point[] = [
      [cx + (1000 - settings.center[0]) / 10, cy + (1000 - settings.center[1]) / 10],
      [cx + (2000 - settings.center[0]) / 10, cy + (1000 - settings.center[1]) / 10],
    ]
    const rings = expected.map(([x, y]) => centroid(raster, x, y, 4.3, isPurple))
    const dots = expected.map(([x, y]) => centroid(raster, x, y, 1, isDark))
    expect((rings[1]?.[0] ?? 0) - (rings[0]?.[0] ?? 0)).toBeCloseTo(100, 0)
    expect(Math.abs((rings[1]?.[0] ?? 0) - (rings[0]?.[0] ?? 0) - 100)).toBeLessThan(0.15)
    // Each control circle is centred on its dot on the map.
    for (const [i, ring] of rings.entries()) {
      const dot = dots[i] as Point
      expect(Math.hypot(ring[0] - dot[0], ring[1] - dot[1])).toBeLessThan(0.15)
    }
  })

  it('follows the course print settings: paper and orientation', async () => {
    const doc = setPrintSettings(dotEvent(), 'K', { paper: 'A3', orientation: 'landscape', center: [1500, 1000], margin: 10, layout: [] })
    const file = await makeExport({
      doc,
      eventName: 'Night',
      courseIds: ['K'],
      separate: false,
      map: { kind: 'pdf', scale: 10000, file: await dotMap() },
    })
    const page = (await PDFDocument.load(file.bytes)).getPage(0)
    expect(page.getWidth() / PT_PER_MM).toBeCloseTo(420, 1)
    expect(page.getHeight() / PT_PER_MM).toBeCloseTo(297, 1)
  })

  it('makes one PDF with a page per course, or a zip with a PDF per course', async () => {
    const doc = dotEvent(['K', 'L'])
    const map = { kind: 'pdf' as const, scale: 10000, file: await dotMap() }
    const one = await makeExport({ doc, eventName: 'Night', courseIds: ['K', 'L'], separate: false, map })
    expect(one.fileName).toBe('Night.pdf')
    expect((await PDFDocument.load(one.bytes)).getPageCount()).toBe(2)
    const zip = await makeExport({ doc, eventName: 'Night', courseIds: ['K', 'L'], separate: true, map })
    expect(zip).toMatchObject({ fileName: 'Night.zip', contentType: 'application/zip' })
    const files = unzipSync(zip.bytes)
    expect(Object.keys(files).sort()).toEqual(['Course K.pdf', 'Course L.pdf'])
    expect((await PDFDocument.load(files['Course L.pdf'] as Uint8Array)).getPageCount()).toBe(1)
  })

  it('prints the all-controls page: every control, also those in no course', async () => {
    let doc = addControl(dotEvent(), { id: 'c', kind: 'control', position: [1500, 1500] })
    const settings = { paper: 'A4' as const, orientation: 'landscape' as const, center: [1500, 1000] as Point, margin: 5, layout: [] }
    doc = setPrintSettings(doc, ALL_CONTROLS, settings)
    const file = await makeExport({
      doc,
      eventName: 'Night',
      courseIds: [ALL_CONTROLS],
      separate: false,
      map: { kind: 'pdf', scale: 10000, file: await dotMap() },
    })
    expect(file.fileName).toBe('Night - All controls.pdf')
    // At 1:10 000 on A4 landscape, the page centre (148.5, 105) mm is 1500, 1000 m on the ground.
    const raster = rasterise(file.bytes)
    for (const [x, y] of [
      [1000, 1000],
      [2000, 1000],
      [1500, 1500],
    ] as Point[]) {
      const at: Point = [148.5 + (x - 1500) / 10, 105 + (y - 1000) / 10]
      const ring = centroid(raster, at[0], at[1], 4.3, isPurple)
      expect(Math.hypot(ring[0] - at[0], ring[1] - at[1])).toBeLessThan(0.3)
    }
  })
})

describe('printing on an OCAD map', () => {
  // The fixture map is a purple hatched area, so the course cannot be told from the map by colour here;
  // the course is drawn as on a PDF map (measured above). This checks the map image is in the right place.
  it('renders the print area of the map in its place under the course', { timeout: 60_000 }, async () => {
    const source = await loadOcad(fixture('basic-1.ocd'))
    // Two controls 1 km apart around the middle of the map, printed at 1:10 000.
    const mid: Point = [
      source.origin[0] + (source.widthMm * source.scale) / 2000,
      source.origin[1] - (source.heightMm * source.scale) / 2000,
    ]
    let doc = emptyDoc(source.scale)
    doc = addControl(doc, { id: 'a', kind: 'control', position: [mid[0] - 500, mid[1]] })
    doc = addControl(doc, { id: 'b', kind: 'control', position: [mid[0] + 500, mid[1]] })
    doc = addCourse(doc, { id: 'K', name: 'K', printScale: 10000 })
    doc = insertCourseControl(doc, 'K', 'a')
    doc = insertCourseControl(doc, 'K', 'b')
    const file = await makeExport({
      doc,
      eventName: 'Night',
      courseIds: ['K'],
      separate: false,
      map: { kind: 'ocad', scale: source.scale, file: fixture('basic-1.ocd') },
    })
    expect(Buffer.from(file.bytes).includes('/Subtype /Image')).toBe(true)

    const course = courseById(doc, 'K')
    const settings = printSettingsOf(doc, course, 'Night', mid)
    const layout = printPage(doc, course, 'Night', settings)
    const raster = rasterise(file.bytes)
    const toPage = groundToPage(settings.center, layout.mapArea, 10000)

    // The same part of the map rendered here at 4 px per printed mm (less loses the hatch), averaged per
    // millimetre, against the exported page averaged over the same millimetres: how dark each one is
    // must match (away from the course line and the description sheet).
    const ref = ocadRegion(source, layout.groundArea, 10000, 4 * 25.4) as NonNullable<ReturnType<typeof ocadRegion>>
    const pixels = source.render(ref, ref.mmPerPx)
    const mPerPx = (ref.mmPerPx * source.scale) / 1000
    const darkness = (i0: number, j0: number) => {
      let sum = 0
      for (let j = j0; j < j0 + 4; j++)
        for (let i = i0; i < i0 + 4; i++) {
          const k = (j * ref.width + i) * 3
          sum += Math.min(pixels[k] ?? 255, pixels[k + 1] ?? 255, pixels[k + 2] ?? 255)
        }
      return 255 - sum / 16
    }
    const pairs: [number, number][] = []
    for (let j = 0; j + 4 <= ref.height; j += 8)
      for (let i = 0; i + 4 <= ref.width; i += 8) {
        const ground: Point = [ref.ground.topLeft[0] + (i + 2) * mPerPx, ref.ground.topLeft[1] - (j + 2) * mPerPx]
        const [x, y] = toPage(ground)
        const box = layout.descriptions?.box
        if (box && x > box.minX - 2 && x < box.maxX + 2 && y > box.minY - 2 && y < box.maxY + 2) continue
        if (Math.abs(y - toPage(mid)[1]) < 8) continue // the course
        if (x < layout.mapArea.minX + 1 || x > layout.mapArea.maxX - 1 || y < layout.mapArea.minY + 1 || y > layout.mapArea.maxY - 1)
          continue
        let sum = 0
        for (let dx = -0.4375; dx < 0.5; dx += 0.125)
          for (let dy = -0.4375; dy < 0.5; dy += 0.125) sum += Math.min(...raster.px(x + dx, y + dy))
        pairs.push([darkness(i, j), 255 - sum / 64])
      }
    expect(pairs.length).toBeGreaterThan(1000)
    expect(pairs.filter(([a]) => a > 20).length).toBeGreaterThan(200) // the hatched area is in view
    // Correlation of the darkness: the map is where it should be. Measured: 0.96 in place, 0.93 with the
    // map image moved 1 mm, 0.88 moved 3 mm.
    const mean = (k: 0 | 1) => pairs.reduce((s, p) => s + p[k], 0) / pairs.length
    const [ma, mb] = [mean(0), mean(1)]
    const cov = pairs.reduce((s, p) => s + (p[0] - ma) * (p[1] - mb), 0)
    const va = pairs.reduce((s, p) => s + (p[0] - ma) ** 2, 0)
    const vb = pairs.reduce((s, p) => s + (p[1] - mb) ** 2, 0)
    const r = cov / Math.sqrt(va * vb)
    expect(r, `correlation ${r}`).toBeGreaterThan(0.94)
  })
})

describe('ocadRegion', () => {
  const map = { origin: [1000, 5000] as Point, widthMm: 400, heightMm: 300, scale: 10000 }

  it('renders the part of the map inside the print area at 600 dpi', () => {
    // A 100 × 50 mm print area at 1:10 000 (1000 × 500 m) inside the map.
    const r = ocadRegion(map, { minX: 2000, maxX: 3000, minY: 3000, maxY: 3500 }, 10000, 600)
    expect(r?.mmPerPx).toBeCloseTo(25.4 / 600, 12)
    expect(r?.width).toBe(Math.ceil(200 / (25.4 / 600)) - Math.floor(100 / (25.4 / 600)))
    // The rendered region's corners are where the print area's are, to a pixel.
    expect(r?.ground.topLeft[0]).toBeLessThanOrEqual(2000)
    expect(2000 - (r?.ground.topLeft[0] ?? 0)).toBeLessThan(0.5)
    expect((r?.ground.topLeft[1] ?? 0) - 3500).toBeLessThan(0.5)
  })

  it('stops at the edge of the map, and returns nothing off it', () => {
    const r = ocadRegion(map, { minX: 0, maxX: 2000, minY: 4000, maxY: 6000 }, 10000, 600)
    expect(r?.x).toBe(0)
    expect(r?.y).toBe(0)
    expect(r?.ground.topLeft).toEqual([1000, 5000])
    expect(ocadRegion(map, { minX: 9000, maxX: 9500, minY: 0, maxY: 100 }, 10000, 600)).toBeNull()
  })

  it('uses fewer dpi when a page would have too many pixels', () => {
    const huge = { origin: [0, 10000] as Point, widthMm: 2000, heightMm: 2000, scale: 10000 }
    const r = ocadRegion(huge, { minX: 0, maxX: 4200, minY: 5800, maxY: 10000 }, 10000, 600)
    expect((r?.width ?? 0) * (r?.height ?? 0)).toBeLessThanOrEqual(50_500_000)
  })
})

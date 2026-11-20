// Snapshot tests for the drawing backends: every course symbol and every control description symbol is
// drawn by the Canvas backend (as in the editor, here with @napi-rs/canvas) and by the PDF backend (as
// for print, rendered with mupdf). Each image must match its stored snapshot, and the two backends must
// match each other, so the editor and the printed map cannot drift apart.
//
// Snapshots live in __snapshots__/ as PNG sheets, one cell per symbol: open them to review the drawings.
// After an intended change, regenerate them with UPDATE_SNAPSHOTS=1 pnpm test and check the new images.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas'
import fontkit from '@pdf-lib/fontkit'
import * as mupdf from 'mupdf'
import { PDFDocument, rgb } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { addSpecial, insertCourseControl, setDescription, setMarkedRoute, setSpecialBoundary, updateCourse } from '../course/commands.ts'
import { courseById, type DescriptionColumnKey, type EventDoc, SPECIALS_BY_STANDARD, type SpecialKind, STANDARDS } from '../course/doc.ts'
import { specialDrawing } from '../course/specials.ts'
import { allControlsDrawing, courseDrawing } from '../course/symbols.ts'
import { testEvent } from '../course/test-doc.ts'
import { descriptionSheet, drawDescriptionSheet } from '../descriptions/sheet.ts'
import { DESCRIPTION_SYMBOLS, drawDescriptionSymbol } from '../descriptions/symbols.ts'
import type { Point } from '../similarity.ts'
import { drawPrimitives, paperToDevice } from './canvas.ts'
import { drawPrimitivesOnPage, PT_PER_MM } from './pdf.ts'
import { type Primitive, primitivesBounds, transformPrimitives } from './primitives.ts'

const SNAPSHOTS = fileURLToPath(new URL('./__snapshots__/', import.meta.url))
const FONT_FILE = fileURLToPath(new URL('../../test/fonts/LiberationSans-Regular.ttf', import.meta.url))
const BOLD_FONT_FILE = fileURLToPath(new URL('../../test/fonts/LiberationSans-Bold.ttf', import.meta.url))
const FONT_FAMILY = 'Snapshot Sans'
/** Liberation Sans digits are 1409 of 2048 units high (Arial's are 1472). */
const DIGIT_HEIGHT = 1409 / 2048
const PX_PER_MM = 12
const PURPLE = { css: '#b5179e', pdf: rgb(0xb5 / 255, 0x17 / 255, 0x9e / 255) }
const BLACK = { css: '#000000', pdf: rgb(0, 0, 0) }
GlobalFonts.registerFromPath(FONT_FILE, FONT_FAMILY)
GlobalFonts.registerFromPath(BOLD_FONT_FILE, FONT_FAMILY)

type Cell = { name: string; primitives: Primitive[] }
/**
 * `between` is the share of drawn pixels per cell the Canvas and PDF images may differ by (default 2 %).
 * Text makes it larger: the two rasterisers place glyphs up to half a pixel (0.04 mm) apart.
 */
type Sheet = { name: string; color: typeof PURPLE; cell: Point; columns: number; cells: Cell[]; between?: number }
type Image = { width: number; height: number; data: Uint8ClampedArray | Uint8Array; channels: number }

/** The sheet's primitives, each cell's drawing centred in its grid cell, in sheet mm (y up). */
function layout(sheet: Sheet): { size: Point; primitives: Primitive[]; boxes: { name: string; at: Point }[] } {
  const rows = Math.ceil(sheet.cells.length / sheet.columns)
  const size: Point = [sheet.columns * sheet.cell[0], rows * sheet.cell[1]]
  const primitives: Primitive[] = []
  const boxes = sheet.cells.map((cell, i) => {
    const at: Point = [(i % sheet.columns) * sheet.cell[0], size[1] - (Math.floor(i / sheet.columns) + 1) * sheet.cell[1]]
    const b = primitivesBounds(cell.primitives)
    if (b) {
      const offset: Point = [at[0] + sheet.cell[0] / 2 - (b.minX + b.maxX) / 2, at[1] + sheet.cell[1] / 2 - (b.minY + b.maxY) / 2]
      primitives.push(...transformPrimitives(cell.primitives, 1, offset))
    }
    return { name: cell.name, at }
  })
  return { size, primitives, boxes }
}

function drawCanvas(size: Point, primitives: Primitive[], color: string): Image {
  const [w, h] = [Math.round(size[0] * PX_PER_MM), Math.round(size[1] * PX_PER_MM)]
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  drawPrimitives(ctx, primitives, { transform: paperToDevice(PX_PER_MM, [0, 0], h), color, font: FONT_FAMILY, digitHeight: DIGIT_HEIGHT })
  return { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data, channels: 4 }
}

async function drawPdf(size: Point, primitives: Primitive[], color: typeof PURPLE): Promise<Image> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const font = await doc.embedFont(readFileSync(FONT_FILE), { subset: true })
  const boldFont = await doc.embedFont(readFileSync(BOLD_FONT_FILE), { subset: true })
  const page = doc.addPage([size[0] * PT_PER_MM, size[1] * PT_PER_MM])
  drawPrimitivesOnPage(page, primitives, { origin: [0, 0], color: color.pdf, font, boldFont, digitHeight: DIGIT_HEIGHT })
  const pdf = mupdf.Document.openDocument(await doc.save(), 'application/pdf')
  const k = PX_PER_MM / PT_PER_MM
  const pixmap = pdf.loadPage(0).toPixmap(mupdf.Matrix.scale(k, k), mupdf.ColorSpace.DeviceRGB, false)
  // A copy: getPixels() is a view into mupdf's WebAssembly memory, which is reused once the pixmap is freed.
  const data = new Uint8Array(pixmap.getPixels())
  return { width: pixmap.getWidth(), height: pixmap.getHeight(), data, channels: pixmap.getNumberOfComponents() }
}

function toPng(image: Image): Buffer {
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  const out = ctx.createImageData(image.width, image.height)
  for (let i = 0; i < image.width * image.height; i++) {
    for (let c = 0; c < 3; c++) out.data[i * 4 + c] = image.data[i * image.channels + c] ?? 0
    out.data[i * 4 + 3] = 255
  }
  ctx.putImageData(out, 0, 0)
  return canvas.toBuffer('image/png')
}

async function fromPng(file: string): Promise<Image> {
  const img = await loadImage(readFileSync(file))
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  return { width: img.width, height: img.height, data: ctx.getImageData(0, 0, img.width, img.height).data, channels: 4 }
}

/**
 * Share of the drawn (non-white) pixels in a cell that differ noticeably. Both images are first averaged
 * over 2 × 2 pixel blocks, so the slightly different anti-aliasing of two renderers along every edge does
 * not count, but a missing, moved or resized line does, even a small one in a large drawing.
 */
function difference(a: Image, b: Image, box: { at: Point; size: Point }, sheetHeightMm: number): number {
  const x0 = Math.round(box.at[0] * PX_PER_MM)
  const y0 = Math.round((sheetHeightMm - box.at[1] - box.size[1]) * PX_PER_MM)
  const [w, h] = [Math.round(box.size[0] * PX_PER_MM), Math.round(box.size[1] * PX_PER_MM)]
  const grey = (img: Image, x: number, y: number) => {
    let sum = 0
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const i = ((y + dy) * img.width + x + dx) * img.channels
        sum += ((img.data[i] ?? 0) + (img.data[i + 1] ?? 0) + (img.data[i + 2] ?? 0)) / 3
      }
    return sum / 4
  }
  let differing = 0
  let drawn = 0
  for (let y = y0; y + 1 < y0 + h; y += 2)
    for (let x = x0; x + 1 < x0 + w; x += 2) {
      const [ga, gb] = [grey(a, x, y), grey(b, x, y)]
      if (Math.min(ga, gb) < 224) drawn++
      if (Math.abs(ga - gb) > 64) differing++
    }
  return differing / Math.max(1, drawn)
}

/** Cells whose difference exceeds `limit`, as "name (share)". */
function differingCells(a: Image, b: Image, sheet: Sheet, limit: number): string[] {
  const { size, boxes } = layout(sheet)
  return boxes
    .map(box => ({ name: box.name, share: difference(a, b, { at: box.at, size: sheet.cell }, size[1]) }))
    .filter(d => d.share > limit)
    .map(d => `${d.name} (${(d.share * 100).toFixed(1)} %)`)
}

/** Compares `image` with the stored snapshot (writing it when updating or when it does not exist yet locally). */
async function matchSnapshot(sheet: Sheet, backend: string, image: Image): Promise<string[]> {
  const file = join(SNAPSHOTS, `${sheet.name}.${backend}.png`)
  if (process.env.UPDATE_SNAPSHOTS || (!existsSync(file) && !process.env.CI)) {
    mkdirSync(SNAPSHOTS, { recursive: true })
    writeFileSync(file, toPng(image))
    return []
  }
  const stored = await fromPng(file)
  if (stored.width !== image.width || stored.height !== image.height)
    return [`size ${image.width}×${image.height}, snapshot ${stored.width}×${stored.height}`]
  const differing = differingCells(image, stored, sheet, 0.01)
  if (differing.length) {
    const actual = join(tmpdir(), `${sheet.name}.${backend}.actual.png`)
    writeFileSync(actual, toPng(image))
    differing.push(`(this run's image: ${actual})`)
  }
  return differing
}

// The sheets -------------------------------------------------------------------------------------------

/** Course A of the test event with a crossing point between control c and the finish. */
function testCourse(standard: EventDoc['standard'], printScale: number): Primitive[] {
  let doc: EventDoc = { ...testEvent(), standard }
  doc = { ...doc, controls: [...doc.controls, { id: 'x', kind: 'crossingPoint', code: null, position: [600, 0] }] }
  doc = insertCourseControl(doc, 'A', 'x', 4)
  doc = setMarkedRoute(doc, 'A', 'a', 'b', true)
  // Shrink the ground distances so the whole course (about 40 mm plus symbols) fits a 72 mm cell at any scale.
  const scaled = {
    ...doc,
    controls: doc.controls.map(c => ({
      ...c,
      position: [(0.6 * c.position[0] * printScale) / 15000, (0.6 * c.position[1] * printScale) / 15000] as Point,
    })),
  }
  const course = { ...courseById(scaled, 'A'), printScale }
  return courseDrawing({ ...scaled, courses: [course] }, course)
}

const symbolOf = (owner: string, drawing: Primitive[]) => drawing.filter(p => p.owner === owner)

const SCALES = [
  ['isom', 15000],
  ['isom', 10000],
  ['issprom', 4000],
  ['issprom', 3000],
] as const

/** Each course symbol on its own, per standard and print scale: start, control with number, crossing point, finish. */
const symbolSheet = (): Sheet => ({
  name: 'course-symbols',
  color: PURPLE,
  cell: [24, 24],
  columns: 4,
  cells: SCALES.flatMap(([standard, scale]) => {
    const course = testCourse(standard, scale)
    const label = `${standard} 1:${scale}`
    return [
      { name: `${label} start`, primitives: symbolOf('s', course) },
      { name: `${label} control and number`, primitives: symbolOf('b', course) },
      { name: `${label} crossing point`, primitives: symbolOf('x', course) },
      { name: `${label} finish`, primitives: symbolOf('f', course) },
    ]
  }),
})

/** Whole courses (course lines cut at the symbols, number placement) and the all-controls view. */
const courseSheet = (): Sheet => ({
  name: 'courses',
  color: PURPLE,
  cell: [72, 72],
  columns: 3,
  cells: [
    ...SCALES.map(([standard, scale]) => ({ name: `${standard} 1:${scale} course`, primitives: testCourse(standard, scale) })),
    {
      name: 'all controls',
      primitives: allControlsDrawing(
        {
          ...testEvent(),
          controls: testEvent().controls.map(c => ({ ...c, position: [c.position[0] * 0.6, c.position[1] * 0.6] as Point })),
        },
        15000,
      ),
    },
  ],
})

/** Every special symbol of each standard at its base scale, as a small example shape in paper mm. */
const specialSheet = (): Sheet => {
  const shapes: Record<SpecialKind, Point[]> = {
    mapIssue: [[6, 0]],
    markedRoute: [
      [0, 0],
      [8, 6],
      [16, 4],
    ],
    oobBoundary: [
      [0, 0],
      [8, 4],
      [16, 0],
    ],
    oobArea: [
      [0, 0],
      [14, 0],
      [14, 6],
      [6, 6],
      [6, 12],
      [0, 12],
    ],
    oobRoute: [
      [0, 0],
      [18, 6],
    ],
    crossingSection: [
      [0, 0],
      [6, 3],
      [12, 3],
    ],
    firstAid: [[0, 0]],
    refreshment: [[0, 0]],
    temporaryConstruction: [
      [0, 0],
      [8, 0],
      [8, 4],
      [4, 8],
      [0, 4],
    ],
  }
  const cells = STANDARDS.flatMap(standard =>
    SPECIALS_BY_STANDARD[standard].map(kind => {
      const printScale = standard === 'isom' ? 15000 : 4000
      let doc: EventDoc = { ...testEvent(), standard }
      const metres = shapes[kind].map(([x, y]): Point => [(x * printScale) / 1000, (y * printScale) / 1000])
      doc = addSpecial(doc, { id: 'x', kind, points: metres })
      const special = doc.specials[0] as EventDoc['specials'][number]
      // The map issue point turns across the way to the start (at the origin).
      return { name: `${standard} ${kind}`, primitives: specialDrawing(doc, special, printScale) }
    }),
  )
  // Out-of-bounds areas with a dashed edge and with none.
  for (const boundary of ['dashed', 'none'] as const) {
    let doc = addSpecial(testEvent(), { id: 'x', kind: 'oobArea', points: shapes.oobArea.map(([x, y]): Point => [x * 15, y * 15]) })
    doc = setSpecialBoundary(doc, 'x', boundary)
    cells.push({
      name: `isom oobArea ${boundary}`,
      primitives: specialDrawing(doc, doc.specials[0] as EventDoc['specials'][number], 15000),
    })
  }
  return { name: 'special-symbols', color: PURPLE, cell: [24, 20], columns: 4, cells }
}

const BOX = 6 // mm, a typical description cell
const drawn = DESCRIPTION_SYMBOLS.filter(s => s.shapes.length > 0)
const isLine = (column: string) => 'VWXYZ'.includes(column)

const descriptionSymbolsSheet = (): Sheet => ({
  name: 'description-symbols',
  color: BLACK,
  cell: [8, 8],
  columns: 16,
  cells: drawn.filter(s => !isLine(s.column)).map(s => ({ name: `${s.id} ${s.name}`, primitives: drawDescriptionSymbol(s, [0, 0], BOX) })),
})

const instructionSheet = (): Sheet => ({
  name: 'description-instructions',
  color: BLACK,
  cell: [52, 8],
  columns: 2,
  cells: drawn.filter(s => isLine(s.column)).map(s => ({ name: `${s.id} ${s.name}`, primitives: drawDescriptionSymbol(s, [0, 0], BOX) })),
})

/**
 * Whole description sheets: course A with a crossing point, every kind of cell (symbols in C–H, one size,
 * a size with ×, two sizes split diagonally and one above the other) and a climb, at 6 mm cells; course B
 * without a climb at 5 mm.
 */
const sheetsSheet = (): Sheet => {
  let doc = testEvent()
  doc = { ...doc, controls: [...doc.controls, { id: 'x', kind: 'crossingPoint', code: null, position: [600, 1000] }] }
  doc = insertCourseControl(doc, 'A', 'x', 3)
  const cells: [string, DescriptionColumnKey, string][] = [
    ['s', 'd', '5.2'],
    ['s', 'f', '10.2'],
    ['a', 'c', '0.1E'],
    ['a', 'd', '2.4'],
    ['a', 'f', '1.5'],
    ['a', 'g', '11.1SE'],
    ['b', 'd', '1.10'],
    ['b', 'e', '8.6'],
    ['b', 'f', '3x4'],
    ['b', 'h', '12.2'],
    ['c', 'd', '2.1'],
    ['c', 'f', '0.5/2'],
    ['c', 'g', '11.13'],
  ]
  for (const [id, column, value] of cells) doc = setDescription(doc, id, column, value)
  doc = setDescription(doc, 'b', 'f', '2|3')
  doc = updateCourse(doc, 'A', { climb: 45 })
  const sheet = (course: string, cell: number) =>
    drawDescriptionSheet(descriptionSheet(doc, courseById(doc, course), 'Club night championship'), cell)
  return {
    name: 'description-sheets',
    color: BLACK,
    cell: [56, 64],
    columns: 2,
    // Mostly text at 5 mm cells (the sheet's structure is checked by the unit tests in sheet.test.ts).
    between: 0.04,
    cells: [
      { name: 'course A, 6 mm', primitives: sheet('A', 6) },
      { name: 'course B, 5 mm', primitives: sheet('B', 5) },
    ],
  }
}

describe.each([symbolSheet, courseSheet, specialSheet, descriptionSymbolsSheet, instructionSheet, sheetsSheet])('%o', makeSheet => {
  const sheet = makeSheet()

  it('draws the same with the Canvas and the PDF backend, and both match their snapshots', { timeout: 60_000 }, async () => {
    const { size, primitives } = layout(sheet)
    const canvas = drawCanvas(size, primitives, sheet.color.css)
    const pdf = await drawPdf(size, primitives, sheet.color)
    expect(pdf.width).toBe(canvas.width)
    expect(pdf.height).toBe(canvas.height)
    const between = differingCells(canvas, pdf, sheet, sheet.between ?? 0.02)
    if (between.length) {
      for (const [backend, image] of [
        ['canvas', canvas],
        ['pdf', pdf],
      ] as const) {
        const file = join(tmpdir(), `${sheet.name}.${backend}.actual.png`)
        writeFileSync(file, toPng(image))
        between.push(`(${backend}: ${file})`)
      }
    }
    expect(between, 'Canvas and PDF differ').toEqual([])
    expect(await matchSnapshot(sheet, 'canvas', canvas), 'Canvas differs from its snapshot').toEqual([])
    expect(await matchSnapshot(sheet, 'pdf', pdf), 'PDF differs from its snapshot').toEqual([])
  })
})

describe('description symbols', () => {
  it('has a drawing for every symbol of the sheet columns, including the 2024 additions', () => {
    const names = drawn.map(s => s.name)
    expect(names).toContain('Railway')
    expect(names).toContain('Map flip')
    // Only text templates (sizes, "between", crossings of the same kind) and header items have no drawing.
    const empty = DESCRIPTION_SYMBOLS.filter(s => s.shapes.length === 0).map(s => s.column)
    expect(new Set(empty)).toEqual(new Set(['@', 'F', 'G']))
  })
})

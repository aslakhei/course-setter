// Snapshot tests for the drawing backends: every course symbol, every control description symbol and
// the page's own primitives (text in each font, coloured and translucent shapes, images) are drawn by the
// Canvas backend (as in the editor, here with @napi-rs/canvas) and by the PDF backend (as
// for print, rendered with mupdf). Each image must match its stored snapshot, and the two backends must
// match each other, so the editor and the printed map cannot drift apart.
//
// Snapshots live in __snapshots__/ as PNG sheets, one cell per symbol: open them to review the drawings.
// After an intended change, regenerate them with UPDATE_SNAPSHOTS=1 pnpm test and check the new images.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Image as CanvasImage, createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas'
import fontkit from '@pdf-lib/fontkit'
import * as mupdf from 'mupdf'
import { PDFDocument, type PDFEmbeddedPage, type PDFImage, rgb } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { addControl, addSpecial, insertCourseControl, setDescription, setSpecialBoundary, updateCourse } from '../course/commands.ts'
import { courseById, type DescriptionColumnKey, type EventDoc, SPECIALS_BY_STANDARD, type SpecialKind, STANDARDS } from '../course/doc.ts'
import { specialDrawing } from '../course/specials.ts'
import { allControlsDrawing, courseDrawing } from '../course/symbols.ts'
import { testEvent } from '../course/test-doc.ts'
import { descriptionSheet, drawDescriptionSheet } from '../descriptions/sheet.ts'
import { DESCRIPTION_SYMBOLS, drawDescriptionSymbol } from '../descriptions/symbols.ts'
import { composeLayout, whiteAreaPath } from '../print/compose.ts'
import type { PageElementSpec } from '../print/elements.ts'
import type { Point } from '../similarity.ts'
import { FONT_FEATURES, FONT_IDS, FONTS, type FontId } from '../text/fonts.ts'
import { textPrimitives } from '../text/lines.ts'
import { drawPrimitives, paperToDevice } from './canvas.ts'
import { drawPrimitivesOnPage, MissingAssetError, PT_PER_MM } from './pdf.ts'
import { type Bounds, type PathCommand, type Primitive, primitivesBounds, transformPrimitives } from './primitives.ts'

const SNAPSHOTS = fileURLToPath(new URL('./__snapshots__/', import.meta.url))
const FONT_FILE = fileURLToPath(new URL('../../fonts/LiberationSans-Regular.ttf', import.meta.url))
const BOLD_FONT_FILE = fileURLToPath(new URL('../../fonts/LiberationSans-Bold.ttf', import.meta.url))
const FONT_FAMILY = 'Snapshot Sans'
/** Liberation Sans digits are 1409 of 2048 units high (Arial's are 1472). */
const DIGIT_HEIGHT = 1409 / 2048
const PX_PER_MM = 12
const PURPLE = { css: '#b5179e', pdf: rgb(0xb5 / 255, 0x17 / 255, 0x9e / 255) }
const BLACK = { css: '#000000', pdf: rgb(0, 0, 0) }
GlobalFonts.registerFromPath(FONT_FILE, FONT_FAMILY)
GlobalFonts.registerFromPath(BOLD_FONT_FILE, FONT_FAMILY)
const fontFile = (id: FontId) => fileURLToPath(new URL(`../../fonts/${FONTS[id].file}`, import.meta.url))
for (const id of FONT_IDS) GlobalFonts.registerFromPath(fontFile(id), FONTS[id].family)

/** Images by asset id: PNG files, or one-page PDFs (drawn by the PDF backend only, as vector). */
type Assets = Record<string, { png: Buffer } | { pdf: Uint8Array }>

type Cell = { name: string; primitives: Primitive[] }
/**
 * `between` is the share of drawn pixels per cell the Canvas and PDF images may differ by (default 2 %).
 * Text makes it larger: the two rasterisers place glyphs up to half a pixel (0.04 mm) apart.
 */
type Sheet = { name: string; color: typeof PURPLE; cell: Point; columns: number; cells: Cell[]; between?: number; assets?: Assets }
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

async function drawCanvas(size: Point, primitives: Primitive[], color: string, assets: Assets = {}): Promise<Image> {
  const [w, h] = [Math.round(size[0] * PX_PER_MM), Math.round(size[1] * PX_PER_MM)]
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  const images = new Map<string, CanvasImage>()
  for (const [id, asset] of Object.entries(assets)) if ('png' in asset) images.set(id, await loadImage(asset.png))
  drawPrimitives(ctx, primitives, {
    transform: paperToDevice(PX_PER_MM, [0, 0], h),
    color,
    font: FONT_FAMILY,
    digitHeight: DIGIT_HEIGHT,
    images: id => images.get(id) ?? null,
  })
  return { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data, channels: 4 }
}

async function drawPdf(size: Point, primitives: Primitive[], color: typeof PURPLE, assets: Assets = {}): Promise<Image> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const font = await doc.embedFont(readFileSync(FONT_FILE), { subset: true })
  const boldFont = await doc.embedFont(readFileSync(BOLD_FONT_FILE), { subset: true })
  const fonts: Partial<Record<FontId, Awaited<ReturnType<typeof doc.embedFont>>>> = {}
  for (const id of FONT_IDS) fonts[id] = await doc.embedFont(readFileSync(fontFile(id)), { subset: true, features: FONT_FEATURES })
  const images = new Map<string, PDFImage | PDFEmbeddedPage>()
  for (const [id, asset] of Object.entries(assets)) {
    const embedded = 'png' in asset ? await doc.embedPng(asset.png) : (await doc.embedPdf(asset.pdf, [0]))[0]
    if (embedded) images.set(id, embedded)
  }
  const page = doc.addPage([size[0] * PT_PER_MM, size[1] * PT_PER_MM])
  drawPrimitivesOnPage(page, primitives, {
    origin: [0, 0],
    color: color.pdf,
    font,
    boldFont,
    digitHeight: DIGIT_HEIGHT,
    fonts,
    images: id => images.get(id) ?? null,
  })
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

/**
 * Course A of the test event with a map issue point before the start, a marked route from control a
 * part of the way to b, and a crossing point between control c and the finish.
 */
function testCourse(standard: EventDoc['standard'], printScale: number): Primitive[] {
  let doc: EventDoc = { ...testEvent(), standard }
  doc = addControl(doc, { id: 'x', kind: 'crossingPoint', position: [600, 0] })
  doc = addControl(doc, { id: 'm', kind: 'mapIssue', position: [-150, 250] })
  doc = addControl(doc, {
    id: 'r',
    kind: 'markedRoute',
    position: [300, 400],
    route: [
      [300, 400],
      [250, 600],
      [300, 750],
    ],
  })
  doc = insertCourseControl(doc, 'A', 'x', 4)
  doc = insertCourseControl(doc, 'A', 'm', 0)
  doc = insertCourseControl(doc, 'A', 'r', 3)
  // Shrink the ground distances so the whole course (about 40 mm plus symbols) fits a 72 mm cell at any scale.
  const shrink = (p: Point): Point => [(0.6 * p[0] * printScale) / 15000, (0.6 * p[1] * printScale) / 15000]
  const scaled = {
    ...doc,
    controls: doc.controls.map(c => ({ ...c, position: shrink(c.position), ...(c.route ? { route: c.route.map(shrink) } : {}) })),
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
      { name: `${label} map issue point`, primitives: symbolOf('m', course) },
      { name: `${label} marked route`, primitives: symbolOf('r', course) },
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
    optionalCrossing: [
      [0, 0],
      [3, 4],
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

/** A PNG `width` × `height` pixels: a blue field with an orange disc (what a club logo might be). */
function testPng(width: number, height: number, colors = { field: '#0b62a4', disc: '#f08a24' }): Buffer {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = colors.field
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = colors.disc
  ctx.beginPath()
  ctx.arc(width / 2, height / 2, Math.min(width, height) / 3, 0, 2 * Math.PI)
  ctx.fill()
  return canvas.toBuffer('image/png')
}

const square = (x: number, y: number, side: number): PathCommand[] => [
  ['M', x, y],
  ['L', x + side, y],
  ['L', x + side, y + side],
  ['L', x, y + side],
  ['Z'],
]

/**
 * Text on the printed page around the map: a line in every font of the set, a wrapped and centred
 * paragraph, text in its own colour and opacity. Line ends match to the pixel, but Skia rounds the
 * glyphs between them to whole pixels (up to 0.1 mm off), so more pixels differ than for shapes; the
 * widths both backends draw are checked exactly in text/lines.test.ts.
 */
const layoutTextSheet = (): Sheet => ({
  name: 'layout-text',
  color: BLACK,
  cell: [68, 18],
  columns: 2,
  between: 0.12,
  cells: [
    ...FONT_IDS.map(font => ({
      name: font,
      primitives: textPrimitives({ text: `${FONTS[font].typeface} – Løype A 4,2 km`, font, sizePt: 12, width: 64 }, [0, 0]),
    })),
    {
      name: 'wrapped and centred',
      primitives: textPrimitives(
        { text: 'Klubbmesterskap i nattorientering for alle klasser', font: 'serif', sizePt: 10, width: 46, align: 'center' },
        [0, 0],
      ),
    },
    {
      name: 'coloured and translucent text',
      primitives: [
        ...textPrimitives({ text: 'Hamar OK', font: 'display-bold', sizePt: 24, width: 64 }, [0, 0], { color: '#0b62a4' }),
        ...textPrimitives({ text: 'Nattløp', font: 'condensed-bold', sizePt: 24, width: 64, align: 'right' }, [0, -1], {
          color: '#f08a24',
          opacity: 0.5,
        }),
      ],
    },
  ],
})

/** Shapes in their own colours, overlapping and translucent, and an image, as the printed page draws them around the map. */
const layoutShapesSheet = (): Sheet => ({
  name: 'layout-shapes',
  color: BLACK,
  cell: [68, 18],
  columns: 2,
  assets: { logo: { png: testPng(240, 120) } },
  cells: [
    {
      name: 'translucent shapes',
      primitives: [
        { type: 'path', role: 'layout', commands: square(0, 0, 12), lineWidth: 0, filled: true, color: '#0b62a4' },
        { type: 'path', role: 'layout', commands: square(6, 3, 12), lineWidth: 0, filled: true, color: '#c8102e', opacity: 0.6 },
        { type: 'path', role: 'layout', commands: square(12, 6, 12), lineWidth: 0, filled: true, color: '#f2c200', opacity: 0.3 },
        { type: 'circle', role: 'layout', center: [40, 9], radius: 7, lineWidth: 0.8, color: '#2e7d32', opacity: 0.5 },
        {
          type: 'polyline',
          role: 'layout',
          points: [
            [30, 2],
            [50, 16],
          ],
          lineWidth: 1.5,
          closed: false,
          cap: 'round',
          color: '#7a1a6c',
        },
      ],
    },
    { name: 'image', primitives: [{ type: 'image', role: 'layout', box: { minX: 0, minY: 0, maxX: 30, maxY: 15 }, asset: 'logo' }] },
    {
      name: 'white area over a coloured field',
      primitives: [
        { type: 'path', role: 'layout', commands: square(0, 0, 18), lineWidth: 0, filled: true, color: '#0b62a4' },
        {
          type: 'path',
          role: 'layout',
          commands: whiteAreaPath(
            // A corner, two curve points and a corner, all inside the 18 mm field.
            [{ at: [3, 4] }, { at: [15, 3], in: [9, 1], out: [17, 8] }, { at: [14, 15] }, { at: [4, 13], in: [8, 16], out: [2, 9] }],
            p => p,
          ),
          lineWidth: 0,
          filled: true,
          color: '#ffffff',
        },
      ],
    },
  ],
})

/** Every kind of print layout element, composed for course A of the test event (1:10 000) and drawn one per cell. */
const layoutElementsSheet = (): Sheet => {
  const common = { anchor: 'tl' as const, offset: [5, 5] as Point }
  const elements: PageElementSpec[] = [
    {
      ...common,
      id: 'title',
      kind: 'text',
      size: [56, 1],
      text: '{event}\n{course} · {length} · {scale}',
      font: 'display-bold',
      sizePt: 14,
      color: '#0b62a4',
    },
    {
      ...common,
      id: 'note',
      kind: 'text',
      size: [56, 1],
      text: 'Contour {contour} · {map} ({mapYear})',
      font: 'condensed',
      sizePt: 10,
      align: 'center',
      color: '#000000',
      backing: { padding: 1.5 },
    },
    {
      ...common,
      id: 'frame',
      kind: 'shape',
      size: [50, 16],
      shape: 'rect',
      radius: 3,
      stroke: { color: '#7a1a6c', width: 0.6 },
      fill: { color: '#7a1a6c', opacity: 0.15 },
    },
    { ...common, id: 'oval', kind: 'shape', size: [40, 16], shape: 'ellipse', fill: { color: '#f08a24', opacity: 1 } },
    { ...common, id: 'rule', kind: 'shape', size: [50, 2], shape: 'line', stroke: { color: '#000000', width: 0.5 } },
    { ...common, id: 'arrow', kind: 'northArrow', size: [8, 16], style: 'arrow', color: '#000000' },
    { ...common, id: 'needle', kind: 'northArrow', size: [8, 16], style: 'needle', color: '#000000' },
    { ...common, id: 'bar', kind: 'scaleBar', size: [50, 8], color: '#000000' },
    { ...common, id: 'qr', kind: 'qr', size: [18, 18], url: 'https://www.livelox.com/', color: '#000000' },
    { ...common, id: 'logo', kind: 'image', size: [30, 15], asset: 'logo' },
  ]
  let doc = testEvent()
  doc = updateCourse(doc, 'A', { printScale: 10000 })
  doc = { ...doc, printLayout: { elements } }
  const course = courseById(doc, 'A')
  const settings = { paper: 'A4' as const, orientation: 'portrait' as const, center: [0, 0] as Point, margin: 5, layout: [] }
  const context = { map: { name: 'Skogen', contour: 5, year: 2024 } }
  const placed = composeLayout(doc, course, 'Club night', settings, [210, 297], context).elements
  return {
    name: 'layout-elements',
    color: BLACK,
    cell: [64, 24],
    columns: 2,
    between: 0.12, // text, see layoutTextSheet
    assets: { logo: { png: testPng(240, 120) } },
    cells: placed.map(e => ({ name: e.id, primitives: e.primitives })),
  }
}

describe.each([
  layoutElementsSheet,
  symbolSheet,
  courseSheet,
  specialSheet,
  descriptionSymbolsSheet,
  instructionSheet,
  sheetsSheet,
  layoutTextSheet,
  layoutShapesSheet,
])('%o', makeSheet => {
  const sheet = makeSheet()

  it('draws the same with the Canvas and the PDF backend, and both match their snapshots', { timeout: 60_000 }, async () => {
    const { size, primitives } = layout(sheet)
    const canvas = await drawCanvas(size, primitives, sheet.color.css, sheet.assets)
    const pdf = await drawPdf(size, primitives, sheet.color, sheet.assets)
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

describe('images', () => {
  const page: Point = [50, 30]
  const box: Bounds = { minX: 5.3, minY: 4.7, maxX: 45.3, maxY: 24.7 }
  const red = { png: testPng(400, 200, { field: '#ff0000', disc: '#ff0000' }) }

  /** The box (mm, y up) the red pixels of an image cover, from pixels at least half red. */
  function redBox(image: Image): Bounds {
    let [minX, minY, maxX, maxY] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, -1, -1]
    for (let y = 0; y < image.height; y++)
      for (let x = 0; x < image.width; x++) {
        const i = (y * image.width + x) * image.channels
        if ((image.data[i] ?? 0) - (image.data[i + 1] ?? 0) > 127) {
          minX = Math.min(minX, x)
          maxX = Math.max(maxX, x)
          minY = Math.min(minY, y)
          maxY = Math.max(maxY, y)
        }
      }
    const h = image.height / PX_PER_MM
    return { minX: minX / PX_PER_MM, maxX: (maxX + 1) / PX_PER_MM, minY: h - (maxY + 1) / PX_PER_MM, maxY: h - minY / PX_PER_MM }
  }

  const expectBox = (actual: Bounds) => {
    for (const k of ['minX', 'minY', 'maxX', 'maxY'] as const) expect(Math.abs(actual[k] - box[k]), k).toBeLessThanOrEqual(0.2)
  }
  const image = (asset: string): Primitive[] => [{ type: 'image', role: 'layout', box, asset }]

  it('prints a PNG at the size of its box (±0.2 mm) with both backends', async () => {
    expectBox(redBox(await drawCanvas(page, image('red'), '#000', { red })))
    expectBox(redBox(await drawPdf(page, image('red'), BLACK, { red })))
  })

  it('places a PDF page, as vector, at the size of its box (±0.2 mm)', async () => {
    const logo = await PDFDocument.create()
    logo.addPage([100, 50]).drawRectangle({ x: 0, y: 0, width: 100, height: 50, color: rgb(1, 0, 0) })
    expectBox(redBox(await drawPdf(page, image('vector'), BLACK, { vector: { pdf: await logo.save() } })))
  })

  it('draws a placeholder on the canvas while an image is missing, and refuses to make a PDF without it', async () => {
    const drawn = await drawCanvas(page, image('nothing'), '#000')
    const grey = (y: number, x: number) => drawn.data[(y * drawn.width + x) * drawn.channels]
    const [cx, cy] = [Math.round(10 * PX_PER_MM), Math.round((page[1] - 8) * PX_PER_MM)]
    expect(grey(cy, cx)).toBeLessThan(255)
    await expect(drawPdf(page, image('nothing'), BLACK)).rejects.toThrow(MissingAssetError)
  })
})

// Making the PDF of some courses: every course's page laid out by @course-setter/core, with the map
// underneath from the original file. PDF maps are placed as their original page (vector, nothing is
// rasterised); OCAD maps are rendered for the print area only, at 600 dpi as a palette PNG.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  type Bounds,
  courseById,
  type EventDoc,
  FONT_FEATURES,
  FONTS,
  type FontId,
  fontsOnPage,
  type PageContext,
  pagePosition,
  printPage,
  printSettingsOf,
  safeFileName,
} from '@course-setter/core'
import { addPrintPage, FONT_DIGIT_HEIGHT, type MapLayer } from '@course-setter/core/pdf'
import fontkit from '@pdf-lib/fontkit'
import { zipSync } from 'fflate'
import { type PDFDocument as Doc, PDFDocument, type PDFEmbeddedPage, type PDFFont, type PDFImage } from 'pdf-lib'
import sharp from 'sharp'
import { type AssetFile, embedAsset } from '../assets/image.ts'
import { loadOcad } from '../maps/ocad.ts'
import { loadPdf } from '../maps/pdf.ts'
import type { MapSource } from '../maps/source.ts'

/**
 * Liberation Sans (Arial-metric, OFL; see THIRD-PARTY-NOTICES.md), kept in packages/core/fonts. The
 * worker image keeps the workspace layout, so the path is the same there.
 */
const fontFile = (file: string) => fileURLToPath(new URL(`../../../../packages/core/fonts/${file}`, import.meta.url))
const FONT_FILES = { regular: fontFile('LiberationSans-Regular.ttf'), bold: fontFile('LiberationSans-Bold.ttf') }

/** Print resolution for OCAD maps. */
export const PRINT_DPI = 600
/** At most this many pixels per page (an A3 page at 600 dpi has 70 million): larger pages get fewer dpi. */
const MAX_PIXELS = 50_000_000
/** Rows rendered at a time, so a whole page is never in the renderer's memory at once. */
const STRIP_ROWS = 1024

export type ExportInput = {
  doc: EventDoc
  eventName: string
  /** Date, club, setter and map details for the print layout's fields. */
  context?: PageContext
  courseIds: string[]
  /** The images the layout may show, by asset id (an image element whose asset is not here fails the export). */
  assets?: Map<string, AssetFile>
  /** One PDF per course in a zip, instead of one PDF with a page per course. */
  separate: boolean
  map: { kind: 'ocad' | 'pdf'; scale: number; file: Buffer }
}

export type ExportFile = { fileName: string; contentType: string; bytes: Uint8Array }

/** The map, ready to be placed on pages (OCAD: rendered per page; PDF: its page placed as it is). */
type MapFile = { kind: 'pdf' | 'ocad'; scale: number; file: Buffer; source: MapSource }

export async function makeExport(input: ExportInput): Promise<ExportFile> {
  const { kind, scale, file } = input.map
  const map: MapFile = { kind, scale, file, source: kind === 'ocad' ? await loadOcad(file) : loadPdf(file, scale) }
  const courses = input.courseIds.map(id => courseById(input.doc, id))

  if (!input.separate || courses.length === 1) {
    const pdf = await newPdf()
    for (const course of courses) await addCourse(pdf, input, map, course.id)
    const name = courses.length === 1 ? `${input.eventName} - ${courses[0]?.name}` : input.eventName
    return { fileName: `${safeFileName(name)}.pdf`, contentType: 'application/pdf', bytes: await pdf.save() }
  }
  const files: Record<string, Uint8Array> = {}
  for (const course of courses) {
    const pdf = await newPdf()
    await addCourse(pdf, input, map, course.id)
    let name = `${safeFileName(course.name)}.pdf`
    for (let n = 2; files[name]; n++) name = `${safeFileName(course.name)} (${n}).pdf`
    files[name] = await pdf.save()
  }
  // PDFs are compressed already: store them.
  return { fileName: `${safeFileName(input.eventName)}.zip`, contentType: 'application/zip', bytes: zipSync(files, { level: 0 }) }
}

async function newPdf(): Promise<Doc> {
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  return pdf
}

type Fonts = { regular: PDFFont; bold: PDFFont; digitHeight: number; layout: Partial<Record<FontId, PDFFont>> }
const fontCache = new WeakMap<Doc, Fonts>()
/** The fonts for control numbers and descriptions, and the layout fonts `ids`, each embedded once per PDF. */
async function embedFonts(pdf: Doc, ids: FontId[]): Promise<Fonts> {
  const fonts = fontCache.get(pdf) ?? {
    regular: await pdf.embedFont(readFileSync(FONT_FILES.regular), { subset: true }),
    bold: await pdf.embedFont(readFileSync(FONT_FILES.bold), { subset: true }),
    digitHeight: FONT_DIGIT_HEIGHT,
    layout: {},
  }
  for (const id of ids)
    fonts.layout[id] ??= await pdf.embedFont(readFileSync(fontFile(FONTS[id].file)), { subset: true, features: FONT_FEATURES })
  fontCache.set(pdf, fonts)
  return fonts
}

async function addCourse(pdf: Doc, input: ExportInput, map: MapFile, courseId: string): Promise<void> {
  const course = courseById(input.doc, courseId)
  const settings = printSettingsOf(input.doc, course, input.eventName, mapCentre(map))
  const page = printPage(input.doc, course, input.eventName, settings, input.context)
  const toPage = (p: [number, number]) => pagePosition(course, settings, p)
  const fonts = await embedFonts(pdf, fontsOnPage(page))
  const images = await embedImages(pdf, page, input.assets ?? new Map())
  addPrintPage(pdf, page, await mapLayer(pdf, map, page.groundArea, toPage, course.printScale), fonts, id => images.get(id)?.image ?? null)
}

type Embedded = { image: PDFImage | PDFEmbeddedPage; widthMm: number }
const imageCache = new WeakMap<Doc, Map<string, Embedded>>()

/**
 * The images a page's layout shows, embedded once per PDF; an SVG again when a page prints it wider
 * than before (it is rendered for the width it is printed at). Assets not given stay out: drawing them
 * fails the export with MissingAssetError.
 */
async function embedImages(pdf: Doc, page: ReturnType<typeof printPage>, assets: Map<string, AssetFile>): Promise<Map<string, Embedded>> {
  const cache = imageCache.get(pdf) ?? new Map<string, Embedded>()
  imageCache.set(pdf, cache)
  const widths = new Map<string, number>()
  for (const e of page.elements)
    for (const p of e.primitives) if (p.type === 'image') widths.set(p.asset, Math.max(widths.get(p.asset) ?? 0, p.box.maxX - p.box.minX))
  for (const [id, widthMm] of widths) {
    const asset = assets.get(id)
    const have = cache.get(id)
    if (!asset || (have && (asset.kind !== 'svg' || have.widthMm >= widthMm))) continue
    cache.set(id, { image: await embedAsset(pdf, asset, widthMm), widthMm })
  }
  return cache
}

/** The middle of the map, for a course with nothing on it yet. */
function mapCentre(map: MapFile): [number, number] {
  const s = map.source
  return [s.origin[0] + (s.widthMm * s.scale) / 2000, s.origin[1] - (s.heightMm * s.scale) / 2000]
}

const embeddedMaps = new WeakMap<Doc, PDFEmbeddedPage>()

async function mapLayer(
  pdf: Doc,
  map: MapFile,
  ground: Bounds,
  toPage: (p: [number, number]) => [number, number],
  printScale: number,
): Promise<MapLayer | null> {
  if (map.kind === 'pdf') {
    // The PDF map's frame has its origin at the page's bottom-left corner: place that corner, at scale.
    // Embedded once per PDF, however many courses it has.
    const embedded = embeddedMaps.get(pdf) ?? (await pdf.embedPdf(map.file, [0]))[0]
    if (!embedded) return null
    embeddedMaps.set(pdf, embedded)
    return { kind: 'page', page: embedded, at: toPage([0, 0]), scale: map.scale / printScale }
  }
  const region = ocadRegion(map.source, ground, printScale, PRINT_DPI)
  if (!region) return null // the print area is off the map
  const pixels = Buffer.allocUnsafe(region.width * region.height * 3)
  for (let y = 0; y < region.height; y += STRIP_ROWS) {
    const rows = Math.min(STRIP_ROWS, region.height - y)
    const strip = map.source.render({ x: region.x, y: region.y + y, width: region.width, height: rows }, region.mmPerPx)
    strip.copy(pixels, y * region.width * 3)
  }
  const png = await sharp(pixels, { raw: { width: region.width, height: region.height, channels: 3 } })
    .png({ palette: true, colours: 256, effort: 4 })
    .toBuffer()
  const image = await pdf.embedPng(png)
  const [x0, y1] = toPage(region.ground.topLeft)
  const [x1, y0] = toPage(region.ground.bottomRight)
  return { kind: 'image', image, at: { minX: x0, minY: y0, maxX: x1, maxY: y1 } }
}

export type OcadRegion = {
  x: number
  y: number
  width: number
  height: number
  /** Map paper mm per pixel. */
  mmPerPx: number
  /** The region's corners in ground metres, after rounding to whole pixels. */
  ground: { topLeft: [number, number]; bottomRight: [number, number] }
}

/**
 * The pixels of an OCAD map to render for a print area (ground metres): the part of the map inside it,
 * at `dpi` on the printed page (fewer when the page would get too many pixels). Null when they do not
 * overlap.
 */
export function ocadRegion(
  source: Pick<MapSource, 'origin' | 'widthMm' | 'heightMm' | 'scale'>,
  ground: Bounds,
  printScale: number,
  dpi: number,
): OcadRegion | null {
  const mmPerGround = 1000 / source.scale // map paper mm per ground metre
  // Paper mm on the map from its top-left corner, x right, y down.
  const left = Math.max(0, (ground.minX - source.origin[0]) * mmPerGround)
  const right = Math.min(source.widthMm, (ground.maxX - source.origin[0]) * mmPerGround)
  const top = Math.max(0, (source.origin[1] - ground.maxY) * mmPerGround)
  const bottom = Math.min(source.heightMm, (source.origin[1] - ground.minY) * mmPerGround)
  if (right <= left || bottom <= top) return null
  // One printed pixel at `dpi`, in map paper mm.
  let mmPerPx = (25.4 / dpi) * (printScale / source.scale)
  const pixels = ((right - left) / mmPerPx) * ((bottom - top) / mmPerPx)
  if (pixels > MAX_PIXELS) mmPerPx *= Math.sqrt(pixels / MAX_PIXELS)
  const x = Math.floor(left / mmPerPx)
  const y = Math.floor(top / mmPerPx)
  const width = Math.ceil(right / mmPerPx) - x
  const height = Math.ceil(bottom / mmPerPx) - y
  const toGround = (px: number, py: number): [number, number] => [
    source.origin[0] + (px * mmPerPx) / mmPerGround,
    source.origin[1] - (py * mmPerPx) / mmPerGround,
  ]
  return { x, y, width, height, mmPerPx, ground: { topLeft: toGround(x, y), bottomRight: toGround(x + width, y + height) } }
}

// The printed page of a course: paper, the map area on it (the page less a white margin), which part of
// the map it shows, and everything drawn on the page in page millimetres (y up, origin at the page's
// bottom-left corner, as in PDF). The worker draws the map into the map area and these primitives on
// top; the print view shows the same layout, so what the setter sees is what is printed.
import {
  type Course,
  DEFAULT_CELL_SIZE,
  type EventDoc,
  type LayoutElement,
  type Orientation,
  PAPERS,
  type Paper,
  type Point,
  type PrintSettings,
} from '../course/doc.ts'
import { specialsDrawing } from '../course/specials.ts'
import { courseDrawing } from '../course/symbols.ts'
import { descriptionSheet, drawDescriptionSheet, SHEET } from '../descriptions/sheet.ts'
import { type Bounds, type Primitive, pathPoints, primitivesBounds, transformPrimitives } from '../render/primitives.ts'
import type { Extent } from '../tiles.ts'

export const DEFAULT_MARGIN = 5
const DEFAULT_PAPER: Paper = 'A4'

/** Page width and height in mm. */
export function pageSize(paper: Paper, orientation: Orientation): Point {
  const [w, h] = PAPERS[paper]
  return orientation === 'portrait' ? [w, h] : [h, w]
}

export type PrintPage = {
  /** Page width and height, mm. */
  size: Point
  /** Where the map is drawn on the page, mm (y up). */
  mapArea: Bounds
  /** The part of the map the map area shows, ground metres in the map frame. */
  groundArea: Extent
  printScale: number
  /** Course and special symbols, page mm; to be drawn in purple with Multiply, clipped to the map area. */
  course: Primitive[]
  /** The description sheet, page mm, drawn in black on a white box; null when the course prints none. */
  descriptions: { box: Bounds; primitives: Primitive[] } | null
}

/** Ground metres -> page mm for a page showing `center` in the middle of `mapArea`. */
export function groundToPage(center: Point, mapArea: Bounds, printScale: number): (p: Point) => Point {
  const [cx, cy] = [(mapArea.minX + mapArea.maxX) / 2, (mapArea.minY + mapArea.maxY) / 2]
  return ([x, y]) => [cx + ((x - center[0]) * 1000) / printScale, cy + ((y - center[1]) * 1000) / printScale]
}

/** The map area of a page: the page less the margin on every side. */
export function mapAreaOf(size: Point, margin: number): Bounds {
  return { minX: margin, minY: margin, maxX: size[0] - margin, maxY: size[1] - margin }
}

/** The description sheet's rows, its size in mm and its primitives with the top-left corner at (0, 0). */
function sheetOf(doc: EventDoc, course: Course, title: string) {
  const cell = course.descriptionCellSize ?? DEFAULT_CELL_SIZE
  const lines = descriptionSheet(doc, course, title)
  // The outer thick line reaches half its width beyond the cells.
  const pad = (SHEET.thickLine * cell) / 2
  return { primitives: drawDescriptionSheet(lines, cell), width: SHEET.columns * cell, height: lines.length * cell, pad }
}

/** How much of the course lies in a box (page mm): points of its primitives inside it. */
function covered(primitives: Primitive[], box: Bounds): number {
  let n = 0
  for (const p of primitives) {
    const points = p.type === 'circle' ? [p.center] : p.type === 'text' ? [p.at] : p.type === 'polyline' ? p.points : pathPoints(p.commands)
    for (const [x, y] of points) if (x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY) n++
  }
  return n
}

/**
 * Print settings for a course that has none: A4, the map area centred on the course (on `fallback` for
 * an empty course), portrait or landscape after the course's shape, and the description sheet in the
 * corner of the map area where it covers the least of the course.
 */
export function defaultPrintSettings(doc: EventDoc, course: Course, title: string, fallback: Point = [0, 0]): PrintSettings {
  const drawing = [...courseDrawing(doc, course), ...specialsDrawing(doc, course.id, course.printScale)]
  const b = primitivesBounds(drawing)
  const mm = (v: number) => (v * course.printScale) / 1000
  const center: Point = b ? [mm((b.minX + b.maxX) / 2), mm((b.minY + b.maxY) / 2)] : fallback
  const orientation: Orientation = b && b.maxX - b.minX > b.maxY - b.minY ? 'landscape' : 'portrait'
  const settings: PrintSettings = { paper: DEFAULT_PAPER, orientation, center, margin: DEFAULT_MARGIN, layout: [] }
  return { ...settings, layout: [{ kind: 'descriptions', at: bestCorner(doc, course, title, settings) }] }
}

/** The top-left corner (page mm, y down) of the corner of the map area that hides the least of the course. */
function bestCorner(doc: EventDoc, course: Course, title: string, settings: PrintSettings): Point {
  const size = pageSize(settings.paper, settings.orientation)
  const area = mapAreaOf(size, settings.margin)
  const sheet = sheetOf(doc, course, title)
  const toPage = groundToPage(settings.center, area, course.printScale)
  const offset = toPage([0, 0])
  const onPage = transformPrimitives([...courseDrawing(doc, course), ...specialsDrawing(doc, course.id, course.printScale)], 1, offset)
  const [w, h] = [sheet.width + 2 * sheet.pad, sheet.height + 2 * sheet.pad]
  const corners: Point[] = [
    [area.minX, area.maxY], // top left (y up: the top of the box)
    [area.maxX - w, area.maxY],
    [area.minX, area.minY + h],
    [area.maxX - w, area.minY + h],
  ]
  let best = corners[0] as Point
  let least = Number.POSITIVE_INFINITY
  for (const [x, top] of corners) {
    const n = covered(onPage, { minX: x, maxX: x + w, minY: top - h, maxY: top })
    if (n < least) {
      least = n
      best = [x, top]
    }
  }
  // Stored y down from the page's top edge, at the sheet's own corner (inside its outer line).
  return [best[0] + sheet.pad, size[1] - best[1] + sheet.pad]
}

/** The settings a course prints with: its own, or the defaults. */
export function printSettingsOf(doc: EventDoc, course: Course, title: string, fallback?: Point): PrintSettings {
  return course.print ?? defaultPrintSettings(doc, course, title, fallback)
}

/** The printed page of a course, `title` (the event's name) heading its description sheet. */
export function printPage(
  doc: EventDoc,
  course: Course,
  title: string,
  settings: PrintSettings = printSettingsOf(doc, course, title),
): PrintPage {
  const size = pageSize(settings.paper, settings.orientation)
  const mapArea = mapAreaOf(size, settings.margin)
  const toPage = groundToPage(settings.center, mapArea, course.printScale)
  const ground = (v: number) => (v * course.printScale) / 1000
  const halfW = ground((mapArea.maxX - mapArea.minX) / 2)
  const halfH = ground((mapArea.maxY - mapArea.minY) / 2)
  const groundArea: Extent = {
    minX: settings.center[0] - halfW,
    maxX: settings.center[0] + halfW,
    minY: settings.center[1] - halfH,
    maxY: settings.center[1] + halfH,
  }
  // Course symbols are in paper mm from the map frame's origin at the print scale: shift them so the
  // frame's origin lands where toPage puts it.
  const origin = toPage([0, 0])
  const drawing = [...specialsDrawing(doc, course.id, course.printScale), ...courseDrawing(doc, course)]
  const onPage = transformPrimitives(drawing, 1, origin)
  return {
    size,
    mapArea,
    groundArea,
    printScale: course.printScale,
    course: onPage,
    descriptions: descriptionsOn(doc, course, title, settings.layout, size),
  }
}

function descriptionsOn(doc: EventDoc, course: Course, title: string, layout: LayoutElement[], size: Point): PrintPage['descriptions'] {
  const element = layout.find(e => e.kind === 'descriptions')
  if (!element) return null
  const sheet = sheetOf(doc, course, title)
  const [x, yDown] = element.at
  const top = size[1] - yDown
  return {
    box: { minX: x - sheet.pad, maxX: x + sheet.width + sheet.pad, minY: top - sheet.height - sheet.pad, maxY: top + sheet.pad },
    primitives: transformPrimitives(sheet.primitives, 1, [x, top]),
  }
}

/** Where a ground point is printed: page mm (y up) for a course with these settings. */
export function pagePosition(course: Course, settings: PrintSettings, p: Point): Point {
  const size = pageSize(settings.paper, settings.orientation)
  return groundToPage(settings.center, mapAreaOf(size, settings.margin), course.printScale)(p)
}

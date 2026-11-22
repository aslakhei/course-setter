// The printed page of a course: paper, the map area on it (the page less a white margin), which part of
// the map it shows, and everything drawn on the page in page millimetres (y up, origin at the page's
// bottom-left corner, as in PDF). The worker draws the map into the map area and these primitives on
// top; the print view shows the same layout, so what the setter sees is what is printed.
import { type CourseChange, setPrintSettings, updateCourse } from '../course/commands.ts'
import {
  type Course,
  courseById,
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
    const points: Point[] =
      p.type === 'circle'
        ? [p.center]
        : p.type === 'text' || p.type === 'textLine'
          ? [p.at]
          : p.type === 'polyline'
            ? p.points
            : p.type === 'image'
              ? [
                  [p.box.minX, p.box.minY],
                  [p.box.maxX, p.box.maxY],
                ]
              : pathPoints(p.commands)
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

/** The whole sheet of paper (map area and margin) in ground metres: the frame the print view shows. */
export function pageGroundArea(course: Course, settings: PrintSettings): Extent {
  const [w, h] = pageSize(settings.paper, settings.orientation)
  const half = (mm: number) => (mm * course.printScale) / 2000
  const [x, y] = settings.center
  return { minX: x - half(w), maxX: x + half(w), minY: y - half(h), maxY: y + half(h) }
}

/**
 * What to add to page mm (y up) to get paper mm in the map frame at the course's print scale, the
 * coordinates course symbols are drawn in: the print view draws the page's primitives on the map with it.
 */
export function pageToPaperOffset(course: Course, settings: PrintSettings): Point {
  const [x, y] = pagePosition(course, settings, [0, 0])
  return [-x, -y]
}

/** Where the description sheet's top-left corner (page mm, y down) may go: the sheet stays in the map area. */
function sheetRange(doc: EventDoc, course: Course, title: string, settings: PrintSettings) {
  const [, height] = pageSize(settings.paper, settings.orientation)
  const area = mapAreaOf(pageSize(settings.paper, settings.orientation), settings.margin)
  const sheet = sheetOf(doc, course, title)
  const x = { min: area.minX + sheet.pad, max: area.maxX - sheet.pad - sheet.width }
  const y = { min: height - area.maxY + sheet.pad, max: height - area.minY - sheet.pad - sheet.height }
  return { x, y }
}

const clampTo = (v: number, r: { min: number; max: number }) => Math.max(r.min, Math.min(Math.max(r.min, r.max), v))

/**
 * The settings with the description sheet's top-left corner at `at` (page mm, y down), kept inside the
 * map area (at its top-left when it is bigger than the map area).
 */
export function placeDescriptions(doc: EventDoc, course: Course, title: string, settings: PrintSettings, at: Point): PrintSettings {
  const range = sheetRange(doc, course, title, settings)
  const placed: LayoutElement = { kind: 'descriptions', at: [clampTo(at[0], range.x), clampTo(at[1], range.y)] }
  const others = settings.layout.filter(e => e.kind !== 'descriptions')
  return { ...settings, layout: [...others, placed] }
}

/** The settings with the description sheet on the page (in the corner that hides the least of the course) or off it. */
export function showDescriptions(doc: EventDoc, course: Course, title: string, settings: PrintSettings, show: boolean): PrintSettings {
  const others = settings.layout.filter(e => e.kind !== 'descriptions')
  if (!show) return { ...settings, layout: others }
  if (others.length < settings.layout.length) return settings
  return { ...settings, layout: [...others, { kind: 'descriptions', at: bestCorner(doc, course, title, settings) }] }
}

/**
 * The settings with the description sheet moved from where it is on one page to the same place on
 * another (other paper, or a sheet of another size): it keeps its distance from the nearest side and
 * the nearest top or bottom of the map area, so a sheet in a corner stays in that corner.
 */
function keepSheetPlace(
  doc: EventDoc,
  title: string,
  from: { course: Course; settings: PrintSettings },
  to: { course: Course; settings: PrintSettings },
): PrintSettings {
  const element = from.settings.layout.find(e => e.kind === 'descriptions')
  if (!element) return to.settings
  const a = sheetRange(doc, from.course, title, from.settings)
  const b = sheetRange(doc, to.course, title, to.settings)
  const keep = (v: number, a: { min: number; max: number }, b: { min: number; max: number }) =>
    v - a.min <= a.max - v ? b.min + (v - a.min) : b.max - (a.max - v)
  return placeDescriptions(doc, to.course, title, to.settings, [keep(element.at[0], a.x, b.x), keep(element.at[1], a.y, b.y)])
}

/** The settings on other paper or the other way round: the page keeps its centre, the description sheet its corner. */
export function changePaper(
  doc: EventDoc,
  course: Course,
  title: string,
  settings: PrintSettings,
  paper: Paper,
  orientation: Orientation,
): PrintSettings {
  return keepSheetPlace(doc, title, { course, settings }, { course, settings: { ...settings, paper, orientation } })
}

/**
 * The event with a course printed at another scale or with another description cell size. A course
 * placed by hand keeps its page centre, and its description sheet stays in its corner.
 */
export function changePrintSize(
  doc: EventDoc,
  courseId: string,
  title: string,
  change: Pick<CourseChange, 'printScale' | 'descriptionCellSize'>,
): EventDoc {
  const next = updateCourse(doc, courseId, change)
  const before = courseById(doc, courseId)
  if (!before.print) return next
  const after = courseById(next, courseId)
  const settings = keepSheetPlace(next, title, { course: before, settings: before.print }, { course: after, settings: before.print })
  return setPrintSettings(next, courseId, settings)
}

// The print view's geometry: what a press on the map grabs (the description sheet or the page), what a
// drag does to the print settings, and where page millimetres are on the map.
import {
  type Bounds,
  type Course,
  type EventDoc,
  type Orientation,
  type Paper,
  type Point,
  type PrintPage,
  type PrintSettings,
  pagePosition,
  pageToPaperOffset,
  placeDescriptions,
} from '@course-setter/core'
import type { TFunction } from 'i18next'

/** Print scales to choose from (a course on another scale keeps it as a choice). */
export const PRINT_SCALES = [4000, 5000, 7500, 10000, 15000] as const
/** Description sheet cell sizes in mm (IOF: 5 to 7). */
export const CELL_SIZES = [5, 5.5, 6, 6.5, 7] as const

/** "A4 landscape" */
export const formatPaper = (paper: Paper, orientation: Orientation, t: TFunction) => t(`print.paperName.${orientation}`, { paper })

export type Grab = 'sheet' | 'page'

/** What a press at a ground point grabs: the description sheet on top, else the page, else nothing (the map pans). */
export function grabAt(page: PrintPage, course: Course, settings: PrintSettings, point: Point): Grab | null {
  const [x, y] = pagePosition(course, settings, point)
  const inside = (b: Bounds) => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY
  if (page.descriptions && inside(page.descriptions.box)) return 'sheet'
  return inside({ minX: 0, minY: 0, maxX: page.size[0], maxY: page.size[1] }) ? 'page' : null
}

/**
 * The settings after dragging by `delta` ground metres: the page shows what is under it after the move;
 * the description sheet moves on the page, kept inside the map area.
 */
export function dragged(doc: EventDoc, course: Course, title: string, settings: PrintSettings, grab: Grab, delta: Point): PrintSettings {
  if (grab === 'page') return { ...settings, center: [settings.center[0] + delta[0], settings.center[1] + delta[1]] }
  const element = settings.layout.find(e => e.kind === 'descriptions')
  if (!element) return settings
  const mm = 1000 / course.printScale
  // Page positions are stored y down; ground y is up.
  return placeDescriptions(doc, course, title, settings, [element.at[0] + delta[0] * mm, element.at[1] - delta[1] * mm])
}

/** A box on the page (page mm) as a ring of ground points, to outline it on the map. */
export function groundRing(course: Course, settings: PrintSettings, box: Bounds): Point[] {
  const [dx, dy] = pageToPaperOffset(course, settings)
  const m = course.printScale / 1000
  const g = (x: number, y: number): Point => [(x + dx) * m, (y + dy) * m]
  return [g(box.minX, box.minY), g(box.maxX, box.minY), g(box.maxX, box.maxY), g(box.minX, box.maxY), g(box.minX, box.minY)]
}

// The event document: one control pool and the courses that use it, stored as JSON in events.doc.
// Positions are ground metres in the event's map version frame (see tiles.ts), never pixels.
import { z } from 'zod'

export const SCHEMA_VERSION = 1

export const CONTROL_KINDS = ['start', 'control', 'finish', 'crossingPoint'] as const
export type ControlKind = (typeof CONTROL_KINDS)[number]

/** Which IOF specification the course symbols follow: forest (ISOM 2017-2) or sprint (ISSprOM 2019-2). */
export const STANDARDS = ['isom', 'issprom'] as const
export type Standard = (typeof STANDARDS)[number]

const point = z.tuple([z.number().finite(), z.number().finite()])

/** Columns of a control description the setter fills in (A and B are the number and code). */
export const DESCRIPTION_COLUMNS = ['c', 'd', 'e', 'f', 'g', 'h'] as const
export type DescriptionColumnKey = (typeof DESCRIPTION_COLUMNS)[number]

/**
 * A control's description: IOF symbol ids by column (see descriptions/symbols.ts); column F also takes
 * a size ("1.5", "3x4", "0.5/2" for two sizes, "2|3" for one above the other). Checked by setDescription.
 */
const cell = z.string().min(1).max(16).optional()
const description = z.object({ c: cell, d: cell, e: cell, f: cell, g: cell, h: cell })

const control = z.object({
  id: z.string().min(1),
  kind: z.enum(CONTROL_KINDS),
  /** Control code on the marker, for kind 'control' only (31 and up by default). */
  code: z.number().int().min(1).max(999).nullable(),
  position: point,
  /** The same in every course that uses the control. Start and controls only. */
  description: description.optional(),
})

/**
 * Special course planning symbols that are not stops on a course (ISOM 2017-2 / ISSprOM 2019-2 7xx).
 * Sprint maps have no out-of-bounds route, first aid or refreshment symbols; forest maps have no crossing
 * section or temporary construction.
 */
export const SPECIAL_KINDS = [
  'mapIssue', // 702, point
  'markedRoute', // 707 as a free line, e.g. from the map issue point to the start (legs have their own)
  'oobBoundary', // 708, line
  'oobArea', // 709, area
  'oobRoute', // 711, line (ISOM)
  'crossingSection', // 710.2, line (ISSprOM)
  'firstAid', // 712, point (ISOM)
  'refreshment', // 713, point (ISOM)
  'temporaryConstruction', // 714, area (ISSprOM)
] as const
export type SpecialKind = (typeof SPECIAL_KINDS)[number]

export const SPECIAL_GEOMETRY: Record<SpecialKind, 'point' | 'line' | 'area'> = {
  mapIssue: 'point',
  markedRoute: 'line',
  oobBoundary: 'line',
  oobArea: 'area',
  oobRoute: 'line',
  crossingSection: 'line',
  firstAid: 'point',
  refreshment: 'point',
  temporaryConstruction: 'area',
}

/** The kinds each standard has, in the order of the specification. */
export const SPECIALS_BY_STANDARD: Record<Standard, readonly SpecialKind[]> = {
  isom: ['mapIssue', 'markedRoute', 'oobBoundary', 'oobArea', 'oobRoute', 'firstAid', 'refreshment'],
  issprom: ['mapIssue', 'markedRoute', 'oobBoundary', 'oobArea', 'crossingSection', 'temporaryConstruction'],
}

/** How many points each geometry needs at least. */
export const MIN_POINTS = { point: 1, line: 2, area: 3 } as const

/** Out-of-bounds area boundary (709): marked continuously (solid), intermittently (dashed) or not at all. */
export const BOUNDARY_STYLES = ['solid', 'dashed', 'none'] as const
export type BoundaryStyle = (typeof BOUNDARY_STYLES)[number]

const special = z.object({
  id: z.string().min(1),
  kind: z.enum(SPECIAL_KINDS),
  /** Ground metres in the map frame: one point, a line's vertices, or an area's outline (not repeated at the end). */
  points: z.array(point).min(1),
  /** The courses that show it; absent: every course. */
  courses: z.array(z.string().min(1)).optional(),
  /** Out-of-bounds areas only; absent: solid. */
  boundary: z.enum(BOUNDARY_STYLES).optional(),
})

const course = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(60),
  /** Control ids in running order: start first, finish last. A control may appear in many courses. */
  controls: z.array(z.string().min(1)),
  /** Denominator of the scale the course is printed at. */
  printScale: z.number().int().min(500).max(100000),
  /** Bend points of a leg, keyed by `legKey(from, to)`; the leg is drawn and measured through them. */
  bends: z.record(z.string(), z.array(point)),
  /** Control numbers the setter moved: offset from the control's centre in paper mm, by control id. */
  numberPositions: z.record(z.string(), point).default({}),
  /** Climb in metres, shown on the description sheet; set by hand (null or absent: not shown). */
  climb: z.number().int().min(0).max(9999).nullable().optional(),
  /** Cell size of the printed description sheet in mm (IOF: 5–7); default DEFAULT_CELL_SIZE. */
  descriptionCellSize: z.number().min(5).max(7).optional(),
  /** Legs that are marked routes (707), by `legKey(from, to)`: drawn dashed, with an instruction on the sheet. */
  markedRoutes: z.array(z.string()).optional(),
})

export const DEFAULT_CELL_SIZE = 6

export const eventDocSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    standard: z.enum(STANDARDS),
    controls: z.array(control),
    courses: z.array(course),
    specials: z.array(special).default([]),
  })
  .superRefine((doc, ctx) => {
    const ids = new Set<string>()
    const codes = new Set<number>()
    doc.controls.forEach((c, i) => {
      if (ids.has(c.id)) ctx.addIssue({ code: 'custom', path: ['controls', i, 'id'], message: `duplicate control id ${c.id}` })
      ids.add(c.id)
      if (c.kind === 'control') {
        if (c.code === null) ctx.addIssue({ code: 'custom', path: ['controls', i, 'code'], message: 'a control needs a code' })
        else if (codes.has(c.code)) ctx.addIssue({ code: 'custom', path: ['controls', i, 'code'], message: `duplicate code ${c.code}` })
        else codes.add(c.code)
      } else if (c.code !== null) {
        ctx.addIssue({ code: 'custom', path: ['controls', i, 'code'], message: `a ${c.kind} has no code` })
      }
    })
    const courseIds = new Set<string>()
    doc.courses.forEach((c, i) => {
      if (courseIds.has(c.id)) ctx.addIssue({ code: 'custom', path: ['courses', i, 'id'], message: `duplicate course id ${c.id}` })
      courseIds.add(c.id)
      c.controls.forEach((id, j) => {
        if (!ids.has(id)) ctx.addIssue({ code: 'custom', path: ['courses', i, 'controls', j], message: `unknown control ${id}` })
      })
    })
    const specialIds = new Set<string>()
    doc.specials.forEach((s, i) => {
      if (specialIds.has(s.id) || ids.has(s.id))
        ctx.addIssue({ code: 'custom', path: ['specials', i, 'id'], message: `duplicate id ${s.id}` })
      specialIds.add(s.id)
      const needed = MIN_POINTS[SPECIAL_GEOMETRY[s.kind]]
      if (s.points.length < needed || (needed === 1 && s.points.length > 1)) {
        ctx.addIssue({
          code: 'custom',
          path: ['specials', i, 'points'],
          message: `a ${s.kind} needs ${needed === 1 ? 'one point' : `${needed} points or more`}`,
        })
      }
    })
  })

export type Point = [number, number]
export type Control = z.infer<typeof control>
export type Course = z.infer<typeof course>
export type Description = z.infer<typeof description>
export type Special = z.infer<typeof special>
export type EventDoc = z.infer<typeof eventDocSchema>

/** Key of a leg in `Course.bends`. */
export const legKey = (from: string, to: string) => `${from}>${to}`

/** The standard a map's courses follow by default: sprint for maps at 1:5 000 or larger. */
export const defaultStandard = (mapScale: number): Standard => (mapScale <= 5000 ? 'issprom' : 'isom')

export function emptyDoc(mapScale: number): EventDoc {
  return { schemaVersion: SCHEMA_VERSION, standard: defaultStandard(mapScale), controls: [], courses: [], specials: [] }
}

/**
 * A stored document, validated. Documents created by the database start without a standard; it is
 * filled in from the map scale.
 */
export function parseDoc(raw: unknown, mapScale: number): EventDoc {
  const input = raw && typeof raw === 'object' ? { standard: defaultStandard(mapScale), ...raw } : raw
  return eventDocSchema.parse(input)
}

export class CourseError extends Error {
  readonly code:
    | 'unknown_control'
    | 'unknown_course'
    | 'unknown_special'
    | 'code_in_use'
    | 'invalid_code'
    | 'invalid_index'
    | 'invalid_description'
    | 'invalid_special'
  constructor(code: CourseError['code'], message: string) {
    super(message)
    this.code = code
  }
}

export function controlById(doc: EventDoc, id: string): Control {
  const found = doc.controls.find(c => c.id === id)
  if (!found) throw new CourseError('unknown_control', `No control ${id}`)
  return found
}

export function specialById(doc: EventDoc, id: string): Special {
  const found = doc.specials.find(s => s.id === id)
  if (!found) throw new CourseError('unknown_special', `No special symbol ${id}`)
  return found
}

/** Whether a special symbol shows on a course (null: the all-controls view, which shows every one). */
export function specialShownOn(special: Special, courseId: string | null): boolean {
  return courseId === null || !special.courses || special.courses.includes(courseId)
}

export function courseById(doc: EventDoc, id: string): Course {
  const found = doc.courses.find(c => c.id === id)
  if (!found) throw new CourseError('unknown_course', `No course ${id}`)
  return found
}

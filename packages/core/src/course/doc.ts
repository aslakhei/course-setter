// The event document: one control pool and the courses that use it, stored as JSON in events.doc.
// Positions are ground metres in the event's map version frame (see tiles.ts), never pixels.
import { z } from 'zod'

export const SCHEMA_VERSION = 1

/**
 * What a course passes through, in the shared pool:
 * - map issue point (702): before the start; the way from it to the start is a marked route;
 * - start, control, finish;
 * - mandatory crossing point (710);
 * - marked route (707): a taped line the course follows, from its first point to its last.
 */
export const CONTROL_KINDS = ['mapIssue', 'start', 'control', 'finish', 'crossingPoint', 'markedRoute'] as const
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
  /** Where it is; for a marked route, its first point. */
  position: point,
  /** A marked route's line, two points or more, in running order. Other kinds have none. */
  route: z.array(point).optional(),
  /** The same in every course that uses the control. Start and controls only. */
  description: description.optional(),
})

/**
 * Special course planning symbols that are not stops on a course (ISOM 2017-2 / ISSprOM 2019-2 7xx).
 * Sprint maps have no out-of-bounds route, first aid or refreshment symbols; forest maps have no crossing
 * section or temporary construction.
 */
export const SPECIAL_KINDS = [
  'optionalCrossing', // 710 not on a course: a voluntary crossing point, its point and the way through
  'oobBoundary', // 708, line
  'oobArea', // 709, area
  'oobRoute', // 711, line (ISOM)
  'crossingSection', // 710.2, line (ISSprOM)
  'firstAid', // 712, point (ISOM)
  'refreshment', // 713, point (ISOM)
  'temporaryConstruction', // 714, area (ISSprOM)
] as const
export type SpecialKind = (typeof SPECIAL_KINDS)[number]

/** 'direction': a point and a second point giving a direction from it (two clicks). */
export type SpecialGeometry = 'point' | 'direction' | 'line' | 'area'

export const SPECIAL_GEOMETRY: Record<SpecialKind, SpecialGeometry> = {
  optionalCrossing: 'direction',
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
  isom: ['optionalCrossing', 'oobBoundary', 'oobArea', 'oobRoute', 'firstAid', 'refreshment'],
  issprom: ['optionalCrossing', 'oobBoundary', 'oobArea', 'crossingSection', 'temporaryConstruction'],
}

/** How many points each geometry needs at least (a point and a direction need exactly that many). */
export const MIN_POINTS = { point: 1, direction: 2, line: 2, area: 3 } as const
/** Whether `count` points make a shape of this geometry. */
export const pointsFit = (geometry: SpecialGeometry, count: number) =>
  geometry === 'point' || geometry === 'direction' ? count === MIN_POINTS[geometry] : count >= MIN_POINTS[geometry]

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

/** Paper sizes in mm (portrait: width × height). */
export const PAPERS = { A4: [210, 297], A3: [297, 420] } as const
export type Paper = keyof typeof PAPERS
export const ORIENTATIONS = ['portrait', 'landscape'] as const
export type Orientation = (typeof ORIENTATIONS)[number]

/**
 * Something placed on the printed page, in page mm from the page's top-left corner, y down (as the
 * setter sees the page). Only the description sheet so far; text, logos and layout templates can join
 * later as new kinds.
 */
const layoutElement = z.object({
  kind: z.literal('descriptions'),
  /** Top-left corner of the element on the page. */
  at: point,
})

const printSettings = z.object({
  paper: z.enum(['A4', 'A3']),
  orientation: z.enum(ORIENTATIONS),
  /** Centre of the printed map area, ground metres in the map frame. */
  center: point,
  /** White border round the map area, mm (most printers cannot print to the edge). */
  margin: z.number().min(0).max(30),
  layout: z.array(layoutElement),
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
  /** How the course is printed; absent: chosen from the course (see print/layout.ts). */
  print: printSettings.optional(),
})

export const DEFAULT_CELL_SIZE = 6

/**
 * The page of every control with its code (for setting out the controls), printed like a course: its
 * id stands among course ids wherever a course is printed, and courseById gives it as a course.
 */
export const ALL_CONTROLS = 'all'
export const ALL_CONTROLS_NAME = 'All controls'
const DEFAULT_PRINT_SCALE = 10000

/** How the all-controls page is printed, as on a course (absent fields: the defaults). */
const allControls = z.object({
  /** Absent: the first course's print scale. */
  printScale: z.number().int().min(500).max(100000).optional(),
  descriptionCellSize: z.number().min(5).max(7).optional(),
  print: printSettings.optional(),
})

export const eventDocSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    standard: z.enum(STANDARDS),
    controls: z.array(control),
    courses: z.array(course),
    specials: z.array(special).default([]),
    allControls: allControls.optional(),
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
      if (c.kind === 'markedRoute' ? (c.route?.length ?? 0) < 2 : c.route !== undefined) {
        ctx.addIssue({ code: 'custom', path: ['controls', i, 'route'], message: 'only a marked route has a route, of two points or more' })
      }
    })
    const courseIds = new Set<string>()
    doc.courses.forEach((c, i) => {
      if (c.id === ALL_CONTROLS) ctx.addIssue({ code: 'custom', path: ['courses', i, 'id'], message: `${ALL_CONTROLS} is not a course id` })
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
      if (!pointsFit(SPECIAL_GEOMETRY[s.kind], s.points.length)) {
        ctx.addIssue({ code: 'custom', path: ['specials', i, 'points'], message: `wrong number of points for a ${s.kind}` })
      }
    })
  })

export type Point = [number, number]
export type Control = z.infer<typeof control>
export type Course = z.infer<typeof course>
export type Description = z.infer<typeof description>
export type Special = z.infer<typeof special>
export type PrintSettings = z.infer<typeof printSettings>
export type LayoutElement = z.infer<typeof layoutElement>
export type AllControls = z.infer<typeof allControls>
export type EventDoc = z.infer<typeof eventDocSchema>

/** Where the course arrives at a stop: a marked route's first point, otherwise its position. */
export const entryPoint = (control: Control): Point => control.route?.[0] ?? control.position
/** Where the course leaves a stop: a marked route's last point, otherwise its position. */
export const exitPoint = (control: Control): Point => control.route?.at(-1) ?? control.position

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
  const input = raw && typeof raw === 'object' ? { standard: defaultStandard(mapScale), ...upgrade(raw as RawDoc) } : raw
  return eventDocSchema.parse(input)
}

type RawPoint = [number, number]
type RawDoc = {
  controls?: { id: string; kind: string; position: RawPoint }[]
  courses?: { id: string; controls: string[]; bends?: Record<string, RawPoint[]>; markedRoutes?: string[] }[]
  specials?: { id: string; kind: string; points: RawPoint[] }[]
}

/**
 * Documents saved before marked routes and map issue points became course stops: map issue points
 * and free marked routes were special symbols, and a marked route was a whole leg marked as such.
 * They become a map issue point and marked routes in the pool (a marked leg: a marked route from
 * control to control, through the leg's bends, put into the course between them).
 */
export function upgrade(raw: RawDoc): RawDoc {
  const legacy = (raw.specials ?? []).filter(s => s.kind === 'mapIssue' || s.kind === 'markedRoute')
  const markedLegs = (raw.courses ?? []).some(c => c.markedRoutes?.length)
  if (!legacy.length && !markedLegs) return raw
  const controls = [...(raw.controls ?? [])] as Record<string, unknown>[]
  for (const s of legacy) {
    const [first] = s.points as [RawPoint]
    controls.push(
      s.kind === 'mapIssue'
        ? { id: s.id, kind: 'mapIssue', code: null, position: first }
        : { id: s.id, kind: 'markedRoute', code: null, position: first, route: s.points },
    )
  }
  const positions = new Map((raw.controls ?? []).map(c => [c.id, c.position]))
  const courses = (raw.courses ?? []).map(course => {
    const { markedRoutes = [], ...rest } = course
    const sequence = [...course.controls]
    const bends = { ...(course.bends ?? {}) }
    for (const key of markedRoutes) {
      const [from = '', to = ''] = key.split('>')
      const at = sequence.findIndex((id, i) => id === from && sequence[i + 1] === to)
      const [a, b] = [positions.get(from), positions.get(to)]
      if (at < 0 || !a || !b) continue
      const id = `${course.id}:${key}`
      controls.push({ id, kind: 'markedRoute', code: null, position: a, route: [a, ...(bends[key] ?? []), b] })
      delete bends[key]
      sequence.splice(at + 1, 0, id)
    }
    return { ...rest, controls: sequence, bends }
  })
  return { ...raw, controls: controls as RawDoc['controls'], courses, specials: (raw.specials ?? []).filter(s => !legacy.includes(s)) }
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
    | 'invalid_print'
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

/** Whether a special symbol shows on a course (null or ALL_CONTROLS: the all-controls view, which shows every one). */
export function specialShownOn(special: Special, courseId: string | null): boolean {
  return courseId === null || courseId === ALL_CONTROLS || !special.courses || special.courses.includes(courseId)
}

/** The all-controls page as a course: no stops of its own (it draws every control), printed as set in doc.allControls. */
export function allControlsCourse(doc: EventDoc): Course {
  const { printScale, descriptionCellSize, print } = doc.allControls ?? {}
  return {
    id: ALL_CONTROLS,
    name: ALL_CONTROLS_NAME,
    controls: [],
    printScale: printScale ?? doc.courses[0]?.printScale ?? DEFAULT_PRINT_SCALE,
    bends: {},
    numberPositions: {},
    ...(descriptionCellSize !== undefined ? { descriptionCellSize } : {}),
    ...(print ? { print } : {}),
  }
}

/** A course, or with ALL_CONTROLS the all-controls page. */
export function courseById(doc: EventDoc, id: string): Course {
  if (id === ALL_CONTROLS) return allControlsCourse(doc)
  const found = doc.courses.find(c => c.id === id)
  if (!found) throw new CourseError('unknown_course', `No course ${id}`)
  return found
}

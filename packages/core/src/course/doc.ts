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
})

export const DEFAULT_CELL_SIZE = 6

export const eventDocSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    standard: z.enum(STANDARDS),
    controls: z.array(control),
    courses: z.array(course),
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
  })

export type Point = [number, number]
export type Control = z.infer<typeof control>
export type Course = z.infer<typeof course>
export type Description = z.infer<typeof description>
export type EventDoc = z.infer<typeof eventDocSchema>

/** Key of a leg in `Course.bends`. */
export const legKey = (from: string, to: string) => `${from}>${to}`

/** The standard a map's courses follow by default: sprint for maps at 1:5 000 or larger. */
export const defaultStandard = (mapScale: number): Standard => (mapScale <= 5000 ? 'issprom' : 'isom')

export function emptyDoc(mapScale: number): EventDoc {
  return { schemaVersion: SCHEMA_VERSION, standard: defaultStandard(mapScale), controls: [], courses: [] }
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
  readonly code: 'unknown_control' | 'unknown_course' | 'code_in_use' | 'invalid_code' | 'invalid_index' | 'invalid_description'
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

export function courseById(doc: EventDoc, id: string): Course {
  const found = doc.courses.find(c => c.id === id)
  if (!found) throw new CourseError('unknown_course', `No course ${id}`)
  return found
}

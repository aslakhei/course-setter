// Editing commands: pure functions from a document to a new one (the input is never changed), so the
// editor keeps every state for undo/redo. Invalid edits throw CourseError.
import { cellSymbol } from '../descriptions/symbols.ts'
import {
  ALL_CONTROLS,
  allControlsCourse,
  type BoundaryStyle,
  type ControlKind,
  type Course,
  CourseError,
  controlById,
  courseById,
  type DescriptionColumnKey,
  type EventDoc,
  legKey,
  type Point,
  type PrintSettings,
  pointsFit,
  SPECIAL_GEOMETRY,
  type Special,
  type SpecialKind,
  type Standard,
  specialById,
} from './doc.ts'
import { nextFreeCode } from './numbering.ts'

function withCourse(doc: EventDoc, courseId: string, change: (course: Course) => Course): EventDoc {
  if (courseId === ALL_CONTROLS) {
    // Only how it is printed is kept: the page has no stops of its own.
    const { printScale, descriptionCellSize, print } = change(allControlsCourse(doc))
    return {
      ...doc,
      allControls: { printScale, ...(descriptionCellSize !== undefined ? { descriptionCellSize } : {}), ...(print ? { print } : {}) },
    }
  }
  courseById(doc, courseId)
  return { ...doc, courses: doc.courses.map(c => (c.id === courseId ? change(c) : c)) }
}

/** Add a control (a marked route with its `route`, two points or more; its position is the first). */
export function addControl(
  doc: EventDoc,
  { id, kind, position, code, route }: { id: string; kind: ControlKind; position: Point; code?: number; route?: Point[] },
): EventDoc {
  const controlCode = kind === 'control' ? (code ?? nextFreeCode(doc)) : null
  if (controlCode !== null && doc.controls.some(c => c.code === controlCode)) {
    throw new CourseError('code_in_use', `Code ${controlCode} is already used`)
  }
  if (kind === 'markedRoute') {
    if (!route || route.length < 2) throw new CourseError('invalid_special', 'A marked route needs two points or more')
    return { ...doc, controls: [...doc.controls, { id, kind, code: null, position: route[0] as Point, route }] }
  }
  return { ...doc, controls: [...doc.controls, { id, kind, code: controlCode, position }] }
}

/** Move a control: every course that uses it follows. A marked route moves as a whole. */
export function moveControl(doc: EventDoc, id: string, position: Point): EventDoc {
  const control = controlById(doc, id)
  const [dx, dy] = [position[0] - control.position[0], position[1] - control.position[1]]
  return {
    ...doc,
    controls: doc.controls.map(c =>
      c.id !== id ? c : { ...c, position, ...(c.route ? { route: c.route.map(([x, y]): Point => [x + dx, y + dy]) } : {}) },
    ),
  }
}

/** Replace a marked route's line (two points or more). */
export function setRoute(doc: EventDoc, id: string, route: Point[]): EventDoc {
  const control = controlById(doc, id)
  if (control.kind !== 'markedRoute' || route.length < 2)
    throw new CourseError('invalid_special', 'A marked route needs two points or more')
  return { ...doc, controls: doc.controls.map(c => (c.id === id ? { ...c, position: route[0] as Point, route } : c)) }
}

/** Delete a control and take it out of every course (with the bends of its legs). */
export function deleteControl(doc: EventDoc, id: string): EventDoc {
  controlById(doc, id)
  return {
    ...doc,
    controls: doc.controls.filter(c => c.id !== id),
    courses: doc.courses.map(course => ({
      ...course,
      controls: course.controls.filter(c => c !== id),
      bends: Object.fromEntries(Object.entries(course.bends).filter(([key]) => !key.split('>').includes(id))),
    })),
  }
}

export function setControlCode(doc: EventDoc, id: string, code: number): EventDoc {
  const control = controlById(doc, id)
  if (control.kind !== 'control') throw new CourseError('invalid_code', `A ${control.kind} has no code`)
  if (!Number.isInteger(code) || code < 1 || code > 999) throw new CourseError('invalid_code', `Invalid code ${code}`)
  if (doc.controls.some(c => c.id !== id && c.code === code)) throw new CourseError('code_in_use', `Code ${code} is already used`)
  return { ...doc, controls: doc.controls.map(c => (c.id === id ? { ...c, code } : c)) }
}

export function addCourse(doc: EventDoc, { id, name, printScale }: { id: string; name: string; printScale: number }): EventDoc {
  return { ...doc, courses: [...doc.courses, { id, name: name.trim(), controls: [], printScale, bends: {}, numberPositions: {} }] }
}

export type CourseChange = { name?: string; printScale?: number; climb?: number | null; descriptionCellSize?: number }

export function updateCourse(doc: EventDoc, id: string, change: CourseChange): EventDoc {
  if (change.climb != null && (!Number.isInteger(change.climb) || change.climb < 0 || change.climb > 9999)) {
    throw new CourseError('invalid_description', `Invalid climb ${change.climb}`)
  }
  const cell = change.descriptionCellSize
  if (cell !== undefined && !(cell >= 5 && cell <= 7)) throw new CourseError('invalid_description', `Invalid cell size ${cell}`)
  return withCourse(doc, id, c => ({
    ...c,
    ...(change.name !== undefined ? { name: change.name.trim() } : {}),
    ...(change.printScale !== undefined ? { printScale: change.printScale } : {}),
    ...(change.climb !== undefined ? { climb: change.climb } : {}),
    ...(cell !== undefined ? { descriptionCellSize: cell } : {}),
  }))
}

/** A size in column F: one number, two numbers ("3x4" a size, "0.5/2" two heights, "2|3" one above the other). */
const SIZE = /^\d{1,4}(?:[.,]\d{1,2})?(?:[x×/|]\d{1,4}(?:[.,]\d{1,2})?)?$/

/**
 * Set one cell of a control's description to an IOF symbol id (or, in column F, a size), or clear it
 * with null. The description belongs to the control, so it changes in every course that uses it.
 */
export function setDescription(doc: EventDoc, controlId: string, column: DescriptionColumnKey, value: string | null): EventDoc {
  const control = controlById(doc, controlId)
  if (control.kind !== 'control' && control.kind !== 'start') {
    throw new CourseError('invalid_description', `A ${control.kind} has no description`)
  }
  let stored: string | null = null
  if (value !== null) {
    if (cellSymbol(column, value)) stored = value
    else if (column === 'f' && SIZE.test(value.trim())) stored = value.trim().replace('×', 'x').replace(',', '.')
    else throw new CourseError('invalid_description', `${value} does not go in column ${column.toUpperCase()}`)
  }
  const { [column]: _old, ...rest } = control.description ?? {}
  const description = stored === null ? rest : { ...rest, [column]: stored }
  return {
    ...doc,
    controls: doc.controls.map(c => {
      if (c.id !== controlId) return c
      const { description: _d, ...bare } = c
      return Object.keys(description).length ? { ...bare, description } : bare
    }),
  }
}

/** Delete a course; special symbols limited to chosen courses no longer list it. */
export function deleteCourse(doc: EventDoc, id: string): EventDoc {
  courseById(doc, id)
  return {
    ...doc,
    courses: doc.courses.filter(c => c.id !== id),
    specials: doc.specials.map(s => (s.courses?.includes(id) ? { ...s, courses: s.courses.filter(c => c !== id) } : s)),
  }
}

/** Put a control into a course at `index` (default: at the end). */
export function insertCourseControl(doc: EventDoc, courseId: string, controlId: string, index?: number): EventDoc {
  controlById(doc, controlId)
  return withCourse(doc, courseId, c => {
    const at = index ?? c.controls.length
    if (at < 0 || at > c.controls.length) throw new CourseError('invalid_index', `No position ${at} in ${c.name}`)
    return { ...c, controls: [...c.controls.slice(0, at), controlId, ...c.controls.slice(at)] }
  })
}

/** Take the control at `index` out of a course (the control stays in the pool). */
export function removeCourseControl(doc: EventDoc, courseId: string, index: number): EventDoc {
  return withCourse(doc, courseId, c => {
    if (index < 0 || index >= c.controls.length) throw new CourseError('invalid_index', `No position ${index} in ${c.name}`)
    return { ...c, controls: c.controls.filter((_, i) => i !== index) }
  })
}

export function moveCourseControl(doc: EventDoc, courseId: string, from: number, to: number): EventDoc {
  return withCourse(doc, courseId, c => {
    if (from < 0 || from >= c.controls.length || to < 0 || to >= c.controls.length) {
      throw new CourseError('invalid_index', `Cannot move ${from} to ${to} in ${c.name}`)
    }
    const controls = [...c.controls]
    const [moved] = controls.splice(from, 1)
    controls.splice(to, 0, moved as string)
    return { ...c, controls }
  })
}

/** Set (or with an empty list, clear) the bend points of the leg from one control to the next. */
export function setLegBends(doc: EventDoc, courseId: string, from: string, to: string, points: Point[]): EventDoc {
  return withCourse(doc, courseId, c => {
    const { [legKey(from, to)]: _old, ...rest } = c.bends
    return { ...c, bends: points.length ? { ...rest, [legKey(from, to)]: points } : rest }
  })
}

/** Turn the white outline round the control numbers on or off, for every course. */
export function setNumberOutline(doc: EventDoc, on: boolean): EventDoc {
  const { numberOutline: _old, ...rest } = doc
  return on ? { ...rest, numberOutline: true } : rest
}

/** Move a control's number in a course (offset from the control's centre in paper mm), or with null put it back where it goes by itself. */
export function setNumberPosition(doc: EventDoc, courseId: string, controlId: string, offset: Point | null): EventDoc {
  controlById(doc, controlId)
  return withCourse(doc, courseId, c => {
    const { [controlId]: _old, ...rest } = c.numberPositions
    return { ...c, numberPositions: offset ? { ...rest, [controlId]: offset } : rest }
  })
}

function checkPoints(kind: SpecialKind, points: Point[]): void {
  if (!pointsFit(SPECIAL_GEOMETRY[kind], points.length) || points.some(p => !p.every(Number.isFinite))) {
    throw new CourseError('invalid_special', `Wrong number of points for a ${kind}`)
  }
}

function withSpecial(doc: EventDoc, id: string, change: (special: Special) => Special): EventDoc {
  specialById(doc, id)
  return { ...doc, specials: doc.specials.map(s => (s.id === id ? change(s) : s)) }
}

/** Add a special symbol, shown on every course. */
export function addSpecial(doc: EventDoc, { id, kind, points }: { id: string; kind: SpecialKind; points: Point[] }): EventDoc {
  checkPoints(kind, points)
  if (doc.specials.some(s => s.id === id) || doc.controls.some(c => c.id === id)) {
    throw new CourseError('invalid_special', `Id ${id} is already used`)
  }
  return { ...doc, specials: [...doc.specials, { id, kind, points }] }
}

/** Replace a special symbol's points (moving it, or one of its vertices). */
export function setSpecialPoints(doc: EventDoc, id: string, points: Point[]): EventDoc {
  return withSpecial(doc, id, s => {
    checkPoints(s.kind, points)
    return { ...s, points }
  })
}

export function deleteSpecial(doc: EventDoc, id: string): EventDoc {
  specialById(doc, id)
  return { ...doc, specials: doc.specials.filter(s => s.id !== id) }
}

/** Show a special symbol on the chosen courses only, or with null on every course. */
export function setSpecialCourses(doc: EventDoc, id: string, courses: string[] | null): EventDoc {
  for (const c of courses ?? []) courseById(doc, c)
  return withSpecial(doc, id, s => {
    const { courses: _old, ...bare } = s
    return courses ? { ...bare, courses: [...new Set(courses)] } : bare
  })
}

/** How an out-of-bounds area's boundary is drawn. */
export function setSpecialBoundary(doc: EventDoc, id: string, boundary: BoundaryStyle): EventDoc {
  return withSpecial(doc, id, s => {
    if (s.kind !== 'oobArea') throw new CourseError('invalid_special', `A ${s.kind} has no boundary style`)
    const { boundary: _old, ...bare } = s
    return boundary === 'solid' ? bare : { ...bare, boundary }
  })
}

/** How a course is printed (paper, orientation, map area centre, margin, layout); null goes back to the defaults. */
export function setPrintSettings(doc: EventDoc, courseId: string, settings: PrintSettings | null): EventDoc {
  if (settings) {
    const ok =
      (settings.paper === 'A4' || settings.paper === 'A3') &&
      (settings.orientation === 'portrait' || settings.orientation === 'landscape') &&
      settings.center.every(Number.isFinite) &&
      settings.margin >= 0 &&
      settings.margin <= 30 &&
      settings.layout.every(e => e.at.every(Number.isFinite))
    if (!ok) throw new CourseError('invalid_print', 'Invalid print settings')
  }
  return withCourse(doc, courseId, c => {
    const { print: _old, ...bare } = c
    return settings ? { ...bare, print: settings } : bare
  })
}

export function setStandard(doc: EventDoc, standard: Standard): EventDoc {
  return { ...doc, standard }
}

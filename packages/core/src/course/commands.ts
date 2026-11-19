// Editing commands: pure functions from a document to a new one (the input is never changed), so the
// editor keeps every state for undo/redo. Invalid edits throw CourseError.
import {
  type ControlKind,
  type Course,
  CourseError,
  controlById,
  courseById,
  type EventDoc,
  legKey,
  type Point,
  type Standard,
} from './doc.ts'
import { nextFreeCode } from './numbering.ts'

function withCourse(doc: EventDoc, courseId: string, change: (course: Course) => Course): EventDoc {
  courseById(doc, courseId)
  return { ...doc, courses: doc.courses.map(c => (c.id === courseId ? change(c) : c)) }
}

export function addControl(
  doc: EventDoc,
  { id, kind, position, code }: { id: string; kind: ControlKind; position: Point; code?: number },
): EventDoc {
  const controlCode = kind === 'control' ? (code ?? nextFreeCode(doc)) : null
  if (controlCode !== null && doc.controls.some(c => c.code === controlCode)) {
    throw new CourseError('code_in_use', `Code ${controlCode} is already used`)
  }
  return { ...doc, controls: [...doc.controls, { id, kind, code: controlCode, position }] }
}

/** Move a control: every course that uses it follows. */
export function moveControl(doc: EventDoc, id: string, position: Point): EventDoc {
  controlById(doc, id)
  return { ...doc, controls: doc.controls.map(c => (c.id === id ? { ...c, position } : c)) }
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
  return { ...doc, courses: [...doc.courses, { id, name: name.trim(), controls: [], printScale, bends: {} }] }
}

export function updateCourse(doc: EventDoc, id: string, change: { name?: string; printScale?: number }): EventDoc {
  return withCourse(doc, id, c => ({
    ...c,
    ...(change.name !== undefined ? { name: change.name.trim() } : {}),
    ...(change.printScale !== undefined ? { printScale: change.printScale } : {}),
  }))
}

export function deleteCourse(doc: EventDoc, id: string): EventDoc {
  courseById(doc, id)
  return { ...doc, courses: doc.courses.filter(c => c.id !== id) }
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

export function setStandard(doc: EventDoc, standard: Standard): EventDoc {
  return { ...doc, standard }
}

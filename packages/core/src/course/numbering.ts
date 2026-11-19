// Control codes (on the markers, unique in the event) and course numbers (1, 2, 3 … along a course,
// computed, never stored).
import { type ControlKind, type Course, controlById, type EventDoc } from './doc.ts'

export const FIRST_CODE = 31

/** The lowest code from 31 up that no control in the event uses. */
export function nextFreeCode(doc: EventDoc, from = FIRST_CODE): number {
  const used = new Set(doc.controls.map(c => c.code))
  let code = from
  while (used.has(code)) code++
  return code
}

export type CourseStop = {
  controlId: string
  kind: ControlKind
  /** Running number on the course for controls (1, 2, …); null for start, finish and crossing points. */
  number: number | null
  code: number | null
}

/** The course's controls in order with their numbers; crossing points and start/finish are not numbered. */
export function courseStops(doc: EventDoc, course: Course): CourseStop[] {
  let n = 0
  return course.controls.map(id => {
    const control = controlById(doc, id)
    const number = control.kind === 'control' ? ++n : null
    return { controlId: id, kind: control.kind, number, code: control.code }
  })
}

/** Courses that use a control (a shared control moves for all of them). */
export function coursesUsing(doc: EventDoc, controlId: string): Course[] {
  return doc.courses.filter(c => c.controls.includes(controlId))
}

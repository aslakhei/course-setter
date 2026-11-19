// Editor state: the document with its undo/redo history, the active tool, the course being edited
// and the selected control. Everything here is pure, so it is tested without a browser; the map and
// panels only turn clicks into these calls.
import {
  addControl,
  type ControlKind,
  type Course,
  courseById,
  createHistory,
  type EventDoc,
  type History,
  insertCourseControl,
  legKey,
  legPath,
  type Point,
  record,
  redo,
  removeCourseControl,
  setLegBends,
  undo,
} from '@course-setter/core'

export type Tool = 'select' | ControlKind | 'bend'
export const ALL_CONTROLS = 'all'

export type EditorState = {
  history: History<EventDoc>
  tool: Tool
  /** A course id, or ALL_CONTROLS for the control pool. */
  courseId: string
  selected: string | null
}

export type Action =
  | { type: 'tool'; tool: Tool }
  | { type: 'course'; courseId: string }
  | { type: 'select'; controlId: string | null }
  | { type: 'edit'; doc: EventDoc; select?: string | null }
  | { type: 'undo' }
  | { type: 'redo' }
  /** Replace the document and forget the history (after taking someone else's version). */
  | { type: 'load'; doc: EventDoc }

export function initialState(doc: EventDoc): EditorState {
  return { history: createHistory(doc), tool: 'select', courseId: doc.courses[0]?.id ?? ALL_CONTROLS, selected: null }
}

const exists = (doc: EventDoc, id: string | null) => id !== null && doc.controls.some(c => c.id === id)

export function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case 'tool':
      return { ...state, tool: action.tool }
    case 'course':
      return { ...state, courseId: action.courseId, selected: null }
    case 'select':
      return { ...state, selected: action.controlId }
    case 'edit': {
      const history = record(state.history, action.doc)
      const selected = action.select !== undefined ? action.select : state.selected
      return { ...state, history, ...keepValid(history.present, state.courseId, selected) }
    }
    case 'undo':
    case 'redo': {
      const history = action.type === 'undo' ? undo(state.history) : redo(state.history)
      return { ...state, history, ...keepValid(history.present, state.courseId, state.selected) }
    }
    case 'load':
      return { ...state, history: createHistory(action.doc), ...keepValid(action.doc, state.courseId, state.selected) }
  }
}

/** After undo or a reload, the course or control may be gone: fall back to something that exists. */
function keepValid(doc: EventDoc, courseId: string, selected: string | null) {
  const course = courseId === ALL_CONTROLS || doc.courses.some(c => c.id === courseId) ? courseId : (doc.courses[0]?.id ?? ALL_CONTROLS)
  return { courseId: course, selected: exists(doc, selected) ? selected : null }
}

export function currentCourse(state: EditorState): Course | null {
  return state.courseId === ALL_CONTROLS ? null : (state.history.present.courses.find(c => c.id === state.courseId) ?? null)
}

const kindOf = (doc: EventDoc, id: string) => doc.controls.find(c => c.id === id)?.kind

/**
 * Where a new stop of `kind` goes in `course`: a start first, a finish last; anything else after the
 * selected stop (if it is on the course), otherwise before the finish, otherwise at the end.
 */
export function insertionIndex(doc: EventDoc, course: Course, kind: ControlKind, selected: string | null): number {
  if (kind === 'start') return 0
  const lastIsFinish = course.controls.length > 0 && kindOf(doc, course.controls.at(-1) as string) === 'finish'
  if (kind === 'finish') return course.controls.length
  const at = selected ? course.controls.lastIndexOf(selected) : -1
  if (at >= 0 && !(at === course.controls.length - 1 && lastIsFinish)) return at + 1
  return lastIsFinish ? course.controls.length - 1 : course.controls.length
}

/** Put a stop into a course; a course has one start and one finish, so a new one replaces the old. */
function placeInCourse(doc: EventDoc, course: Course, controlId: string, selected: string | null): EventDoc {
  const kind = kindOf(doc, controlId) as ControlKind
  let next = doc
  let current = course
  if (kind === 'start' && current.controls.length > 0 && kindOf(doc, current.controls[0] as string) === 'start') {
    next = removeCourseControl(next, current.id, 0)
    current = courseById(next, current.id)
  }
  if (kind === 'finish' && current.controls.length > 0 && kindOf(doc, current.controls.at(-1) as string) === 'finish') {
    next = removeCourseControl(next, current.id, current.controls.length - 1)
    current = courseById(next, current.id)
  }
  return insertCourseControl(next, current.id, controlId, insertionIndex(next, current, kind, selected))
}

/**
 * What a click on the map does with the current tool. `hit` is the control under the pointer, if any.
 * Returns the action to dispatch (or null when the click does nothing).
 */
export function clickAction(state: EditorState, point: Point, hit: string | null, newId: () => string): Action | null {
  const doc = state.history.present
  const course = currentCourse(state)
  if (state.tool === 'select') return { type: 'select', controlId: hit }
  if (state.tool === 'bend') return null // bends are added on legs, see addBend
  if (hit) {
    // An existing control: in a course, the setter reuses it (a control shared by several courses).
    if (!course) return { type: 'select', controlId: hit }
    if (kindOf(doc, hit) !== state.tool) return { type: 'select', controlId: hit }
    return { type: 'edit', doc: placeInCourse(doc, course, hit, state.selected), select: hit }
  }
  const id = newId()
  const withControl = addControl(doc, { id, kind: state.tool, position: point })
  return {
    type: 'edit',
    doc: course ? placeInCourse(withControl, courseById(withControl, course.id), id, state.selected) : withControl,
    select: id,
  }
}

/** Distance from `p` to the segment a–b. */
export function distanceToSegment([px, py]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** The leg of `course` nearest to `point` within `tolerance` metres, and the segment of it. */
export function legAt(doc: EventDoc, course: Course, point: Point, tolerance: number): { leg: number; segment: number } | null {
  let best: { leg: number; segment: number; distance: number } | null = null
  for (let leg = 0; leg + 1 < course.controls.length; leg++) {
    const path = legPath(doc, course, leg)
    for (let segment = 0; segment + 1 < path.length; segment++) {
      const distance = distanceToSegment(point, path[segment] as Point, path[segment + 1] as Point)
      if (distance <= tolerance && (!best || distance < best.distance)) best = { leg, segment, distance }
    }
  }
  return best && { leg: best.leg, segment: best.segment }
}

/** Add a bend point on a leg where it was clicked (between the points of the clicked segment). */
export function addBend(doc: EventDoc, course: Course, leg: number, segment: number, point: Point): EventDoc {
  const from = course.controls[leg] as string
  const to = course.controls[leg + 1] as string
  const bends = [...(course.bends[legKey(from, to)] ?? [])]
  bends.splice(segment, 0, point)
  return setLegBends(doc, course.id, from, to, bends)
}

export function moveBend(doc: EventDoc, course: Course, key: string, index: number, point: Point): EventDoc {
  const [from, to] = key.split('>') as [string, string]
  const bends = (course.bends[key] ?? []).map((p, i) => (i === index ? point : p))
  return setLegBends(doc, course.id, from, to, bends)
}

export function removeBend(doc: EventDoc, course: Course, key: string, index: number): EventDoc {
  const [from, to] = key.split('>') as [string, string]
  return setLegBends(
    doc,
    course.id,
    from,
    to,
    (course.bends[key] ?? []).filter((_, i) => i !== index),
  )
}

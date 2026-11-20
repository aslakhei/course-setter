// Editor state: the document with its undo/redo history, the active tool, the course being edited
// and the selected control. Everything here is pure, so it is tested without a browser; the map and
// panels only turn clicks into these calls.
import {
  addControl,
  addSpecial,
  CONTROL_KINDS,
  type ControlKind,
  type Course,
  courseById,
  createHistory,
  type EventDoc,
  type History,
  insertCourseControl,
  legKey,
  legPath,
  MIN_POINTS,
  type Point,
  type Primitive,
  record,
  redo,
  removeCourseControl,
  SPECIAL_GEOMETRY,
  SPECIAL_KINDS,
  type Special,
  type SpecialKind,
  setLegBends,
  undo,
} from '@course-setter/core'

/** Select, place a control of a kind, place or draw a special symbol of a kind, or bend legs. */
export type Tool = 'select' | ControlKind | SpecialKind | 'bend'
export const ALL_CONTROLS = 'all'

export const isControlTool = (tool: Tool): tool is ControlKind => (CONTROL_KINDS as readonly string[]).includes(tool)
export const isSpecialTool = (tool: Tool): tool is SpecialKind => (SPECIAL_KINDS as readonly string[]).includes(tool)
/** A special drawn point by point (a line or an area). */
export const isDrawingTool = (tool: Tool): tool is SpecialKind => isSpecialTool(tool) && SPECIAL_GEOMETRY[tool] !== 'point'

export type EditorState = {
  history: History<EventDoc>
  tool: Tool
  /** A course id, or ALL_CONTROLS for the control pool. */
  courseId: string
  /** A control or a special symbol. */
  selected: string | null
  /** The points of a line or area being drawn with a special tool. */
  draft: Point[]
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
  | { type: 'draft'; points: Point[] }
  /**
   * A click while drawing a line or area: adds a point, or, on the last point again (within `tolerance`
   * metres, as the second click of a double-click), finishes the drawing as special `id`.
   */
  | { type: 'draftPoint'; point: Point; tolerance: number; id: string }
  /** Finish the line or area being drawn (Enter) as special `id`. */
  | { type: 'finishDraft'; id: string }

export function initialState(doc: EventDoc): EditorState {
  return { history: createHistory(doc), tool: 'select', courseId: doc.courses[0]?.id ?? ALL_CONTROLS, selected: null, draft: [] }
}

const exists = (doc: EventDoc, id: string | null) =>
  id !== null && (doc.controls.some(c => c.id === id) || doc.specials.some(s => s.id === id))

export function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case 'tool':
      // Changing tools drops a line or area that was not finished.
      return { ...state, tool: action.tool, draft: [] }
    case 'course':
      return { ...state, courseId: action.courseId, selected: null }
    case 'select':
      return { ...state, selected: action.controlId }
    case 'draft':
      return { ...state, draft: action.points }
    case 'draftPoint': {
      const last = state.draft.at(-1)
      if (last && Math.hypot(action.point[0] - last[0], action.point[1] - last[1]) <= action.tolerance) {
        return finishDraft(state, action.id)
      }
      return { ...state, draft: [...state.draft, action.point] }
    }
    case 'finishDraft':
      return finishDraft(state, action.id)
    case 'edit': {
      const history = record(state.history, action.doc)
      const selected = action.select !== undefined ? action.select : state.selected
      return { ...state, history, draft: [], ...keepValid(history.present, state.courseId, selected) }
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

/**
 * The line or area being drawn, finished: added to the event and selected. Repeated points count once;
 * too few points just end the drawing.
 */
function finishDraft(state: EditorState, id: string): EditorState {
  const kind = state.tool
  const points = state.draft.filter((p, i) => i === 0 || p[0] !== state.draft[i - 1]?.[0] || p[1] !== state.draft[i - 1]?.[1])
  if (!isDrawingTool(kind) || points.length < MIN_POINTS[SPECIAL_GEOMETRY[kind]]) return { ...state, draft: [] }
  return reducer(state, { type: 'edit', doc: addSpecial(state.history.present, { id, kind, points }), select: id })
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
export function clickAction(state: EditorState, point: Point, hit: string | null, newId: () => string, tolerance = 0): Action | null {
  const doc = state.history.present
  const course = currentCourse(state)
  if (state.tool === 'select') return { type: 'select', controlId: hit }
  if (state.tool === 'bend') return null // bends are added on legs, see addBend
  if (isDrawingTool(state.tool)) return { type: 'draftPoint', point, tolerance, id: newId() }
  if (isSpecialTool(state.tool)) {
    const id = newId()
    return { type: 'edit', doc: addSpecial(doc, { id, kind: state.tool, points: [point] }), select: id }
  }
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

/**
 * The control whose number (a code, in the all-controls view) is under `pointer` (paper mm), with the
 * number's position; `slack` mm of leeway round the digits.
 */
export function numberAt(drawing: Primitive[], pointer: Point, slack: number): { id: string; atMm: Point } | null {
  for (const p of drawing) {
    if (p.type !== 'text' || p.role !== 'number' || !p.owner) continue
    if (
      Math.abs(pointer[0] - p.at[0]) <= p.height * 0.45 * p.text.length + slack &&
      Math.abs(pointer[1] - p.at[1]) <= p.height / 2 + slack
    ) {
      return { id: p.owner, atMm: p.at }
    }
  }
  return null
}

/** Whether `point` lies inside a polygon (even-odd). */
export function insidePolygon([x, y]: Point, polygon: Point[]): boolean {
  let inside = false
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length] as Point
    if (a[1] > y !== b[1] > y && x < a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0])) inside = !inside
  })
  return inside
}

/**
 * The special symbol under `point`: a point symbol within `radius` metres, a line within `tolerance`
 * metres, an area containing the point or within `tolerance` of its edge. Later (drawn on top) wins.
 */
export function specialAt(specials: Special[], point: Point, tolerance: number, radius: number): string | null {
  for (const s of [...specials].reverse()) {
    const geometry = SPECIAL_GEOMETRY[s.kind]
    const pts = s.points
    if (geometry === 'point') {
      const [p] = pts as [Point]
      if (Math.hypot(p[0] - point[0], p[1] - point[1]) <= radius) return s.id
      continue
    }
    const ring = geometry === 'area' ? [...pts, pts[0] as Point] : pts
    for (let i = 0; i + 1 < ring.length; i++) {
      if (distanceToSegment(point, ring[i] as Point, ring[i + 1] as Point) <= tolerance) return s.id
    }
    if (geometry === 'area' && insidePolygon(point, pts)) return s.id
  }
  return null
}

/** The vertex of a line or area within `tolerance` metres of `point`. */
export function vertexAt(special: Special, point: Point, tolerance: number): number | null {
  if (SPECIAL_GEOMETRY[special.kind] === 'point') return null
  const index = special.points.findIndex(p => Math.hypot(p[0] - point[0], p[1] - point[1]) <= tolerance)
  return index >= 0 ? index : null
}

/**
 * Shift+click on a selected line or area: on one of its points, that point removed (while enough are
 * left); on an edge within `tolerance` metres, a new point there. Null when the click is on neither, or
 * the point cannot go.
 */
export function editPoints(special: Special, point: Point, tolerance: number): Point[] | null {
  const geometry = SPECIAL_GEOMETRY[special.kind]
  if (geometry === 'point') return null
  const index = vertexAt(special, point, tolerance)
  if (index !== null) {
    return special.points.length > MIN_POINTS[geometry] ? special.points.filter((_, i) => i !== index) : null
  }
  const pts = special.points
  const edges = geometry === 'area' ? pts.length : pts.length - 1
  let best: { at: number; distance: number } | null = null
  for (let i = 0; i < edges; i++) {
    const distance = distanceToSegment(point, pts[i] as Point, pts[(i + 1) % pts.length] as Point)
    if (distance <= tolerance && (!best || distance < best.distance)) best = { at: i + 1, distance }
  }
  return best ? [...pts.slice(0, best.at), point, ...pts.slice(best.at)] : null
}

/** A special's points moved by `delta`, or only vertex `index` of them. */
export function movedPoints(special: Special, delta: Point, index: number | null): Point[] {
  return special.points.map((p, i): Point => (index === null || i === index ? [p[0] + delta[0], p[1] + delta[1]] : p))
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

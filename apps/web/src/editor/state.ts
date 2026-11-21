// Editor state: the document with its undo/redo history, the active tool, the course being edited
// and the selected control. Everything here is pure, so it is tested without a browser; the map and
// panels only turn clicks into these calls.
import {
  ALL_CONTROLS,
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
  pointsFit,
  record,
  redo,
  removeCourseControl,
  SPECIAL_GEOMETRY,
  SPECIAL_KINDS,
  type Special,
  type SpecialGeometry,
  type SpecialKind,
  setLegBends,
  undo,
} from '@course-setter/core'

/** Select, place a control of a kind, place or draw a special symbol of a kind, or bend legs. */
export type Tool = 'select' | ControlKind | SpecialKind | 'bend'
export { ALL_CONTROLS }

/** A course stop placed with one click (a marked route is drawn instead). */
export const isControlTool = (tool: Tool): tool is Exclude<ControlKind, 'markedRoute'> =>
  tool !== 'markedRoute' && (CONTROL_KINDS as readonly string[]).includes(tool)
export const isSpecialTool = (tool: Tool): tool is SpecialKind => (SPECIAL_KINDS as readonly string[]).includes(tool)
/** Drawn point by point: a marked route, or a special line, area, or point with a direction. */
export const isDrawingTool = (tool: Tool): boolean => tool === 'markedRoute' || (isSpecialTool(tool) && SPECIAL_GEOMETRY[tool] !== 'point')
/** The shape a drawing tool makes. */
export const drawingGeometry = (tool: Tool): SpecialGeometry => (isSpecialTool(tool) ? SPECIAL_GEOMETRY[tool] : 'line')

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
      const draft = [...state.draft, action.point]
      // A point with a direction is done at its second click.
      if (drawingGeometry(state.tool) === 'direction' && draft.length === 2) return finishDraft({ ...state, draft }, action.id)
      return { ...state, draft }
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
  if (!isDrawingTool(kind) || !pointsFit(drawingGeometry(kind), points.length)) return { ...state, draft: [] }
  const doc = state.history.present
  if (kind === 'markedRoute') {
    // A marked route goes into the course being edited, like a crossing point.
    const withRoute = addControl(doc, { id, kind, position: points[0] as Point, route: points })
    const course = currentCourse(state)
    const placed = course ? placeInCourse(withRoute, courseById(withRoute, course.id), id, state.selected) : withRoute
    return reducer(state, { type: 'edit', doc: placed, select: id })
  }
  return reducer(state, { type: 'edit', doc: addSpecial(doc, { id, kind: kind as SpecialKind, points }), select: id })
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
 * Where a new stop of `kind` goes in `course`: the map issue point first, the start first or right after
 * it, a finish last; anything else after the selected stop (if it is on the course and not the map issue
 * point), otherwise before the finish, otherwise at the end.
 */
export function insertionIndex(doc: EventDoc, course: Course, kind: ControlKind, selected: string | null): number {
  const firstIsMapIssue = course.controls.length > 0 && kindOf(doc, course.controls[0] as string) === 'mapIssue'
  if (kind === 'mapIssue') return 0
  if (kind === 'start') return firstIsMapIssue ? 1 : 0
  const lastIsFinish = course.controls.length > 0 && kindOf(doc, course.controls.at(-1) as string) === 'finish'
  if (kind === 'finish') return course.controls.length
  const at = selected ? course.controls.lastIndexOf(selected) : -1
  if (at >= 0 && !(at === course.controls.length - 1 && lastIsFinish) && !(at === 0 && firstIsMapIssue)) return at + 1
  return lastIsFinish ? course.controls.length - 1 : course.controls.length
}

/** Put a stop into a course; a course has one map issue point, start and finish: a new one replaces the old. */
function placeInCourse(doc: EventDoc, course: Course, controlId: string, selected: string | null): EventDoc {
  const kind = kindOf(doc, controlId) as ControlKind
  let next = doc
  let current = course
  if (kind === 'mapIssue' || kind === 'start' || kind === 'finish') {
    const old = current.controls.findIndex(id => kindOf(next, id) === kind)
    if (old >= 0) {
      next = removeCourseControl(next, current.id, old)
      current = courseById(next, current.id)
    }
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
  // A marked route already in the pool, clicked before drawing a new one: this course follows it too.
  if (state.tool === 'markedRoute' && hit && state.draft.length === 0 && course && kindOf(doc, hit) === 'markedRoute') {
    return { type: 'edit', doc: placeInCourse(doc, course, hit, state.selected), select: hit }
  }
  if (isDrawingTool(state.tool)) return { type: 'draftPoint', point, tolerance, id: newId() }
  if (isSpecialTool(state.tool)) {
    const id = newId()
    return { type: 'edit', doc: addSpecial(doc, { id, kind: state.tool, points: [point] }), select: id }
  }
  if (!isControlTool(state.tool)) return null
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
    if (geometry === 'point' || geometry === 'direction') {
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

/** Something drawn through points the setter can drag and edit: a special symbol or a marked route. */
export type Shape = { id: string; geometry: SpecialGeometry; points: Point[] }

export function shapeOf(doc: EventDoc, id: string | null): Shape | null {
  const special = doc.specials.find(s => s.id === id)
  if (special) return { id: special.id, geometry: SPECIAL_GEOMETRY[special.kind], points: special.points }
  const control = doc.controls.find(c => c.id === id)
  return control?.route ? { id: control.id, geometry: 'line', points: control.route } : null
}

/** The point of a shape within `tolerance` metres of `point` (a point symbol has none to drag apart). */
export function vertexAt(shape: Shape, point: Point, tolerance: number): number | null {
  if (shape.geometry === 'point') return null
  const index = shape.points.findIndex(p => Math.hypot(p[0] - point[0], p[1] - point[1]) <= tolerance)
  return index >= 0 ? index : null
}

/**
 * Shift+click on a selected line, area or route: on one of its points, that point removed (while enough
 * are left); on an edge within `tolerance` metres, a new point there. Null when the click is on neither,
 * or the point cannot go.
 */
export function editPoints(shape: Shape, point: Point, tolerance: number): Point[] | null {
  const geometry = shape.geometry
  if (geometry === 'point' || geometry === 'direction') return null
  const index = vertexAt(shape, point, tolerance)
  if (index !== null) {
    return shape.points.length > MIN_POINTS[geometry] ? shape.points.filter((_, i) => i !== index) : null
  }
  const pts = shape.points
  const edges = geometry === 'area' ? pts.length : pts.length - 1
  let best: { at: number; distance: number } | null = null
  for (let i = 0; i < edges; i++) {
    const distance = distanceToSegment(point, pts[i] as Point, pts[(i + 1) % pts.length] as Point)
    if (distance <= tolerance && (!best || distance < best.distance)) best = { at: i + 1, distance }
  }
  return best ? [...pts.slice(0, best.at), point, ...pts.slice(best.at)] : null
}

/** A shape's points moved by `delta`, or only point `index` of them. */
export function movedPoints(shape: Shape, delta: Point, index: number | null): Point[] {
  return shape.points.map((p, i): Point => (index === null || i === index ? [p[0] + delta[0], p[1] + delta[1]] : p))
}

/** A marked route under `point` (within `tolerance` metres of its line). */
export function routeAt(doc: EventDoc, ids: string[] | null, point: Point, tolerance: number): string | null {
  for (const c of doc.controls) {
    if (!c.route || (ids && !ids.includes(c.id))) continue
    for (let i = 0; i + 1 < c.route.length; i++) {
      if (distanceToSegment(point, c.route[i] as Point, c.route[i + 1] as Point) <= tolerance) return c.id
    }
  }
  return null
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

// Course length: from the first stop (the map issue point, if the course has one, else the start) along
// straight legs to the finish, through crossing points and each leg's bend points, and along every
// marked route the course follows (a leg ends where a marked route begins and starts again where it
// ends). Positions are ground metres in the map frame, so lengths are plain Euclidean distances in metres.
import { type Course, controlById, type EventDoc, entryPoint, exitPoint, legKey, type Point } from './doc.ts'

/** The points a leg runs through: from stop `index` to stop `index + 1`, bends included. */
export function legPath(doc: EventDoc, course: Course, index: number): Point[] {
  const from = course.controls[index]
  const to = course.controls[index + 1]
  if (from === undefined || to === undefined) return []
  return [exitPoint(controlById(doc, from)), ...(course.bends[legKey(from, to)] ?? []), entryPoint(controlById(doc, to))]
}

export function pathLength(points: Point[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1] as Point
    const [x1, y1] = points[i] as Point
    total += Math.hypot(x1 - x0, y1 - y0)
  }
  return total
}

/** Length of each leg in metres, in running order (between stops; marked routes not included). */
export function legLengths(doc: EventDoc, course: Course): number[] {
  return course.controls.slice(1).map((_, i) => pathLength(legPath(doc, course, i)))
}

/** Length of a marked route in metres (0 for any other stop). */
export function routeLength(doc: EventDoc, controlId: string): number {
  return pathLength(controlById(doc, controlId).route ?? [])
}

/** Total course length in metres: the legs and the marked routes. */
export function courseLength(doc: EventDoc, course: Course): number {
  return legLengths(doc, course).reduce((sum, leg) => sum + leg, 0) + course.controls.reduce((sum, id) => sum + routeLength(doc, id), 0)
}

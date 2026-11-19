// Course length: straight lines start -> controls -> finish, through crossing points (they are stops
// on the course) and through each leg's bend points. Positions are ground metres in the map frame, so
// lengths are plain Euclidean distances in metres.
import { type Course, controlById, type EventDoc, legKey, type Point } from './doc.ts'

/** The points a leg runs through: from control `index` to control `index + 1`, bends included. */
export function legPath(doc: EventDoc, course: Course, index: number): Point[] {
  const from = course.controls[index]
  const to = course.controls[index + 1]
  if (from === undefined || to === undefined) return []
  return [controlById(doc, from).position, ...(course.bends[legKey(from, to)] ?? []), controlById(doc, to).position]
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

/** Length of each leg in metres, in running order. */
export function legLengths(doc: EventDoc, course: Course): number[] {
  return course.controls.slice(1).map((_, i) => pathLength(legPath(doc, course, i)))
}

/** Total course length in metres. */
export function courseLength(doc: EventDoc, course: Course): number {
  return legLengths(doc, course).reduce((sum, leg) => sum + leg, 0)
}

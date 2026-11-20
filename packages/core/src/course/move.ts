// Moving an event to a newer map version: every position goes through the transform from the old
// version's frame to the new one's (composed along the versions in between), so controls stay on the
// same terrain features even if the new map is shifted, rotated or at another scale.
import { apply, compose, IDENTITY, type Similarity } from '../similarity.ts'
import type { Extent } from '../tiles.ts'
import type { EventDoc, Point } from './doc.ts'

/**
 * The transform from the oldest to the newest version, given each version's transform from the one
 * before it, oldest step first.
 */
export function chainTransforms(steps: Similarity[]): Similarity {
  return steps.reduce((total, step) => compose(step, total), IDENTITY)
}

export type MovedDoc = {
  doc: EventDoc
  /** Controls that end up outside the new map (they still move; the setter decides what to do). */
  outside: string[]
}

export function moveDocToVersion(doc: EventDoc, transform: Similarity, newExtent: Extent): MovedDoc {
  const move = (p: Point): Point => apply(transform, p)
  const inside = ([x, y]: Point) => x >= newExtent.minX && x <= newExtent.maxX && y >= newExtent.minY && y <= newExtent.maxY
  const controls = doc.controls.map(c => ({ ...c, position: move(c.position) }))
  return {
    doc: {
      ...doc,
      controls,
      courses: doc.courses.map(course => ({
        ...course,
        bends: Object.fromEntries(Object.entries(course.bends).map(([key, points]) => [key, points.map(move)])),
      })),
      specials: doc.specials.map(s => ({ ...s, points: s.points.map(move) })),
    },
    outside: controls.filter(c => !inside(c.position)).map(c => c.id),
  }
}

/** What moving needs to know about a map version: which version it was lined up with, and how. */
export type VersionLink = { id: string; previousVersionId: string | null; transform: Similarity | null }

/**
 * The transform from version `fromId` to version `toId`, following each version's link back to the one
 * it was lined up with. Null when the chain does not lead back to `fromId` (a version in between was
 * deleted, or is not lined up yet): then the event cannot be moved automatically.
 */
export function transformBetween(versions: VersionLink[], fromId: string, toId: string): Similarity | null {
  const byId = new Map(versions.map(v => [v.id, v]))
  const steps: Similarity[] = []
  let at = byId.get(toId)
  while (at && at.id !== fromId) {
    if (!at.transform || !at.previousVersionId || steps.length >= versions.length) return null
    steps.unshift(at.transform)
    at = byId.get(at.previousVersionId)
  }
  return at ? chainTransforms(steps) : null
}

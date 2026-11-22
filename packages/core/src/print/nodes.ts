// Editing a white area's outline point by point (in the area's own coordinates: ground metres or page
// mm): moving points and handles, switching a point between corner and curve, adding and removing
// points, and moving or converting the whole outline.
import type { Point } from '../course/doc.ts'
import type { WhiteAreaNode } from './elements.ts'

const add = ([x, y]: Point, [dx, dy]: Point): Point => [x + dx, y + dy]
const sub = ([x, y]: Point, [x2, y2]: Point): Point => [x - x2, y - y2]

/** Every point and handle moved by `delta`. */
export function moveNodes(nodes: WhiteAreaNode[], delta: Point): WhiteAreaNode[] {
  return nodes.map(n => ({ at: add(n.at, delta), ...(n.in ? { in: add(n.in, delta) } : {}), ...(n.out ? { out: add(n.out, delta) } : {}) }))
}

/** Every point and handle passed through `f` (from ground metres to page mm or back). */
export function mapNodes(nodes: WhiteAreaNode[], f: (p: Point) => Point): WhiteAreaNode[] {
  return nodes.map(n => ({ at: f(n.at), ...(n.in ? { in: f(n.in) } : {}), ...(n.out ? { out: f(n.out) } : {}) }))
}

/** Point `i` moved to `at`, its handles with it. */
export function moveNode(nodes: WhiteAreaNode[], i: number, at: Point): WhiteAreaNode[] {
  const n = nodes[i]
  if (!n) return nodes
  const [moved] = moveNodes([n], sub(at, n.at))
  return nodes.map((x, j) => (j === i && moved ? moved : x))
}

/**
 * Handle `side` of point `i` moved to `at`. A curve stays smooth: the other handle turns to point the
 * opposite way, keeping its length, unless `alone` (Alt) breaks the curve into a sharp turn.
 */
export function moveHandle(nodes: WhiteAreaNode[], i: number, side: 'in' | 'out', at: Point, alone = false): WhiteAreaNode[] {
  const n = nodes[i]
  if (!n) return nodes
  const other = side === 'in' ? 'out' : 'in'
  const next: WhiteAreaNode = { ...n, [side]: at }
  const otherHandle = n[other]
  if (!alone && otherHandle) {
    const [dx, dy] = sub(at, n.at)
    const length = Math.hypot(...sub(otherHandle, n.at))
    const d = Math.hypot(dx, dy)
    if (d > 0) next[other] = [n.at[0] - (dx / d) * length, n.at[1] - (dy / d) * length]
  }
  return nodes.map((x, j) => (j === i ? next : x))
}

/**
 * Point `i` switched between corner and curve. A new curve point gets handles along the line between
 * its neighbours, a sixth of their distance each way (a smooth round turn).
 */
export function toggleCorner(nodes: WhiteAreaNode[], i: number): WhiteAreaNode[] {
  const n = nodes[i]
  if (!n) return nodes
  if (n.in || n.out) return nodes.map((x, j) => (j === i ? { at: x.at } : x))
  const prev = nodes[(i - 1 + nodes.length) % nodes.length] as WhiteAreaNode
  const next = nodes[(i + 1) % nodes.length] as WhiteAreaNode
  const [dx, dy] = sub(next.at, prev.at)
  const handle: Point = [dx / 6, dy / 6]
  return nodes.map((x, j) => (j === i ? { at: n.at, in: sub(n.at, handle), out: add(n.at, handle) } : x))
}

/** Point `i` removed (an outline keeps at least three points). */
export function removeNode(nodes: WhiteAreaNode[], i: number): WhiteAreaNode[] {
  return nodes.length > 3 ? nodes.filter((_, j) => j !== i) : nodes
}

/** A corner point inserted after point `i` at `at`. */
export function insertNode(nodes: WhiteAreaNode[], i: number, at: Point): WhiteAreaNode[] {
  return [...nodes.slice(0, i + 1), { at }, ...nodes.slice(i + 1)]
}

/**
 * The point being drawn with the pen, pressed at `at` and dragged to `to`: a corner if it was not
 * dragged, else a curve point whose outgoing handle follows the pointer and incoming one mirrors it.
 */
export function penNode(at: Point, to: Point | null): WhiteAreaNode {
  if (!to || (to[0] === at[0] && to[1] === at[1])) return { at }
  return { at, out: to, in: sub(at, sub(to, at)) }
}

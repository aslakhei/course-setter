// Geometry for editing a print layout on its page, in page mm (y up): which element is under the
// pointer, resizing a box by its handles, snapping to page edges, the margin, the centre lines, the map
// area and other elements, and aligning boxes.
import type { Point } from '../course/doc.ts'
import { type Bounds, flattenPath, type PathCommand } from '../render/primitives.ts'
import type { PlacedElement } from './compose.ts'

/** The topmost element under `point` (within `tolerance` mm of its box), skipping locked ones; null if none. */
export function elementAt(elements: PlacedElement[], [x, y]: Point, tolerance = 0): PlacedElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const e = elements[i] as PlacedElement
    if (e.locked) continue
    const b = e.box
    if (x >= b.minX - tolerance && x <= b.maxX + tolerance && y >= b.minY - tolerance && y <= b.maxY + tolerance) return e
  }
  return null
}

/** A box's handles: corners and edge middles, by compass direction (n: the top edge, y up). */
export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type Handle = (typeof HANDLES)[number]

/** Where each handle of a box is. */
export function handlePoints(b: Bounds): Record<Handle, Point> {
  const [cx, cy] = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2]
  return {
    nw: [b.minX, b.maxY],
    n: [cx, b.maxY],
    ne: [b.maxX, b.maxY],
    e: [b.maxX, cy],
    se: [b.maxX, b.minY],
    s: [cx, b.minY],
    sw: [b.minX, b.minY],
    w: [b.minX, cy],
  }
}

/** The handle within `tolerance` mm of `point`, if any. */
export function handleAt(b: Bounds, [x, y]: Point, tolerance: number, handles: readonly Handle[] = HANDLES): Handle | null {
  const points = handlePoints(b)
  for (const h of handles) {
    const [hx, hy] = points[h]
    if (Math.abs(x - hx) <= tolerance && Math.abs(y - hy) <= tolerance) return h
  }
  return null
}

/**
 * The box with `handle` dragged by `delta` mm: the opposite edges stay. `aspect` (width / height) keeps
 * the proportions when a corner is dragged (images). No side gets shorter than `min` mm.
 */
export function resizeBox(b: Bounds, handle: Handle, [dx, dy]: Point, { aspect, min = 1 }: { aspect?: number; min?: number } = {}): Bounds {
  let { minX, minY, maxX, maxY } = b
  if (handle.includes('w')) minX = Math.min(minX + dx, maxX - min)
  if (handle.includes('e')) maxX = Math.max(maxX + dx, minX + min)
  if (handle.includes('s')) minY = Math.min(minY + dy, maxY - min)
  if (handle.includes('n')) maxY = Math.max(maxY + dy, minY + min)
  if (aspect && aspect > 0 && handle.length === 2) {
    // The height follows the width; the corner opposite the handle stays.
    const height = (maxX - minX) / aspect
    if (handle.includes('s')) minY = maxY - height
    else maxY = minY + height
  }
  return { minX, minY, maxX, maxY }
}

/** Lines a box can snap to: x positions of vertical lines, y positions of horizontal ones (page mm). */
export type SnapTargets = { xs: number[]; ys: number[] }

/** The page's edges, margin and centre lines, the map area's edges, and the edges and centres of `others`. */
export function snapTargets(size: Point, margin: number, mapArea: Bounds, others: Bounds[]): SnapTargets {
  const [w, h] = size
  const xs = [0, margin, w / 2, w - margin, w, mapArea.minX, mapArea.maxX]
  const ys = [0, margin, h / 2, h - margin, h, mapArea.minY, mapArea.maxY]
  for (const o of others) {
    xs.push(o.minX, (o.minX + o.maxX) / 2, o.maxX)
    ys.push(o.minY, (o.minY + o.maxY) / 2, o.maxY)
  }
  return { xs, ys }
}

/** What a box snapped to: the lines to show as guides. */
export type Guides = { x: number | null; y: number | null }

/** The closest target to any of `values` within `threshold`, as the shift to apply; null if none. */
function nearest(values: number[], targets: number[], threshold: number): { shift: number; line: number } | null {
  let best: { shift: number; line: number } | null = null
  for (const v of values)
    for (const t of targets) {
      const d = t - v
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.shift))) best = { shift: d, line: t }
    }
  return best
}

/**
 * A moved box snapped to the nearest lines within `threshold` mm: its left edge, centre or right edge to
 * a vertical line, and its bottom, middle or top to a horizontal one.
 */
export function snapMove(b: Bounds, targets: SnapTargets, threshold: number): { box: Bounds; guides: Guides } {
  const sx = nearest([b.minX, (b.minX + b.maxX) / 2, b.maxX], targets.xs, threshold)
  const sy = nearest([b.minY, (b.minY + b.maxY) / 2, b.maxY], targets.ys, threshold)
  const dx = sx?.shift ?? 0
  const dy = sy?.shift ?? 0
  return {
    box: { minX: b.minX + dx, maxX: b.maxX + dx, minY: b.minY + dy, maxY: b.maxY + dy },
    guides: { x: sx?.line ?? null, y: sy?.line ?? null },
  }
}

/** A resized box with the edges its handle moves snapped to the nearest lines within `threshold` mm. */
export function snapResize(b: Bounds, handle: Handle, targets: SnapTargets, threshold: number): { box: Bounds; guides: Guides } {
  const box = { ...b }
  const guides: Guides = { x: null, y: null }
  const edge = (key: keyof Bounds, ts: number[], axis: 'x' | 'y') => {
    const s = nearest([box[key]], ts, threshold)
    if (!s) return
    box[key] += s.shift
    guides[axis] = s.line
  }
  if (handle.includes('w')) edge('minX', targets.xs, 'x')
  if (handle.includes('e')) edge('maxX', targets.xs, 'x')
  if (handle.includes('s')) edge('minY', targets.ys, 'y')
  if (handle.includes('n')) edge('maxY', targets.ys, 'y')
  return { box, guides }
}

export const ALIGNMENTS = ['left', 'center', 'right', 'top', 'middle', 'bottom'] as const
export type Alignment = (typeof ALIGNMENTS)[number]

/** The boxes lined up with each other: on the outermost edge, or on the centre of all of them together. */
export function alignBoxes(boxes: Bounds[], how: Alignment): Bounds[] {
  if (boxes.length === 0) return []
  const all = {
    minX: Math.min(...boxes.map(b => b.minX)),
    maxX: Math.max(...boxes.map(b => b.maxX)),
    minY: Math.min(...boxes.map(b => b.minY)),
    maxY: Math.max(...boxes.map(b => b.maxY)),
  }
  return boxes.map(b => {
    const [w, h] = [b.maxX - b.minX, b.maxY - b.minY]
    const x = how === 'left' ? all.minX : how === 'right' ? all.maxX - w : how === 'center' ? (all.minX + all.maxX - w) / 2 : b.minX
    const y = how === 'bottom' ? all.minY : how === 'top' ? all.maxY - h : how === 'middle' ? (all.minY + all.maxY - h) / 2 : b.minY
    return { minX: x, maxX: x + w, minY: y, maxY: y + h }
  })
}

/** Whether a point is inside a closed outline (even-odd, curves flattened). */
export function insidePath(commands: PathCommand[], [x, y]: Point): boolean {
  let inside = false
  for (const ring of flattenPath(commands, 12)) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i] as Point
      const [xj, yj] = ring[j] as Point
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
  }
  return inside
}

/** The topmost white area under a point, skipping locked ones; null if none. */
export function whiteAreaAt<T extends { commands: PathCommand[]; locked: boolean }>(areas: T[], point: Point): T | null {
  for (let i = areas.length - 1; i >= 0; i--) {
    const a = areas[i] as T
    if (!a.locked && insidePath(a.commands, point)) return a
  }
  return null
}

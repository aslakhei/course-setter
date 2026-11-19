// Course symbols as drawing primitives in paper millimetres, defined once and drawn by every backend
// (Canvas in the editor, pdf-lib in the worker). Coordinates are "print paper mm": a map frame
// position in metres × 1000 / printScale, y up, so one primitive list serves screen and paper.
//
// Sizes per ISOM 2017-2 section 3.7 (given at 1:15 000) and ISSprOM 2019-2 section 4.7 (given at
// 1:4 000), enlarged in proportion when printed at a larger scale (150 % at 1:10 000, 300 % at 1:5 000;
// 133 % at 1:3 000 for sprint). Values marked "to be checked" are not legible in the specifications'
// drawings and are reviewed with the symbol snapshot tests.
import { type Course, controlById, type EventDoc, legKey, type Point, type Standard } from './doc.ts'
import { courseStops } from './numbering.ts'

export type SymbolSizes = {
  /** Start triangle side (701). */
  startSide: number
  /** Control circle diameter (703), centre of line to centre of line. */
  controlDiameter: number
  /** Finish circle diameters (706). */
  finishInner: number
  finishOuter: number
  /** Line width of all course symbols and course lines (705). */
  lineWidth: number
  /** Control number height (704, Arial). */
  numberHeight: number
  /** Gap between a course line and the symbol it leads to (705: "there should be gaps"). To be checked. */
  legGap: number
  /** Crossing point (710): length of the two outward-curving lines, distance between them, their bulge. To be checked. */
  crossingLength: number
  crossingSpacing: number
  crossingBulge: number
}

const BASE: Record<Standard, { scale: number; sizes: SymbolSizes }> = {
  isom: {
    scale: 15000,
    sizes: {
      startSide: 6.0,
      controlDiameter: 5.0,
      finishInner: 4.0,
      finishOuter: 6.0,
      lineWidth: 0.35,
      numberHeight: 4.0,
      legGap: 0.6,
      crossingLength: 4.0,
      crossingSpacing: 1.2,
      crossingBulge: 0.5,
    },
  },
  issprom: {
    scale: 4000,
    sizes: {
      startSide: 7.0,
      controlDiameter: 6.0,
      finishInner: 5.0,
      finishOuter: 7.0,
      lineWidth: 0.35,
      numberHeight: 4.0,
      legGap: 0.6,
      crossingLength: 4.0,
      crossingSpacing: 1.2,
      crossingBulge: 0.5,
    },
  },
}

/** Symbol sizes in paper mm for a course printed at `printScale`. */
export function symbolSizes(standard: Standard, printScale: number): SymbolSizes {
  const { scale, sizes } = BASE[standard]
  const factor = Math.max(1, scale / printScale)
  return Object.fromEntries(Object.entries(sizes).map(([k, v]) => [k, v * factor])) as SymbolSizes
}

/**
 * What a primitive draws: a control's symbol, its number, or a course line. `owner` is the control it
 * belongs to (for highlighting and dragging in the editor); course lines have none.
 */
export type PrimitiveRole = 'symbol' | 'number' | 'leg'
type Tagged = { role: PrimitiveRole; owner?: string }

export type Primitive =
  | ({ type: 'circle'; center: Point; radius: number; lineWidth: number } & Tagged)
  | ({ type: 'polyline'; points: Point[]; lineWidth: number; closed: boolean } & Tagged)
  | ({ type: 'text'; at: Point; text: string; height: number } & Tagged)

/** Map frame metres -> print paper mm at a print scale. */
export const toPaperMm = ([x, y]: Point, printScale: number): Point => [(x * 1000) / printScale, (y * 1000) / printScale]

const sub = ([ax, ay]: Point, [bx, by]: Point): Point => [ax - bx, ay - by]
const len = ([x, y]: Point) => Math.hypot(x, y)
const unit = (v: Point): Point => {
  const l = len(v)
  return l === 0 ? [0, 1] : [v[0] / l, v[1] / l]
}
const along = (p: Point, dir: Point, d: number): Point => [p[0] + dir[0] * d, p[1] + dir[1] * d]

/** How far from its centre a course line stops at a stop of this kind (so it ends at the symbol's edge plus the gap). */
function clearance(kind: string, s: SymbolSizes): number {
  if (kind === 'start') return s.startSide / Math.sqrt(3) + s.legGap
  if (kind === 'finish') return s.finishOuter / 2 + s.legGap
  if (kind === 'control') return s.controlDiameter / 2 + s.legGap
  return 0 // the course line runs through a crossing point
}

/** Equilateral triangle around `center`, one corner pointing along `dir`. */
function triangle(center: Point, dir: Point, side: number): Point[] {
  const r = side / Math.sqrt(3)
  const angle = Math.atan2(dir[1], dir[0])
  return [0, 1, 2].map(i => {
    const a = angle + (i * 2 * Math.PI) / 3
    return [center[0] + r * Math.cos(a), center[1] + r * Math.sin(a)] as Point
  })
}

/**
 * A crossing point (710): two curved lines on either side of the course line, along the leg direction
 * `dir`, closest together in the middle where the course passes through, like an hourglass ")(".
 */
function crossing(center: Point, dir: Point, s: SymbolSizes, owner: string): Primitive[] {
  const normal: Point = [-dir[1], dir[0]]
  const half = s.crossingLength / 2
  return [1, -1].map(side => {
    const points: Point[] = []
    for (let i = 0; i <= 12; i++) {
      const t = -1 + i / 6 // -1 .. 1 along the line
      const offset = s.crossingSpacing / 2 + s.crossingBulge * t * t // narrowest at the middle, opening towards the ends
      points.push(along(along(center, dir, t * half), normal, side * offset))
    }
    return { type: 'polyline', points, lineWidth: s.lineWidth, closed: false, role: 'symbol', owner } as const
  })
}

/** Where to put a control number automatically: the direction around the circle farthest from the course lines. */
function numberPosition(center: Point, legDirections: Point[], s: SymbolSizes): Point {
  let best: Point = [Math.SQRT1_2, Math.SQRT1_2]
  let bestGap = -1
  for (let i = 0; i < 16; i++) {
    const a = Math.PI / 4 - (i * Math.PI) / 8 // start top-right, as numbers usually sit
    const dir: Point = [Math.cos(a), Math.sin(a)]
    const gap = Math.min(Math.PI, ...legDirections.map(d => Math.acos(Math.max(-1, Math.min(1, d[0] * dir[0] + d[1] * dir[1])))))
    if (gap > bestGap + 1e-9) {
      bestGap = gap
      best = dir
    }
  }
  return along(center, best, s.controlDiameter / 2 + s.numberHeight * 0.7)
}

/** All symbols of one course, in print paper mm at the course's print scale. */
export function courseDrawing(doc: EventDoc, course: Course): Primitive[] {
  const s = symbolSizes(doc.standard, course.printScale)
  const stops = courseStops(doc, course)
  const at = (i: number) => toPaperMm(controlById(doc, course.controls[i] as string).position, course.printScale)
  const path = (i: number): Point[] => {
    const from = course.controls[i] as string
    const to = course.controls[i + 1] as string
    return [at(i), ...(course.bends[legKey(from, to)] ?? []).map(p => toPaperMm(p, course.printScale)), at(i + 1)]
  }
  const out: Primitive[] = []

  // Course lines, cut back at both ends to the symbols' edges.
  for (let i = 0; i + 1 < stops.length; i++) {
    const points = path(i)
    const first = points[0] as Point
    const second = points[1] as Point
    const last = points.at(-1) as Point
    const beforeLast = points.at(-2) as Point
    const startCut = clearance(stops[i]?.kind ?? '', s)
    const endCut = clearance(stops[i + 1]?.kind ?? '', s)
    if (len(sub(second, first)) <= startCut || len(sub(last, beforeLast)) <= endCut) {
      if (points.length === 2) continue // the two symbols touch: no line between them
    }
    points[0] = along(first, unit(sub(second, first)), Math.min(startCut, len(sub(second, first))))
    points[points.length - 1] = along(last, unit(sub(beforeLast, last)), Math.min(endCut, len(sub(last, beforeLast))))
    out.push({ type: 'polyline', points, lineWidth: s.lineWidth, closed: false, role: 'leg' })
  }

  stops.forEach((stop, i) => {
    const p = at(i)
    const owner = stop.controlId
    const tag = { role: 'symbol', owner } as const
    const next = i + 1 < stops.length ? path(i)[1] : undefined
    const prev = i > 0 ? path(i - 1).at(-2) : undefined
    if (stop.kind === 'start') {
      out.push({
        type: 'polyline',
        points: triangle(p, next ? unit(sub(next, p)) : [0, 1], s.startSide),
        lineWidth: s.lineWidth,
        closed: true,
        ...tag,
      })
    } else if (stop.kind === 'finish') {
      out.push({ type: 'circle', center: p, radius: s.finishInner / 2, lineWidth: s.lineWidth, ...tag })
      out.push({ type: 'circle', center: p, radius: s.finishOuter / 2, lineWidth: s.lineWidth, ...tag })
    } else if (stop.kind === 'crossingPoint') {
      const dir = unit(next && prev ? sub(next, prev) : next ? sub(next, p) : prev ? sub(p, prev) : [0, 1])
      out.push(...crossing(p, dir, s, owner))
    } else {
      out.push({ type: 'circle', center: p, radius: s.controlDiameter / 2, lineWidth: s.lineWidth, ...tag })
      const legs = [next, prev].filter((q): q is Point => q !== undefined).map(q => unit(sub(q, p)))
      // A number the setter moved keeps its place relative to the control (in paper mm).
      const moved = course.numberPositions[owner]
      const numberAt = moved ? ([p[0] + moved[0], p[1] + moved[1]] as Point) : numberPosition(p, legs, s)
      out.push({ type: 'text', at: numberAt, text: String(stop.number), height: s.numberHeight, role: 'number', owner })
    }
  })
  return out
}

/** Every control of the event with its code (the "all controls" view), at `printScale`. */
export function allControlsDrawing(doc: EventDoc, printScale: number): Primitive[] {
  const s = symbolSizes(doc.standard, printScale)
  return doc.controls.flatMap((c): Primitive[] => {
    const p = toPaperMm(c.position, printScale)
    const tag = { role: 'symbol', owner: c.id } as const
    if (c.kind === 'start')
      return [{ type: 'polyline', points: triangle(p, [0, 1], s.startSide), lineWidth: s.lineWidth, closed: true, ...tag }]
    if (c.kind === 'finish') {
      return [
        { type: 'circle', center: p, radius: s.finishInner / 2, lineWidth: s.lineWidth, ...tag },
        { type: 'circle', center: p, radius: s.finishOuter / 2, lineWidth: s.lineWidth, ...tag },
      ]
    }
    if (c.kind === 'crossingPoint') return crossing(p, [0, 1], s, c.id)
    return [
      { type: 'circle', center: p, radius: s.controlDiameter / 2, lineWidth: s.lineWidth, ...tag },
      { type: 'text', at: numberPosition(p, [], s), text: String(c.code), height: s.numberHeight, role: 'number', owner: c.id },
    ]
  })
}

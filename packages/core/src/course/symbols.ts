// Course symbols as drawing primitives in paper millimetres, defined once and drawn by every backend
// (Canvas in the editor, pdf-lib for print, see ../render). Coordinates are "print paper mm": a map frame
// position in metres × 1000 / printScale, y up, so one primitive list serves screen and paper.
//
// Sizes per ISOM 2017-2 section 3.7 (given at 1:15 000) and ISSprOM 2019-2 revision 6 section 4.7 (given at
// 1:4 000), enlarged in proportion when printed at a larger scale (150 % at 1:10 000, 300 % at 1:5 000;
// 133 % at 1:3 000 for sprint). Where the specifications give no number (the crossing point's curve, how
// far course lines stop short of a crossing point), the values are taken from the specifications'
// drawings and match Purple Pen.
import type { Primitive } from '../render/primitives.ts'
import { ALL_CONTROLS, type Course, controlById, type EventDoc, entryPoint, exitPoint, legKey, type Point, type Standard } from './doc.ts'
import { courseStops } from './numbering.ts'

export type { Primitive, PrimitiveRole } from '../render/primitives.ts'

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
  /** Height of the digits of a control number (704, "Arial 4.0 mm"). */
  numberHeight: number
  /** Gap between a control number and the outer edge of its circle. */
  numberGap: number
  /** Gap between a course line and the symbol it leads to (705: "there should be gaps"). */
  legGap: number
  /**
   * Crossing point (710), in (along the leg, across it) coordinates: each of the two lines is a bezier
   * from (-crossingHalfLength, ±crossingEnd) to (+crossingHalfLength, ±crossingEnd) with its handles at
   * (∓crossingHandle, ±crossingWaist), so the lines are closest in the middle, like an hourglass ")(".
   * ISOM's drawing: 3.0 mm long, 0.6 mm clear between the lines at the waist.
   */
  crossingHalfLength: number
  crossingEnd: number
  crossingWaist: number
  crossingHandle: number
  crossingLineWidth: number
  /** How far from a crossing point's centre the course lines stop. */
  crossingClearance: number
  /** A leg that is a marked route (707) is dashed: dash and gap lengths. */
  markedDash: number
  markedGap: number
  /** Map issue point (702): a bar across the way to the start. */
  mapIssueLength: number
  mapIssueWidth: number
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
      numberGap: 1.0,
      legGap: 0.6,
      crossingHalfLength: 1.5,
      crossingEnd: 0.85,
      crossingWaist: 0.35,
      crossingHandle: 0.65,
      crossingLineWidth: 0.35,
      crossingClearance: 2.5,
      markedDash: 2.0,
      markedGap: 0.5,
      mapIssueLength: 2.5,
      mapIssueWidth: 0.6,
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
      numberGap: 1.0,
      legGap: 0.6,
      // ISSprOM 2019-2 revision 6 (710.1): 4.5 mm long, 0.5 mm lines, 1.0 mm clear in the middle
      // (centre lines 0.75 mm from the course line), the ends about 0.27 mm further out.
      crossingHalfLength: 2.25,
      crossingEnd: 1.02,
      crossingWaist: 0.66,
      crossingHandle: 0.975,
      crossingLineWidth: 0.5,
      crossingClearance: 3.25,
      markedDash: 2.0,
      markedGap: 0.5,
      mapIssueLength: 2.5,
      mapIssueWidth: 0.6,
    },
  },
}

/** Symbol sizes in paper mm for a course printed at `printScale`. */
export function symbolSizes(standard: Standard, printScale: number): SymbolSizes {
  const { scale, sizes } = BASE[standard]
  const factor = Math.max(1, scale / printScale)
  return Object.fromEntries(Object.entries(sizes).map(([k, v]) => [k, v * factor])) as SymbolSizes
}

export function polylineLength(points: Point[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += len(sub(points[i] as Point, points[i - 1] as Point))
  return total
}

/**
 * A dash pattern stretched so a line of `length` starts and ends with a whole dash (as OCAD and Purple
 * Pen draw dashed lines): n dashes and n − 1 gaps. A closed outline has as many gaps as dashes. A line
 * shorter than one dash is drawn solid.
 */
export function fittedDash(length: number, dash: number, gap: number, closed = false): number[] | undefined {
  if (length <= dash) return undefined
  const n = Math.max(1, Math.round((length + (closed ? 0 : gap)) / (dash + gap)))
  const k = length / (n * dash + (closed ? n : n - 1) * gap)
  return [dash * k, gap * k]
}

/** Map frame metres -> print paper mm at a print scale. */
export const toPaperMm = ([x, y]: Point, printScale: number): Point => [(x * 1000) / printScale, (y * 1000) / printScale]

const sub = ([ax, ay]: Point, [bx, by]: Point): Point => [ax - bx, ay - by]
const len = ([x, y]: Point) => Math.hypot(x, y)
const unit = (v: Point): Point => {
  const l = len(v)
  return l === 0 ? [0, 1] : [v[0] / l, v[1] / l]
}
const along = (p: Point, dir: Point, d: number): Point => [p[0] + dir[0] * d, p[1] + dir[1] * d]

/**
 * How far from its centre a course line stops at a stop of this kind (so it ends at the symbol's edge
 * plus the gap). Lines meet a marked route's ends and the map issue point's bar directly.
 */
export function clearance(kind: string, s: SymbolSizes): number {
  if (kind === 'markedRoute' || kind === 'mapIssue') return 0
  if (kind === 'start') return s.startSide / Math.sqrt(3) + s.legGap
  if (kind === 'finish') return s.finishOuter / 2 + s.legGap
  if (kind === 'control') return s.controlDiameter / 2 + s.legGap
  return s.crossingClearance
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

/** A polyline with the first `d` mm of its length cut off (nothing when `d` is not positive). */
function trimStart(points: Point[], d: number): Point[] {
  if (d <= 0) return points
  let rest = d
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point
    const b = points[i] as Point
    const l = len(sub(b, a))
    if (rest < l) return [along(a, unit(sub(b, a)), rest), ...points.slice(i)]
    rest -= l
  }
  return []
}
const trimEnd = (points: Point[], d: number): Point[] => trimStart([...points].reverse(), d).reverse()

/** A marked route (707): dashed, starting and ending with a whole dash. */
function markedLine(points: Point[], s: SymbolSizes, tag: { role: 'leg' | 'symbol'; owner?: string }): Primitive {
  const dash = fittedDash(polylineLength(points), s.markedDash, s.markedGap)
  return { type: 'polyline', points, lineWidth: s.lineWidth, closed: false, ...(dash ? { dash } : {}), ...tag }
}

/** The map issue point (702): a bar across the way it leads, `dir`. */
function mapIssueBar(center: Point, dir: Point, s: SymbolSizes, owner: string): Primitive {
  const across: Point = [-dir[1], dir[0]]
  return {
    type: 'polyline',
    points: [along(center, across, -s.mapIssueLength / 2), along(center, across, s.mapIssueLength / 2)],
    lineWidth: s.mapIssueWidth,
    closed: false,
    role: 'symbol',
    owner,
  }
}

/**
 * A crossing point (710): two curved lines on either side of the course line, along the leg direction
 * `dir`, closest together in the middle where the course passes through, like an hourglass ")(".
 * Also drawn for a voluntary crossing point, along the way through it.
 */
export function crossing(center: Point, dir: Point, s: SymbolSizes, owner: string, role: 'symbol' | 'special' = 'symbol'): Primitive[] {
  const normal: Point = [-dir[1], dir[0]]
  // Local (along the leg, across it) -> paper mm.
  const at = (u: number, v: number): [number, number] => {
    const p = along(along(center, dir, u), normal, v)
    return [p[0], p[1]]
  }
  return [1, -1].map(side => {
    const h = s.crossingHalfLength
    return {
      type: 'path',
      commands: [
        ['M', ...at(-h, side * s.crossingEnd)],
        [
          'C',
          ...at(-s.crossingHandle, side * s.crossingWaist),
          ...at(s.crossingHandle, side * s.crossingWaist),
          ...at(h, side * s.crossingEnd),
        ],
      ],
      lineWidth: s.crossingLineWidth,
      role,
      owner,
    } as const
  })
}

/** Width of a number's digits relative to their height (Arial digits advance 0.556 em, digits are 0.719 em high). */
const DIGIT_WIDTH = 0.556 / 0.719

/**
 * Where to put a control number automatically: in the direction around the circle farthest from the
 * course lines, with the digits' box `numberGap` from the circle's outer edge.
 */
function numberPosition(center: Point, legDirections: Point[], s: SymbolSizes, text: string): Point {
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
  const halfWidth = (s.numberHeight * DIGIT_WIDTH * text.length) / 2
  const halfHeight = s.numberHeight / 2
  const reach = Math.abs(best[0]) * halfWidth + Math.abs(best[1]) * halfHeight // the box's extent towards the circle
  return along(center, best, s.controlDiameter / 2 + s.lineWidth / 2 + s.numberGap + reach)
}

/** All symbols of one course, in print paper mm at the course's print scale. */
export function courseDrawing(doc: EventDoc, course: Course): Primitive[] {
  if (course.id === ALL_CONTROLS) return allControlsDrawing(doc, course.printScale)
  const s = symbolSizes(doc.standard, course.printScale)
  const stops = courseStops(doc, course)
  const paper = (p: Point) => toPaperMm(p, course.printScale)
  const control = (i: number) => controlById(doc, course.controls[i] as string)
  const at = (i: number) => paper(control(i).position)
  // Each leg runs from where the course leaves one stop to where it reaches the next (a marked route's
  // last and first points).
  const path = (i: number): Point[] => {
    const from = course.controls[i] as string
    const to = course.controls[i + 1] as string
    return [paper(exitPoint(control(i))), ...(course.bends[legKey(from, to)] ?? []).map(paper), paper(entryPoint(control(i + 1)))]
  }
  const out: Primitive[] = []

  // Course lines, cut back at both ends to the symbols' edges. The way from the map issue point to the
  // start is a marked route (702: "if there is a marked route to the start"), dashed.
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
    if (stops[i]?.kind === 'mapIssue') out.push(markedLine(points, s, { role: 'leg' }))
    else out.push({ type: 'polyline', points, lineWidth: s.lineWidth, closed: false, role: 'leg' })
  }

  // A control visited more than once is drawn once, at its first visit, with every visit's number ("3/8")
  // placed away from the legs of all of them.
  const visits = new Map<string, number[]>()
  stops.forEach((stop, i) => {
    if (stop.kind === 'control') visits.set(stop.controlId, [...(visits.get(stop.controlId) ?? []), i])
  })
  const legsAt = (i: number): Point[] => {
    const p = at(i)
    const next = i + 1 < stops.length ? path(i)[1] : undefined
    const prev = i > 0 ? path(i - 1).at(-2) : undefined
    return [next, prev].filter((q): q is Point => q !== undefined).map(q => unit(sub(q, p)))
  }

  stops.forEach((stop, i) => {
    const p = at(i)
    const owner = stop.controlId
    const tag = { role: 'symbol', owner } as const
    const next = i + 1 < stops.length ? path(i)[1] : undefined
    const prev = i > 0 ? path(i - 1).at(-2) : undefined
    if (stop.kind === 'markedRoute') {
      // Dashed along its line; where it starts or ends inside the stop before or after it, cut back to
      // that symbol's edge.
      let route = (control(i).route ?? []).map(paper)
      const before = i > 0 ? { kind: stops[i - 1]?.kind ?? '', at: paper(exitPoint(control(i - 1))) } : null
      const after = i + 1 < stops.length ? { kind: stops[i + 1]?.kind ?? '', at: paper(entryPoint(control(i + 1))) } : null
      if (before) route = trimStart(route, clearance(before.kind, s) - len(sub(route[0] as Point, before.at)))
      if (after && route.length) route = trimEnd(route, clearance(after.kind, s) - len(sub(route.at(-1) as Point, after.at)))
      if (route.length >= 2) out.push(markedLine(route, s, tag))
    } else if (stop.kind === 'mapIssue') {
      out.push(mapIssueBar(p, next ? unit(sub(next, p)) : [0, 1], s, owner))
    } else if (stop.kind === 'start') {
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
      const all = visits.get(owner) ?? [i]
      if (all[0] !== i) return
      out.push({ type: 'circle', center: p, radius: s.controlDiameter / 2, lineWidth: s.lineWidth, ...tag })
      const text = all.map(v => stops[v]?.number).join('/')
      // A number the setter moved keeps its place relative to the control (in paper mm).
      const moved = course.numberPositions[owner]
      const numberAt = moved ? ([p[0] + moved[0], p[1] + moved[1]] as Point) : numberPosition(p, all.flatMap(legsAt), s, text)
      out.push({ type: 'text', at: numberAt, text, height: s.numberHeight, role: 'number', owner })
    }
  })
  return out
}

/** How far the white outline round a control number reaches beyond its strokes, paper mm. */
export const NUMBER_OUTLINE = 0.25

/**
 * White outlines of the control numbers among `primitives`: drawn under the course (in normal blend, as
 * white would vanish with Multiply) when the event has them (`EventDoc.numberOutline`).
 */
export function numberOutlines(primitives: Primitive[]): Primitive[] {
  return primitives.flatMap((p): Primitive[] =>
    p.type === 'text' && p.role === 'number' ? [{ ...p, outline: NUMBER_OUTLINE, color: '#ffffff', opacity: 1 }] : [],
  )
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
    if (c.kind === 'markedRoute')
      return [
        markedLine(
          (c.route ?? []).map(q => toPaperMm(q, printScale)),
          s,
          tag,
        ),
      ]
    if (c.kind === 'mapIssue') {
      // Across the way to the nearest start.
      const starts = doc.controls.filter(x => x.kind === 'start').map(x => toPaperMm(x.position, printScale))
      const nearest = starts.sort((a, b) => len(sub(a, p)) - len(sub(b, p)))[0]
      return [mapIssueBar(p, nearest ? unit(sub(nearest, p)) : [0, 1], s, c.id)]
    }
    return [
      { type: 'circle', center: p, radius: s.controlDiameter / 2, lineWidth: s.lineWidth, ...tag },
      {
        type: 'text',
        at: numberPosition(p, [], s, String(c.code)),
        text: String(c.code),
        height: s.numberHeight,
        role: 'number',
        owner: c.id,
      },
    ]
  })
}

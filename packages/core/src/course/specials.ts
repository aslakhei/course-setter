// Special course planning symbols (ISOM 2017-2 3.7, ISSprOM 2019-2 4.7) as drawing primitives in print
// paper mm, sized like the course symbols: given at 1:15 000 (forest) or 1:4 000 (sprint) and enlarged in
// proportion at larger print scales. Where the specifications' drawings leave a detail open (the
// refreshment cup's curves, the first aid cross), the shapes follow Purple Pen's (BSD licence, see
// THIRD-PARTY-NOTICES.md).
import type { PathCommand, Primitive } from '../render/primitives.ts'
import { type EventDoc, type Point, type Special, type Standard, specialShownOn } from './doc.ts'
import { crossing, fittedDash, polylineLength, symbolSizes, toPaperMm } from './symbols.ts'

export type SpecialSizes = {
  /** Out-of-bounds boundary (708). */
  oobBoundaryWidth: number
  /** Out-of-bounds area (709): lines at 45° and 135°, and the optional boundary line. */
  hatchWidth: number
  hatchSpacing: number
  areaEdgeWidth: number
  areaEdgeDash: number
  areaEdgeGap: number
  /** Out-of-bounds route (711): crosses along the route. */
  crossArm: number
  crossWidth: number
  crossSpacingMin: number
  crossSpacingMax: number
  /** Crossing section (710.2): two lines on either side, their ends bent outwards. */
  sectionWidth: number
  sectionSpacing: number
  sectionHook: number
  /** First aid post (712): a cross. */
  firstAidSize: number
  firstAidArm: number
  /** Refreshment point (713): a cup, line width. */
  cupWidth: number
  /** Temporary construction or closed area (714): outline, and the fill's share of full purple. */
  constructionEdgeWidth: number
  constructionTint: number
}

const COMMON = {
  hatchWidth: 0.2,
  hatchSpacing: 1.2,
  areaEdgeDash: 3.0,
  areaEdgeGap: 0.5,
  crossArm: 3.0,
  crossWidth: 0.35,
  crossSpacingMin: 4.0,
  crossSpacingMax: 6.0,
  sectionWidth: 0.35,
  sectionSpacing: 1.5,
  sectionHook: 0.4,
  firstAidSize: 4.0,
  firstAidArm: 4.0 / 3,
  cupWidth: 0.4,
  constructionEdgeWidth: 0.1,
  constructionTint: 0.5,
}

const BASE: Record<Standard, { scale: number; sizes: SpecialSizes }> = {
  isom: { scale: 15000, sizes: { ...COMMON, oobBoundaryWidth: 0.7, areaEdgeWidth: 0.25 } },
  // ISSprOM 2019-2 (revision 6): a wider boundary and area edge.
  issprom: { scale: 4000, sizes: { ...COMMON, oobBoundaryWidth: 1.0, areaEdgeWidth: 0.4 } },
}

export function specialSizes(standard: Standard, printScale: number): SpecialSizes {
  const { scale, sizes } = BASE[standard]
  const factor = Math.max(1, scale / printScale)
  return Object.fromEntries(Object.entries(sizes).map(([k, v]) => [k, k === 'constructionTint' ? v : v * factor])) as SpecialSizes
}

const sub = ([ax, ay]: Point, [bx, by]: Point): Point => [ax - bx, ay - by]
const add = ([ax, ay]: Point, [bx, by]: Point): Point => [ax + bx, ay + by]
const scale = ([x, y]: Point, k: number): Point => [x * k, y * k]
const len = ([x, y]: Point) => Math.hypot(x, y)
const unit = (v: Point): Point => {
  const l = len(v)
  return l === 0 ? [1, 0] : [v[0] / l, v[1] / l]
}
const normal = ([x, y]: Point): Point => [-y, x]

/** The point `distance` along a polyline, and the direction there. */
function pointAlong(points: Point[], distance: number): { at: Point; dir: Point } {
  let rest = distance
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point
    const b = points[i] as Point
    const l = len(sub(b, a))
    if (rest <= l || i === points.length - 1) {
      const dir = unit(sub(b, a))
      return { at: add(a, scale(dir, Math.min(rest, l))), dir }
    }
    rest -= l
  }
  return { at: points[0] ?? [0, 0], dir: [1, 0] }
}

/** A polyline moved `offset` to its left (negative: right), with mitred corners. */
function offsetPolyline(points: Point[], offset: number): Point[] {
  return points.map((p, i) => {
    const before = i > 0 ? unit(sub(p, points[i - 1] as Point)) : undefined
    const after = i + 1 < points.length ? unit(sub(points[i + 1] as Point, p)) : undefined
    if (!before) return add(p, scale(normal(after ?? [1, 0]), offset))
    if (!after) return add(p, scale(normal(before), offset))
    const n = unit(add(normal(before), normal(after)))
    const cos = n[0] * normal(before)[0] + n[1] * normal(before)[1]
    return add(p, scale(n, offset / Math.max(0.2, cos)))
  })
}

/**
 * Parallel lines at `angle` (radians from the x axis) `spacing` apart, clipped to the inside of a polygon
 * (even-odd). Lines lie on a grid fixed to the paper origin, so neighbouring areas line up.
 */
export function hatchLines(polygon: Point[], angle: number, spacing: number): [Point, Point][] {
  const [c, s] = [Math.cos(angle), Math.sin(angle)]
  // Rotate so the lines run along u: (u, v) = (x·c + y·s, −x·s + y·c).
  const local = polygon.map(([x, y]): Point => [x * c + y * s, -x * s + y * c])
  const vs = local.map(p => p[1])
  const out: [Point, Point][] = []
  for (let k = Math.ceil(Math.min(...vs) / spacing); k * spacing <= Math.max(...vs); k++) {
    const v = k * spacing
    const us: number[] = []
    local.forEach((a, i) => {
      const b = local[(i + 1) % local.length] as Point
      // Half-open so a line through a vertex counts it once.
      if (a[1] <= v !== b[1] <= v) us.push(a[0] + ((v - a[1]) / (b[1] - a[1])) * (b[0] - a[0]))
    })
    us.sort((x, y) => x - y)
    for (let i = 0; i + 1 < us.length; i += 2) {
      const back = (u: number): Point => [u * c - v * s, u * s + v * c]
      out.push([back(us[i] as number), back(us[i + 1] as number)])
    }
  }
  return out
}

/** Drawing commands of a closed polygon. */
const ring = (points: Point[]): PathCommand[] => [...points.map((p, i): PathCommand => [i === 0 ? 'M' : 'L', p[0], p[1]]), ['Z']]

/** A quarter circle of radius `size` continuing a line that ends at `from` heading `dir`, turning towards `out`. */
function hook(from: Point, dir: Point, out: Point, size: number): PathCommand {
  const k = KAPPA * size
  const end = add(add(from, scale(dir, size)), scale(out, size))
  return ['C', ...add(from, scale(dir, k)), ...sub(end, scale(out, k)), ...end] as PathCommand
}

/** The same quarter circle at a line's start: from the bent end back to the line's first point `to`. */
function hookIn(to: Point, dir: Point, out: Point, size: number): { start: Point; curve: PathCommand } {
  const k = KAPPA * size
  const start = add(sub(to, scale(dir, size)), scale(out, size))
  return { start, curve: ['C', ...sub(start, scale(out, k)), ...sub(to, scale(dir, k)), ...to] as PathCommand }
}

// Refreshment cup (713), from Purple Pen (CourseObject.cs, 2017 coordinates), centred on the point.
const KAPPA = 0.5522847498
const [AX, AY, BX, BY] = [KAPPA * 1.55, KAPPA * 0.35, KAPPA * 0.85, KAPPA * 0.15]
const GX = BY * 0.23
const CUP: PathCommand[][] = [
  [
    ['M', 1.55, 1.071],
    ['C', 1.55, 1.071 + AY, AX, 1.421, 0, 1.421],
    ['C', -AX, 1.421, -1.55, 1.071 + AY, -1.55, 1.071],
    ['C', -1.55, 1.071 - AY, -AX, 0.721, 0, 0.721],
    ['C', AX, 0.721, 1.55, 1.071 - AY, 1.55, 1.071],
  ],
  [
    ['M', 0.85, -1.529],
    ['C', 0.85 - GX, -1.529 - BY, BX, -1.679, 0, -1.679],
    ['C', -BX, -1.679, -0.85 + GX, -1.529 - BY, -0.85, -1.529],
  ],
  [
    ['M', 1.55, 1.071],
    ['L', 0.85, -1.529],
  ],
  [
    ['M', -1.55, 1.071],
    ['L', -0.85, -1.529],
  ],
]

/** The cup and cross are drawn at 1:15 000 sizes; scaled to `k` × those sizes and moved to `at`. */
function placed(commands: PathCommand[], at: Point, k: number): PathCommand[] {
  return commands.map((c): PathCommand => {
    if (c[0] === 'Z') return c
    if (c[0] === 'C')
      return ['C', at[0] + c[1] * k, at[1] + c[2] * k, at[0] + c[3] * k, at[1] + c[4] * k, at[0] + c[5] * k, at[1] + c[6] * k]
    return [c[0], at[0] + c[1] * k, at[1] + c[2] * k]
  })
}

/** One special symbol in print paper mm at `printScale`. */
export function specialDrawing(doc: EventDoc, special: Special, printScale: number): Primitive[] {
  const s = specialSizes(doc.standard, printScale)
  const pts = special.points.map(p => toPaperMm(p, printScale))
  const tag = { role: 'special', owner: special.id } as const
  const first = pts[0] as Point
  const line = (points: Point[], lineWidth: number, dash?: number[]): Primitive => ({
    type: 'polyline',
    points,
    lineWidth,
    closed: false,
    ...(dash ? { dash } : {}),
    ...tag,
  })

  switch (special.kind) {
    case 'optionalCrossing': {
      // The crossing point symbol, along the way through it (from its point towards the second).
      const dir = unit(sub(pts[1] as Point, first))
      return crossing(first, dir, symbolSizes(doc.standard, printScale), special.id, 'special')
    }
    case 'oobBoundary':
      return [line(pts, s.oobBoundaryWidth)]
    case 'oobArea': {
      const hatch = [Math.PI / 4, (3 * Math.PI) / 4].flatMap(a => hatchLines(pts, a, s.hatchSpacing))
      const out: Primitive[] = [
        {
          type: 'path',
          commands: hatch.flatMap(([a, b]): PathCommand[] => [
            ['M', ...a],
            ['L', ...b],
          ]),
          lineWidth: s.hatchWidth,
          ...tag,
        },
      ]
      const boundary = special.boundary ?? 'solid'
      if (boundary !== 'none') {
        const outline = [...pts, first]
        const dash = boundary === 'dashed' ? fittedDash(polylineLength(outline), s.areaEdgeDash, s.areaEdgeGap, true) : undefined
        out.push({ type: 'polyline', points: pts, lineWidth: s.areaEdgeWidth, closed: true, ...(dash ? { dash } : {}), ...tag })
      }
      return out
    }
    case 'oobRoute': {
      // Crosses from end to end, as close to the middle of the allowed spacing as fits.
      const length = polylineLength(pts)
      const ideal = (s.crossSpacingMin + s.crossSpacingMax) / 2
      const n = Math.max(1, Math.round(length / ideal))
      const arm = s.crossArm / 2
      return Array.from({ length: n + 1 }, (_, i) => {
        const { at, dir } = pointAlong(pts, (i * length) / n)
        const d1 = unit(add(dir, normal(dir)))
        const d2 = unit(sub(dir, normal(dir)))
        return {
          type: 'path',
          commands: [
            ['M', ...sub(at, scale(d1, arm))],
            ['L', ...add(at, scale(d1, arm))],
            ['M', ...sub(at, scale(d2, arm))],
            ['L', ...add(at, scale(d2, arm))],
          ],
          lineWidth: s.crossWidth,
          ...tag,
        } satisfies Primitive
      })
    }
    case 'crossingSection':
      return [1, -1].map(side => {
        const p = offsetPolyline(pts, (side * s.sectionSpacing) / 2)
        const startDir = unit(sub(p[1] as Point, p[0] as Point))
        const endDir = unit(sub(p.at(-1) as Point, p.at(-2) as Point))
        const outStart = scale(normal(startDir), side)
        const outEnd = scale(normal(endDir), side)
        // Each line's ends bend outwards, away from the other line.
        const begin = hookIn(p[0] as Point, startDir, outStart, s.sectionHook)
        return {
          type: 'path',
          commands: [
            ['M', ...begin.start],
            begin.curve,
            ...p.slice(1).map((q): PathCommand => ['L', ...q]),
            hook(p.at(-1) as Point, endDir, outEnd, s.sectionHook),
          ],
          lineWidth: s.sectionWidth,
          cap: 'round',
          join: 'round',
          ...tag,
        } satisfies Primitive
      })
    case 'firstAid': {
      const k = s.firstAidSize / 4 // drawn at 4 mm
      const a = (s.firstAidArm / k) * 0.5
      const cross: Point[] = [
        [-a, 2],
        [a, 2],
        [a, a],
        [2, a],
        [2, -a],
        [a, -a],
        [a, -2],
        [-a, -2],
        [-a, -a],
        [-2, -a],
        [-2, a],
        [-a, a],
      ]
      return [{ type: 'path', commands: placed(ring(cross), first, k), lineWidth: 0, filled: true, ...tag }]
    }
    case 'refreshment': {
      const k = s.cupWidth / 0.4 // drawn at 1:15 000
      return CUP.map(commands => ({
        type: 'path',
        commands: placed(commands, first, k),
        lineWidth: s.cupWidth,
        cap: 'round',
        join: 'round',
        ...tag,
      }))
    }
    case 'temporaryConstruction':
      return [
        { type: 'path', commands: ring(pts), lineWidth: 0, filled: true, tint: s.constructionTint, ...tag },
        { type: 'polyline', points: pts, lineWidth: s.constructionEdgeWidth, closed: true, ...tag },
      ]
  }
}

/** Every special symbol shown on a course (or, with null, all of them), at `printScale`. */
export function specialsDrawing(doc: EventDoc, courseId: string | null, printScale: number): Primitive[] {
  return doc.specials.filter(s => specialShownOn(s, courseId)).flatMap(s => specialDrawing(doc, s, printScale))
}

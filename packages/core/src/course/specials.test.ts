import { describe, expect, it } from 'vitest'
import { descriptionSheet } from '../descriptions/sheet.ts'
import type { Primitive } from '../render/primitives.ts'
import { IDENTITY } from '../similarity.ts'
import {
  addSpecial,
  deleteControl,
  deleteCourse,
  deleteSpecial,
  setMarkedRoute,
  setSpecialBoundary,
  setSpecialCourses,
  setSpecialPoints,
} from './commands.ts'
import { CourseError, courseById, type EventDoc, eventDocSchema, type Point, type SpecialKind, specialShownOn } from './doc.ts'
import { moveDocToVersion } from './move.ts'
import { hatchLines, specialDrawing, specialSizes, specialsDrawing } from './specials.ts'
import { testEvent } from './test-doc.ts'

// At 1:15 000 one paper mm is 15 m: shapes are given in metres = 15 × paper mm.
const M = 15
const mm = (points: Point[]): Point[] => points.map(([x, y]) => [x * M, y * M])

function drawn(kind: SpecialKind, points: Point[], doc: EventDoc = testEvent(), printScale = 15000): Primitive[] {
  const withSpecial = addSpecial(doc, { id: 'x', kind, points: mm(points) })
  return specialDrawing(withSpecial, withSpecial.specials.at(-1) as EventDoc['specials'][number], printScale)
}

const error = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    return e instanceof CourseError ? e.code : e
  }
  return null
}
const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])
const ends = (p: Primitive): Point[] =>
  p.type === 'polyline' ? p.points : p.type === 'path' ? p.commands.flatMap(c => (c[0] === 'Z' ? [] : [[c.at(-2), c.at(-1)] as Point])) : []

describe('special symbol sizes', () => {
  it('follow the specifications and grow with larger print scales like the course symbols', () => {
    expect(specialSizes('isom', 15000)).toMatchObject({ oobBoundaryWidth: 0.7, areaEdgeWidth: 0.25, hatchSpacing: 1.2, hatchWidth: 0.2 })
    expect(specialSizes('issprom', 4000)).toMatchObject({ oobBoundaryWidth: 1.0, areaEdgeWidth: 0.4 })
    expect(specialSizes('isom', 10000).oobBoundaryWidth).toBeCloseTo(1.05, 9) // 150 %
    expect(specialSizes('isom', 10000).constructionTint).toBe(0.5) // a share, not a size
  })
})

describe('specialDrawing', () => {
  it('702: a 2.5 × 0.6 mm bar across the way to the nearest start', () => {
    // The start is at (0, 0); the map issue point 10 mm east of it: the bar runs north-south.
    const [bar] = drawn('mapIssue', [[10, 0]])
    expect(bar).toMatchObject({ type: 'polyline', lineWidth: 0.6 })
    const [a, b] = ends(bar as Primitive) as [Point, Point]
    expect(dist(a, b)).toBeCloseTo(2.5, 9)
    expect(a[0]).toBeCloseTo(10, 9)
    expect(b[0]).toBeCloseTo(10, 9)
  })

  it('707: a free marked route is dashed 2.0 / 0.5 mm, 0.35 mm wide, with whole dashes at both ends', () => {
    const [route] = drawn('markedRoute', [
      [0, 0],
      [22, 0],
    ])
    expect(route).toMatchObject({ lineWidth: 0.35, dash: [2, 0.5] }) // 22 = 9 dashes + 8 gaps exactly
  })

  it('708: out-of-bounds boundary 0.7 mm (forest), 1.0 mm (sprint)', () => {
    const line: Point[] = [
      [0, 0],
      [10, 0],
    ]
    expect(drawn('oobBoundary', line)[0]).toMatchObject({ lineWidth: 0.7 })
    const sprint = { ...testEvent(), standard: 'issprom' as const }
    expect(
      drawn(
        'oobBoundary',
        line.map(([x, y]) => [(x * 4) / 15, y]),
        sprint,
        4000,
      )[0],
    ).toMatchObject({ lineWidth: 1.0 })
  })

  it('709: cross-hatched at 45° and 135°, 0.2 mm lines 1.2 mm apart, inside the area only, with a 0.25 mm edge', () => {
    const square: Point[] = [
      [0, 0],
      [12, 0],
      [12, 12],
      [0, 12],
    ]
    const [hatch, edge] = drawn('oobArea', square)
    expect(hatch).toMatchObject({ type: 'path', lineWidth: 0.2 })
    expect(edge).toMatchObject({ type: 'polyline', closed: true, lineWidth: 0.25 })
    expect(edge).not.toHaveProperty('dash')
    const commands = hatch?.type === 'path' ? hatch.commands : []
    const segments: [Point, Point][] = []
    for (let i = 0; i + 1 < commands.length; i += 2) {
      const [m, l] = [commands[i], commands[i + 1]] as [['M', number, number], ['L', number, number]]
      segments.push([
        [m[1], m[2]],
        [l[1], l[2]],
      ])
    }
    for (const [a, b] of segments) {
      // Diagonal, with both ends on the square's edge.
      expect(Math.abs(Math.abs(b[0] - a[0]) - Math.abs(b[1] - a[1]))).toBeLessThan(1e-9)
      for (const [x, y] of [a, b]) {
        expect(x).toBeGreaterThan(-1e-9)
        expect(x).toBeLessThan(12 + 1e-9)
        expect(Math.min(x, y, 12 - x, 12 - y)).toBeLessThan(1e-9)
      }
    }
    // Lines of one direction lie 1.2 mm apart: the distance of each line from the origin, across it, is a
    // multiple of 1.2 (so neighbouring areas line up). The square's diagonal (17 mm) holds 14–15 of each.
    const across = ([a, b]: [Point, Point]) => {
      const rising = Math.sign(b[0] - a[0]) === Math.sign(b[1] - a[1])
      return rising ? (a[1] - a[0]) / Math.SQRT2 : (a[0] + a[1]) / Math.SQRT2
    }
    for (const s of segments) {
      const k = across(s) / 1.2
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9)
    }
    const rising = segments.filter(([a, b]) => Math.sign(b[0] - a[0]) === Math.sign(b[1] - a[1]))
    expect(rising.length).toBeGreaterThanOrEqual(14)
    expect(segments.length - rising.length).toBeGreaterThanOrEqual(14)
  })

  it('709: a dashed edge (3.0 / 0.5 mm) or none, and a 0.4 mm edge on sprint maps', () => {
    let doc = addSpecial(testEvent(), {
      id: 'x',
      kind: 'oobArea',
      points: mm([
        [0, 0],
        [14, 0],
        [14, 14],
        [0, 14],
      ]),
    })
    doc = setSpecialBoundary(doc, 'x', 'dashed')
    const dashed = specialDrawing(doc, doc.specials[0] as EventDoc['specials'][number], 15000)[1]
    expect(dashed).toMatchObject({ lineWidth: 0.25, dash: [3, 0.5] }) // 56 mm = 16 × 3.5
    doc = setSpecialBoundary(doc, 'x', 'none')
    expect(specialDrawing(doc, doc.specials[0] as EventDoc['specials'][number], 15000)).toHaveLength(1)
    expect(doc.specials[0]?.boundary).toBe('none')
    expect(setSpecialBoundary(doc, 'x', 'solid').specials[0]).not.toHaveProperty('boundary')
    const sprint = { ...testEvent(), standard: 'issprom' as const }
    expect(
      drawn(
        'oobArea',
        [
          [0, 0],
          [3, 0],
          [3, 3],
        ],
        sprint,
        4000,
      )[1],
    ).toMatchObject({ lineWidth: 0.4 })
  })

  it('hatches concave areas in pieces', () => {
    // An L shape: a horizontal line through both arms is cut into two pieces.
    const l: Point[] = [
      [0, 0],
      [10, 0],
      [10, 4],
      [4, 4],
      [4, 10],
      [0, 10],
    ]
    const lines = hatchLines(l, 0, 1)
    expect(lines.filter(([a]) => a[1] === 2)).toHaveLength(1) // below the notch: one piece across
    expect(lines.filter(([a]) => a[1] === 7)).toHaveLength(1)
    const across = hatchLines(l, Math.PI / 2, 1).filter(([a]) => a[0] === 2)
    expect(across).toHaveLength(1)
    expect(dist(...(across[0] as [Point, Point]))).toBeCloseTo(10, 9)
  })

  it('711: crosses with 3.0 mm arms and 0.35 mm lines, 4–6 mm apart, from end to end', () => {
    const crosses = drawn('oobRoute', [
      [0, 0],
      [30, 0],
    ])
    expect(crosses).toHaveLength(7) // 30 mm / 5 mm
    for (const c of crosses) {
      expect(c).toMatchObject({ type: 'path', lineWidth: 0.35 })
      const [a, b, d, e] = ends(c) as [Point, Point, Point, Point]
      expect(dist(a, b)).toBeCloseTo(3.0, 9)
      expect(dist(d, e)).toBeCloseTo(3.0, 9)
    }
    const centres = crosses.map(c => {
      const [a, b] = ends(c) as [Point, Point]
      return (a[0] + b[0]) / 2
    })
    expect(centres[0]).toBeCloseTo(0, 9)
    expect(centres.at(-1)).toBeCloseTo(30, 9)
    for (let i = 1; i < centres.length; i++) {
      const gap = (centres[i] as number) - (centres[i - 1] as number)
      expect(gap).toBeGreaterThanOrEqual(4)
      expect(gap).toBeLessThanOrEqual(6)
    }
  })

  it('710.2: two 0.35 mm lines 1.5 mm apart along the crossing, their ends bent outwards', () => {
    const sprint = { ...testEvent(), standard: 'issprom' as const }
    // 1:4 000: one paper mm is 4 m.
    const lines = drawn(
      'crossingSection',
      [
        [0, 0],
        [10 * (4 / 15), 0],
      ],
      sprint,
      4000,
    )
    expect(lines).toHaveLength(2)
    const ys = lines.map(l => (l.type === 'path' ? (l.commands[1] as ['C', ...number[]]).at(-1) : 0) as number)
    expect(Math.abs((ys[0] ?? 0) - (ys[1] ?? 0))).toBeCloseTo(1.5, 9)
    for (const l of lines) expect(l).toMatchObject({ lineWidth: 0.35 })
    // The bent ends lie further out than the straight part.
    const [first] = lines
    const start = first?.type === 'path' ? (first.commands[0] as ['M', number, number])[2] : 0
    expect(Math.abs(start)).toBeGreaterThan(0.75)
  })

  it('712: a filled cross 4.0 × 4.0 mm with 1.33 mm arms', () => {
    const [cross] = drawn('firstAid', [[20, 20]])
    expect(cross).toMatchObject({ type: 'path', filled: true })
    const pts = ends(cross as Primitive)
    const xs = pts.map(p => p[0])
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4.0, 9)
    expect(pts.some(([x, y]) => Math.abs(x - 20 - 2 / 3) < 1e-9 && Math.abs(y - 22) < 1e-9)).toBe(true)
  })

  it('713: a cup 3.5 mm wide and high, 2.1 mm at the bottom, drawn with 0.4 mm lines', () => {
    const cup = drawn('refreshment', [[0, 20]])
    for (const p of cup) expect(p).toMatchObject({ lineWidth: 0.4 })
    const pts = cup.flatMap(ends)
    const xs = pts.map(p => p[0])
    const ys = pts.map(p => p[1])
    expect(Math.max(...xs) - Math.min(...xs) + 0.4).toBeCloseTo(3.5, 9)
    expect(Math.max(...ys) - Math.min(...ys) + 0.4).toBeCloseTo(3.5, 9)
    const bottom = pts.filter(p => Math.abs(p[1] - (20 - 1.529)) < 1e-9).map(p => p[0])
    expect(Math.max(...bottom) - Math.min(...bottom) + 0.4).toBeCloseTo(2.1, 9)
  })

  it('714: a 50 % fill with a 0.1 mm outline', () => {
    const sprint = { ...testEvent(), standard: 'issprom' as const }
    const [fill, edge] = drawn(
      'temporaryConstruction',
      [
        [0, 0],
        [2, 0],
        [2, 2],
      ],
      sprint,
      4000,
    )
    expect(fill).toMatchObject({ type: 'path', filled: true, tint: 0.5 })
    expect(edge).toMatchObject({ type: 'polyline', closed: true, lineWidth: 0.1 })
  })
})

describe('special symbol commands', () => {
  it('checks the number of points each kind needs', () => {
    expect(error(() => addSpecial(testEvent(), { id: 's1', kind: 'firstAid', points: [] }))).toBe('invalid_special')
    expect(
      error(() =>
        addSpecial(testEvent(), {
          id: 's1',
          kind: 'firstAid',
          points: [
            [0, 0],
            [1, 1],
          ],
        }),
      ),
    ).toBe('invalid_special')
    expect(error(() => addSpecial(testEvent(), { id: 's1', kind: 'oobBoundary', points: [[0, 0]] }))).toBe('invalid_special')
    expect(
      error(() =>
        addSpecial(testEvent(), {
          id: 's1',
          kind: 'oobArea',
          points: [
            [0, 0],
            [1, 1],
          ],
        }),
      ),
    ).toBe('invalid_special')
    expect(error(() => addSpecial(testEvent(), { id: 'a', kind: 'firstAid', points: [[0, 0]] }))).toBe('invalid_special') // a control's id
    const doc = addSpecial(testEvent(), {
      id: 's1',
      kind: 'oobArea',
      points: [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
    })
    expect(error(() => setSpecialPoints(doc, 's1', [[0, 0]]))).toBe('invalid_special')
    expect(
      setSpecialPoints(doc, 's1', [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ]).specials[0]?.points,
    ).toHaveLength(4)
    expect(deleteSpecial(doc, 's1').specials).toEqual([])
    expect(error(() => deleteSpecial(doc, 'nope'))).toBe('unknown_special')
  })

  it('shows a special on every course, or on the chosen ones; a deleted course leaves the list', () => {
    let doc = addSpecial(testEvent(), { id: 's1', kind: 'firstAid', points: [[0, 0]] })
    expect(specialsDrawing(doc, 'A', 15000)).toHaveLength(1)
    doc = setSpecialCourses(doc, 's1', ['B'])
    const s = doc.specials[0] as EventDoc['specials'][number]
    expect([specialShownOn(s, 'A'), specialShownOn(s, 'B'), specialShownOn(s, null)]).toEqual([false, true, true])
    expect(specialsDrawing(doc, 'A', 15000)).toHaveLength(0)
    expect(error(() => setSpecialCourses(doc, 's1', ['nope']))).toBe('unknown_course')
    expect(deleteCourse(doc, 'B').specials[0]?.courses).toEqual([])
    expect(setSpecialCourses(doc, 's1', null).specials[0]).not.toHaveProperty('courses')
  })

  it('marks a leg as a marked route and back; deleting a control drops its legs', () => {
    let doc = setMarkedRoute(testEvent(), 'A', 'a', 'b', true)
    doc = setMarkedRoute(doc, 'A', 'c', 'f', true)
    expect(courseById(doc, 'A').markedRoutes).toEqual(['a>b', 'c>f'])
    expect(courseById(setMarkedRoute(doc, 'A', 'a', 'b', false), 'A').markedRoutes).toEqual(['c>f'])
    expect(courseById(deleteControl(doc, 'b'), 'A').markedRoutes).toEqual(['c>f'])
    expect(courseById(setMarkedRoute(setMarkedRoute(doc, 'A', 'a', 'b', false), 'A', 'c', 'f', false), 'A')).not.toHaveProperty(
      'markedRoutes',
    )
  })

  it('moves specials with the event to a new map version, and keeps old documents valid', () => {
    const doc = addSpecial(testEvent(), {
      id: 's1',
      kind: 'oobBoundary',
      points: [
        [0, 0],
        [10, 0],
      ],
    })
    const shifted = moveDocToVersion(doc, { ...IDENTITY, tx: 100, ty: -50 }, { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 })
    expect(shifted.doc.specials[0]?.points).toEqual([
      [100, -50],
      [110, -50],
    ])
    const { specials: _s, ...old } = testEvent()
    expect(eventDocSchema.parse(old).specials).toEqual([])
    expect(eventDocSchema.parse(JSON.parse(JSON.stringify(setSpecialCourses(doc, 's1', ['A']))))).toEqual(
      setSpecialCourses(doc, 's1', ['A']),
    )
  })
})

describe('marked routes on the description sheet', () => {
  it('adds "follow the marked route" (13.2) after a marked leg, and 14.1 when the last leg is marked', () => {
    let doc = setMarkedRoute(testEvent(), 'A', 'a', 'b', true) // 600 m
    doc = setMarkedRoute(doc, 'A', 'c', 'f', true) // 1000 m
    const lines = descriptionSheet(doc, courseById(doc, 'A'), 'Club night')
    expect(lines.map(l => (l.kind === 'directive' ? `${l.symbol} ${l.text}` : l.kind === 'control' ? l.code || 'start' : l.kind))).toEqual([
      'title',
      'header',
      'start',
      '31',
      '13.2 600 m',
      '32',
      '33',
      '14.1 1000 m',
    ])
  })
})

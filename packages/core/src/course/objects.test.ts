// Marked routes and map issue points as stops on a course: length, drawing, description sheet, and
// documents saved before they were.
import { describe, expect, it } from 'vitest'
import { descriptionSheet } from '../descriptions/sheet.ts'
import type { Primitive } from '../render/primitives.ts'
import { IDENTITY } from '../similarity.ts'
import { addControl, insertCourseControl, moveControl, setRoute } from './commands.ts'
import { CourseError, courseById, type EventDoc, type Point, parseDoc, upgrade } from './doc.ts'
import { courseLength, legLengths } from './length.ts'
import { moveDocToVersion } from './move.ts'
import { courseDrawing, toPaperMm } from './symbols.ts'
import { testEvent } from './test-doc.ts'

// Course A: start s (0, 0) -> a (300, 400) -> b (300, 1000) -> c (900, 1000) -> finish f (900, 0): 2700 m.

/** Course A with a marked route `route` (ground metres) put in after stop `after`. */
function withRoute(route: Point[], after: string): EventDoc {
  let doc = addControl(testEvent(), { id: 'r', kind: 'markedRoute', position: route[0] as Point, route })
  doc = insertCourseControl(doc, 'A', 'r', courseById(doc, 'A').controls.indexOf(after) + 1)
  return doc
}

const sheet = (doc: EventDoc) =>
  descriptionSheet(doc, courseById(doc, 'A'), 'Night').map(l =>
    l.kind === 'directive' ? `${l.symbol} ${l.text}` : l.kind === 'control' ? l.code || 'start' : l.kind,
  )

const error = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    return e instanceof CourseError ? e.code : e
  }
  return null
}

describe('a marked route on a course', () => {
  // Between b and c, away from both: the course line runs to its start and on from its end.
  const detour: Point[] = [
    [400, 1000],
    [600, 1100],
    [800, 1000],
  ]

  it('is part of the length: legs to and from it, and the route itself', () => {
    const doc = withRoute(detour, 'b')
    const course = courseById(doc, 'A')
    expect(legLengths(doc, course).slice(2, 4)).toEqual([100, 100]) // b -> route start, route end -> c
    expect(courseLength(doc, course)).toBeCloseTo(2700 - 600 + 100 + 2 * Math.hypot(200, 100) + 100, 9)
  })

  it('is drawn dashed between solid course lines that end at its ends', () => {
    const drawing = courseDrawing(withRoute(detour, 'b'), courseById(withRoute(detour, 'b'), 'A'))
    const route = drawing.find(p => p.owner === 'r') as Extract<Primitive, { type: 'polyline' }>
    expect(route).toMatchObject({ type: 'polyline', lineWidth: 0.35 })
    expect(route.dash).toBeDefined()
    expect(route.points).toEqual(detour.map(p => toPaperMm(p, 15000)))
    const legs = drawing.filter((p): p is Extract<Primitive, { type: 'polyline' }> => p.role === 'leg' && p.type === 'polyline')
    expect(legs.every(l => !l.dash)).toBe(true)
    // The leg from b stops right at the route's start (no gap), and the next leg starts at its end.
    expect(legs.some(l => JSON.stringify(l.points.at(-1)) === JSON.stringify(toPaperMm([400, 1000], 15000)))).toBe(true)
    expect(legs.some(l => JSON.stringify(l.points[0]) === JSON.stringify(toPaperMm([800, 1000], 15000)))).toBe(true)
  })

  it('is cut back where it starts inside a control circle', () => {
    const doc = withRoute(
      [
        [300, 1000],
        [600, 1000],
      ],
      'b',
    )
    const route = courseDrawing(doc, courseById(doc, 'A')).find(p => p.owner === 'r') as Extract<Primitive, { type: 'polyline' }>
    const b = toPaperMm([300, 1000], 15000)
    expect((route.points[0]?.[0] ?? 0) - b[0]).toBeCloseTo(2.5 + 0.6, 9) // the circle's radius plus the gap
  })

  it('gets "follow the taped route X m" on the sheet: 13.1 from a control, 13.2 between controls or in a leg', () => {
    expect(sheet(withRoute(detour, 'b'))).toEqual(['title', 'header', 'start', '31', '32', '13.2 450 m', '33', '14.3 1000 m'])
    const fromB: Point[] = [
      [300, 1000],
      [600, 1000],
    ]
    expect(sheet(withRoute(fromB, 'b'))).toContain('13.1 300 m')
    const bToC: Point[] = [
      [300, 1000],
      [900, 1000],
    ]
    expect(sheet(withRoute(bToC, 'b'))).toContain('13.2 600 m')
  })

  it('becomes the finish line when it ends at the finish: 14.1 from the last control, otherwise 14.2', () => {
    // c (900, 1000) -> finish (900, 0).
    const fromC: Point[] = [
      [900, 1000],
      [900, 0],
    ]
    expect(sheet(withRoute(fromC, 'c')).slice(-2)).toEqual(['33', '14.1 1000 m'])
    const funnel: Point[] = [
      [900, 300],
      [900, 0],
    ]
    expect(sheet(withRoute(funnel, 'c')).slice(-2)).toEqual(['33', '14.2 1000 m'])
    // A tape that stops short of the finish keeps its own line, and the course navigates to the finish.
    const short: Point[] = [
      [900, 980], // 20 m from c: inside its circle
      [900, 500],
    ]
    expect(sheet(withRoute(short, 'c')).slice(-3)).toEqual(['33', '13.1 480 m', '14.3 1000 m'])
  })

  it('moves as a whole, takes a new line, and needs two points', () => {
    const doc = withRoute(detour, 'b')
    const moved = moveControl(doc, 'r', [410, 1000])
    expect(moved.controls.find(c => c.id === 'r')?.route?.[2]).toEqual([810, 1000])
    const reshaped = setRoute(doc, 'r', [
      [0, 0],
      [5, 5],
    ])
    expect(reshaped.controls.find(c => c.id === 'r')).toMatchObject({
      position: [0, 0],
      route: [
        [0, 0],
        [5, 5],
      ],
    })
    expect(error(() => setRoute(doc, 'r', [[0, 0]]))).toBe('invalid_special')
    expect(
      error(() =>
        setRoute(doc, 'a', [
          [0, 0],
          [1, 1],
        ]),
      ),
    ).toBe('invalid_special')
    expect(error(() => addControl(testEvent(), { id: 'q', kind: 'markedRoute', position: [0, 0] }))).toBe('invalid_special')
    const shifted = moveDocToVersion(doc, { ...IDENTITY, tx: 10, ty: 0 }, { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 })
    expect(shifted.doc.controls.find(c => c.id === 'r')?.route?.[0]).toEqual([410, 1000])
  })
})

describe('a map issue point on a course', () => {
  const withMapIssue = () => {
    let doc = addControl(testEvent(), { id: 'm', kind: 'mapIssue', position: [-300, 0] })
    doc = insertCourseControl(doc, 'A', 'm', 0)
    return doc
  }

  it('counts the way to the start in the length, and the sheet says how far it is (13.6) before the start', () => {
    const doc = withMapIssue()
    expect(courseLength(doc, courseById(doc, 'A'))).toBe(3000)
    expect(sheet(doc).slice(0, 4)).toEqual(['title', 'header', '13.6 300 m', 'start'])
  })

  it('draws the way to the start as a marked route, and its bar across that way', () => {
    const drawing = courseDrawing(withMapIssue(), courseById(withMapIssue(), 'A'))
    const toStart = drawing.find(p => p.role === 'leg') as Extract<Primitive, { type: 'polyline' }>
    expect(toStart.dash).toBeDefined()
    expect(toStart.points[0]).toEqual(toPaperMm([-300, 0], 15000)) // from the bar itself
    const bar = drawing.find(p => p.owner === 'm') as Extract<Primitive, { type: 'polyline' }>
    expect(bar).toMatchObject({ lineWidth: 0.6 })
    const [p, q] = bar.points as [Point, Point]
    expect(p[0]).toBeCloseTo(q[0], 9) // the way runs east, the bar north-south
    expect(Math.abs(p[1] - q[1])).toBeCloseTo(2.5, 9)
  })
})

describe('documents saved before marked routes and map issue points were course stops', () => {
  it('turns map issue specials, free marked routes and marked legs into stops', () => {
    const { specials: _s, ...base } = testEvent()
    const old = {
      ...base,
      courses: base.courses.map(c => (c.id === 'A' ? { ...c, bends: { 'a>b': [[250, 700]] }, markedRoutes: ['a>b'] } : c)),
      specials: [
        { id: 'mi', kind: 'mapIssue', points: [[-300, 0]] },
        {
          id: 'mr',
          kind: 'markedRoute',
          points: [
            [-300, 0],
            [0, 0],
          ],
        },
        { id: 'fa', kind: 'firstAid', points: [[50, 50]] },
      ],
    }
    const doc = parseDoc(JSON.parse(JSON.stringify(old)), 15000)
    expect(doc.specials.map(s => s.id)).toEqual(['fa'])
    expect(doc.controls.find(c => c.id === 'mi')).toMatchObject({ kind: 'mapIssue', position: [-300, 0] })
    expect(doc.controls.find(c => c.id === 'mr')).toMatchObject({
      kind: 'markedRoute',
      route: [
        [-300, 0],
        [0, 0],
      ],
    })
    const course = courseById(doc, 'A')
    const leg = course.controls[2] as string
    expect(course.controls).toEqual(['s', 'a', leg, 'b', 'c', 'f'])
    expect(doc.controls.find(c => c.id === leg)).toMatchObject({
      kind: 'markedRoute',
      route: [
        [300, 400],
        [250, 700],
        [300, 1000],
      ],
    })
    expect(course.bends).toEqual({})
    expect(course).not.toHaveProperty('markedRoutes')
    // The length is unchanged: the route runs where the bent leg ran.
    expect(courseLength(doc, course)).toBeCloseTo(500 + 2 * Math.hypot(50, 300) + 600 + 1000, 9)
    expect(upgrade(testEvent() as never)).toEqual(testEvent()) // nothing to do
  })
})

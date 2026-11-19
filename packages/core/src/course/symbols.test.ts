import { describe, expect, it } from 'vitest'
import { insertCourseControl, setNumberPosition } from './commands.ts'
import { courseById, type Point } from './doc.ts'
import { allControlsDrawing, courseDrawing, type Primitive, symbolSizes, toPaperMm } from './symbols.ts'
import { testEvent } from './test-doc.ts'

describe('symbol sizes', () => {
  it('follow ISOM 2017-2 at 1:15 000 and are enlarged in proportion for larger print scales', () => {
    expect(symbolSizes('isom', 15000)).toMatchObject({
      startSide: 6,
      controlDiameter: 5,
      finishInner: 4,
      finishOuter: 6,
      lineWidth: 0.35,
      numberHeight: 4,
    })
    const tenThousand = symbolSizes('isom', 10000)
    expect(tenThousand.controlDiameter).toBeCloseTo(7.5, 9) // 150 %
    expect(tenThousand.lineWidth).toBeCloseTo(0.525, 9)
    expect(symbolSizes('isom', 5000).controlDiameter).toBeCloseTo(15, 9) // 300 %
    // Never smaller than the standard size.
    expect(symbolSizes('isom', 20000).controlDiameter).toBe(5)
  })

  it('follow ISSprOM 2019-2 at 1:4 000, 133 % at 1:3 000', () => {
    expect(symbolSizes('issprom', 4000)).toMatchObject({ startSide: 7, controlDiameter: 6, finishInner: 5, finishOuter: 7 })
    expect(symbolSizes('issprom', 3000).controlDiameter).toBeCloseTo(8, 9)
  })
})

const of = <T extends Primitive['type']>(primitives: Primitive[], type: T) =>
  primitives.filter((p): p is Extract<Primitive, { type: T }> => p.type === type)

describe('courseDrawing', () => {
  const doc = testEvent()
  const course = courseById(doc, 'A') // 1:15 000: 1 mm paper = 15 m ground
  const drawing = courseDrawing(doc, course)

  it('draws the start, the controls with their numbers and the finish', () => {
    const circles = of(drawing, 'circle')
    expect(circles.map(c => c.radius)).toEqual([2.5, 2.5, 2.5, 2, 3])
    expect(of(drawing, 'text').map(t => t.text)).toEqual(['1', '2', '3'])
    expect(circles[0]?.center[0]).toBeCloseTo(20, 9) // control a at x 300 m = 20 mm at 1:15 000
  })

  it('points the start triangle at the first control', () => {
    const triangle = of(drawing, 'polyline').find(p => p.closed)
    const start = toPaperMm([0, 0], 15000)
    const first = toPaperMm([300, 400], 15000)
    const corners = triangle?.points ?? []
    expect(corners).toHaveLength(3)
    // One corner lies exactly towards the first control, at the circumradius 6/√3.
    const toward = corners.find(([x, y]) => Math.abs(Math.atan2(y - start[1], x - start[0]) - Math.atan2(first[1], first[0])) < 1e-9)
    expect(toward && Math.hypot(toward[0], toward[1])).toBeCloseTo(6 / Math.sqrt(3), 9)
  })

  it('cuts course lines back to the edges of the symbols, leaving a gap', () => {
    const legs = of(drawing, 'polyline').filter(p => !p.closed)
    expect(legs).toHaveLength(4)
    const [a, b] = [toPaperMm([300, 400], 15000), toPaperMm([300, 1000], 15000)]
    const leg = legs[1]?.points as Point[]
    // Leg a -> b starts 2.5 mm (radius) + 0.6 mm (gap) from a's centre and ends as far from b's.
    expect(Math.hypot((leg[0]?.[0] ?? 0) - a[0], (leg[0]?.[1] ?? 0) - a[1])).toBeCloseTo(3.1, 9)
    expect(Math.hypot((leg[1]?.[0] ?? 0) - b[0], (leg[1]?.[1] ?? 0) - b[1])).toBeCloseTo(3.1, 9)
  })

  it('places control numbers away from the course lines', () => {
    // Control b: legs arrive from below (a) and leave to the right (c); its number goes up-left.
    const number = of(drawing, 'text')[1]
    const b = toPaperMm([300, 1000], 15000)
    const [dx, dy] = [(number?.at[0] ?? 0) - b[0], (number?.at[1] ?? 0) - b[1]]
    expect(dx).toBeLessThan(0)
    expect(dy).toBeGreaterThan(0)
  })

  it('draws a crossing point as two curved lines across which the course line runs', () => {
    let d = testEvent()
    d = { ...d, controls: [...d.controls, { id: 'x', kind: 'crossingPoint', code: null, position: [600, 0] }] }
    d = insertCourseControl(d, 'A', 'x', 4)
    const lines = of(courseDrawing(d, courseById(d, 'A')), 'polyline').filter(p => !p.closed)
    // 5 legs + 2 crossing lines.
    expect(lines).toHaveLength(7)
  })

  it('draws the crossing point as an hourglass: the two lines are closest in the middle', () => {
    let d = testEvent()
    d = { ...d, controls: [...d.controls, { id: 'x', kind: 'crossingPoint', code: null, position: [600, 0] }] }
    d = insertCourseControl(d, 'A', 'x', 4)
    const lines = of(courseDrawing(d, courseById(d, 'A')), 'polyline').filter(p => p.owner === 'x')
    expect(lines).toHaveLength(2)
    const [left, right] = lines.map(l => l.points)
    const gap = (i: number) => Math.hypot((left?.[i]?.[0] ?? 0) - (right?.[i]?.[0] ?? 0), (left?.[i]?.[1] ?? 0) - (right?.[i]?.[1] ?? 0))
    expect(gap(6)).toBeCloseTo(1.2, 9) // middle: the spacing
    expect(gap(0)).toBeGreaterThan(gap(6) + 0.9) // ends: wider by twice the bulge
  })

  it('tags every symbol and number with its control, and course lines as legs', () => {
    const tags = drawing.map(p => `${p.role}:${p.owner ?? ''}`)
    expect(tags.filter(t => t.startsWith('leg:'))).toHaveLength(4)
    expect(tags).toContain('symbol:s')
    expect(tags).toContain('number:b')
    expect(drawing.filter(p => p.owner === 'f').map(p => p.type)).toEqual(['circle', 'circle'])
  })

  it('puts a moved number where the setter put it, relative to its control', () => {
    const moved = setNumberPosition(testEvent(), 'A', 'b', [-6, 0])
    const number = of(courseDrawing(moved, courseById(moved, 'A')), 'text').find(t => t.owner === 'b')
    const b = toPaperMm([300, 1000], 15000)
    expect(number?.at).toEqual([b[0] - 6, b[1]])
    // Other courses are not affected, and null puts it back.
    expect(courseById(moved, 'B').numberPositions).toEqual({})
    const back = setNumberPosition(moved, 'A', 'b', null)
    expect(courseById(back, 'A').numberPositions).toEqual({})
  })

  it('uses the course print scale: the 1:10 000 course gets 150 % symbols', () => {
    const short = courseDrawing(doc, courseById(doc, 'B'))
    expect(of(short, 'circle')[0]?.radius).toBeCloseTo(3.75, 9)
  })

  it('shows every control with its code in the all-controls view', () => {
    const all = allControlsDrawing(doc, 15000)
    expect(of(all, 'text').map(t => t.text)).toEqual(['31', '32', '33'])
  })
})

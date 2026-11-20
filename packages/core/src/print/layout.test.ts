import { describe, expect, it } from 'vitest'
import { addControl, addCourse, insertCourseControl, setPrintSettings } from '../course/commands.ts'
import { CourseError, courseById, type EventDoc, emptyDoc, eventDocSchema, type Point, type PrintSettings } from '../course/doc.ts'
import { testEvent } from '../course/test-doc.ts'
import type { Primitive } from '../render/primitives.ts'
import { defaultPrintSettings, pagePosition, pageSize, printPage } from './layout.ts'

/** A course at 1:10 000 with two controls 1 km apart, east-west. */
function kilometre(): EventDoc {
  let doc = emptyDoc(10000)
  doc = addControl(doc, { id: 'a', kind: 'control', position: [1000, 2000] })
  doc = addControl(doc, { id: 'b', kind: 'control', position: [2000, 2000] })
  doc = addCourse(doc, { id: 'K', name: 'Km', printScale: 10000 })
  doc = insertCourseControl(doc, 'K', 'a')
  return insertCourseControl(doc, 'K', 'b')
}

const settings = (over: Partial<PrintSettings> = {}): PrintSettings => ({
  paper: 'A4',
  orientation: 'portrait',
  center: [1500, 2000],
  margin: 5,
  layout: [],
  ...over,
})

const circles = (ps: Primitive[]) => ps.filter((p): p is Extract<Primitive, { type: 'circle' }> => p.type === 'circle')

describe('pageSize', () => {
  it('gives A4 and A3 in both orientations', () => {
    expect(pageSize('A4', 'portrait')).toEqual([210, 297])
    expect(pageSize('A4', 'landscape')).toEqual([297, 210])
    expect(pageSize('A3', 'portrait')).toEqual([297, 420])
  })
})

describe('printPage', () => {
  it('prints at scale: 1 km is 100 mm at 1:10 000', () => {
    const doc = kilometre()
    const page = printPage(doc, courseById(doc, 'K'), 'Test', settings())
    const [a, b] = circles(page.course).map(c => c.center) as [Point, Point]
    expect(b[0] - a[0]).toBeCloseTo(100, 9)
    expect(b[1] - a[1]).toBeCloseTo(0, 9)
    // The centre of the settings lands in the middle of the map area, which is the page less 5 mm.
    expect(page.mapArea).toEqual({ minX: 5, minY: 5, maxX: 205, maxY: 292 })
    expect((a[0] + b[0]) / 2).toBeCloseTo(105, 9)
    expect(a[1]).toBeCloseTo(148.5, 9)
    expect(pagePosition(courseById(doc, 'K'), settings(), [2000, 2000])).toEqual(b)
  })

  it('shows the ground the map area covers: 200 × 287 mm at 1:10 000 is 2000 × 2870 m round the centre', () => {
    const doc = kilometre()
    const { groundArea } = printPage(doc, courseById(doc, 'K'), 'Test', settings())
    expect(groundArea.minX).toBeCloseTo(500, 9)
    expect(groundArea.maxX).toBeCloseTo(2500, 9)
    expect(groundArea.minY).toBeCloseTo(2000 - 1435, 9)
    expect(groundArea.maxY).toBeCloseTo(2000 + 1435, 9)
  })

  it('places the description sheet at its layout position, measured from the top-left corner of the page', () => {
    const doc = kilometre()
    const page = printPage(doc, courseById(doc, 'K'), 'Test', settings({ layout: [{ kind: 'descriptions', at: [20, 30] }] }))
    const box = page.descriptions?.box
    // 6 mm cells, 8 wide; rows: title, header, control 1, control 2 (no start or finish) = 4 rows.
    const pad = 0.05 * 6 * 0.5
    expect(box?.minX).toBeCloseTo(20 - pad, 9)
    expect(box?.maxX).toBeCloseTo(20 + 48 + pad, 9)
    expect(box?.maxY).toBeCloseTo(297 - 30 + pad, 9)
    expect(box?.minY).toBeCloseTo(297 - 30 - 4 * 6 - pad, 9)
    expect(page.descriptions?.primitives.every(p => p.role === 'description')).toBe(true)
    expect(printPage(doc, courseById(doc, 'K'), 'Test', settings()).descriptions).toBeNull()
  })
})

describe('defaultPrintSettings', () => {
  it('centres the map area on the course, upright for a tall course, sideways for a wide one', () => {
    const doc = testEvent() // course A spans 900 m east-west and 1000 m north-south
    const tall = defaultPrintSettings(doc, courseById(doc, 'A'), 'Test')
    expect(tall.orientation).toBe('portrait')
    expect(tall.center[0]).toBeGreaterThan(300)
    expect(tall.center[0]).toBeLessThan(600)
    expect(tall.center[1]).toBeGreaterThan(400)
    expect(tall.center[1]).toBeLessThan(600)
    expect(defaultPrintSettings(kilometre(), courseById(kilometre(), 'K'), 'Test').orientation).toBe('landscape')
    expect(tall).toMatchObject({ paper: 'A4', margin: 5 })
  })

  it('puts the description sheet in a corner of the map area that hides none of the course', () => {
    const doc = testEvent()
    const course = courseById(doc, 'A')
    const s = defaultPrintSettings(doc, course, 'Test')
    const page = printPage(doc, course, 'Test', s)
    const box = page.descriptions?.box
    if (!box) throw new Error('no sheet')
    // Inside the map area, in a corner.
    expect(box.minX).toBeGreaterThanOrEqual(page.mapArea.minX - 1e-9)
    expect(box.maxY).toBeLessThanOrEqual(page.mapArea.maxY + 1e-9)
    // No control circle under it.
    for (const c of circles(page.course)) {
      const inside = c.center[0] > box.minX && c.center[0] < box.maxX && c.center[1] > box.minY && c.center[1] < box.maxY
      expect(inside).toBe(false)
    }
  })

  it('uses the fallback centre for an empty course', () => {
    let doc = emptyDoc(15000)
    doc = addCourse(doc, { id: 'E', name: 'Empty', printScale: 15000 })
    expect(defaultPrintSettings(doc, courseById(doc, 'E'), 'Test', [123, 456]).center).toEqual([123, 456])
  })
})

describe('setPrintSettings', () => {
  it('stores print settings with the course, and null goes back to the defaults', () => {
    const doc = setPrintSettings(kilometre(), 'K', settings({ paper: 'A3', layout: [{ kind: 'descriptions', at: [10, 10] }] }))
    expect(courseById(doc, 'K').print).toMatchObject({ paper: 'A3' })
    expect(eventDocSchema.parse(JSON.parse(JSON.stringify(doc)))).toEqual(doc)
    expect(courseById(setPrintSettings(doc, 'K', null), 'K')).not.toHaveProperty('print')
  })

  it('refuses settings that make no sense', () => {
    const bad = (s: Partial<PrintSettings>) => {
      try {
        setPrintSettings(kilometre(), 'K', settings(s))
      } catch (e) {
        return e instanceof CourseError ? e.code : e
      }
      return null
    }
    expect(bad({ margin: -1 })).toBe('invalid_print')
    expect(bad({ center: [Number.NaN, 0] })).toBe('invalid_print')
    expect(bad({ paper: 'B5' as 'A4' })).toBe('invalid_print')
  })
})

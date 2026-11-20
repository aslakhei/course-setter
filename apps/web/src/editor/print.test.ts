import {
  addControl,
  addCourse,
  courseById,
  type EventDoc,
  emptyDoc,
  insertCourseControl,
  type PrintSettings,
  printPage,
} from '@course-setter/core'
import { describe, expect, it } from 'vitest'
import { dragged, grabAt, groundRing } from './print.ts'

/** Two controls 1 km apart at 1:10 000; an A4 portrait page centred between them, the sheet at (20, 30) mm. */
function setup() {
  let doc: EventDoc = emptyDoc(10000)
  doc = addControl(doc, { id: 'a', kind: 'control', position: [1000, 2000] })
  doc = addControl(doc, { id: 'b', kind: 'control', position: [2000, 2000] })
  doc = addCourse(doc, { id: 'K', name: 'Km', printScale: 10000 })
  doc = insertCourseControl(doc, 'K', 'a')
  doc = insertCourseControl(doc, 'K', 'b')
  const settings: PrintSettings = {
    paper: 'A4',
    orientation: 'portrait',
    center: [1500, 2000],
    margin: 5,
    layout: [{ kind: 'descriptions', at: [20, 30] }],
  }
  const course = courseById(doc, 'K')
  return { doc, course, settings, page: printPage(doc, course, 'Test', settings) }
}

describe('grabAt', () => {
  it('grabs the sheet on top of the page, the page elsewhere on it, nothing off it', () => {
    const { course, settings, page } = setup()
    // The page's left edge is 1050 m west of the centre, its top 1485 m north; 1 mm is 10 m.
    const left = 1500 - 1050
    const top = 2000 + 1485
    expect(grabAt(page, course, settings, [left + 300, top - 400])).toBe('sheet')
    expect(grabAt(page, course, settings, [1500, 2000])).toBe('page')
    expect(grabAt(page, course, settings, [left - 10, 2000])).toBeNull()
  })
})

describe('dragged', () => {
  it('moves the page with the pointer', () => {
    const { doc, course, settings } = setup()
    expect(dragged(doc, course, 'Test', settings, 'page', [100, -50]).center).toEqual([1600, 1950])
  })

  it('moves the sheet on the page by the same paper distance, y down', () => {
    const { doc, course, settings } = setup()
    // 100 m east, 50 m south at 1:10 000: 10 mm right, 5 mm down.
    expect(dragged(doc, course, 'Test', settings, 'sheet', [100, -50]).layout).toEqual([{ kind: 'descriptions', at: [30, 35] }])
    // The page itself stays.
    expect(dragged(doc, course, 'Test', settings, 'sheet', [100, -50]).center).toEqual([1500, 2000])
  })
})

describe('groundRing', () => {
  it('puts the whole page where the map area round the centre says', () => {
    const { course, settings, page } = setup()
    const ring = groundRing(course, settings, { minX: 0, minY: 0, maxX: page.size[0], maxY: page.size[1] })
    const close = (p: [number, number] | undefined, q: [number, number]) => {
      expect(p?.[0]).toBeCloseTo(q[0], 6)
      expect(p?.[1]).toBeCloseTo(q[1], 6)
    }
    close(ring[0], [450, 515])
    close(ring[2], [2550, 3485])
  })
})

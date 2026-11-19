import { describe, expect, it } from 'vitest'
import {
  addControl,
  deleteControl,
  insertCourseControl,
  moveControl,
  moveCourseControl,
  removeCourseControl,
  setControlCode,
  setLegBends,
  updateCourse,
} from './commands.ts'
import { CourseError, courseById, emptyDoc, eventDocSchema, legKey, parseDoc } from './doc.ts'
import { canRedo, canUndo, createHistory, record, redo, undo } from './history.ts'
import { courseLength, legLengths } from './length.ts'
import { courseStops, coursesUsing, nextFreeCode } from './numbering.ts'
import { testEvent } from './test-doc.ts'

describe('the event document', () => {
  it('accepts the empty document the database creates, filling in the standard from the map scale', () => {
    const raw = { schemaVersion: 1, controls: [], courses: [] }
    expect(parseDoc(raw, 15000).standard).toBe('isom')
    expect(parseDoc(raw, 4000).standard).toBe('issprom')
    expect(parseDoc({ ...raw, standard: 'isom' }, 4000).standard).toBe('isom')
  })

  it('round-trips a document through JSON', () => {
    const doc = testEvent()
    expect(parseDoc(JSON.parse(JSON.stringify(doc)), 15000)).toEqual(doc)
  })

  it('rejects broken documents', () => {
    const doc = testEvent()
    const bad = (change: (d: typeof doc) => unknown) => eventDocSchema.safeParse(change(structuredClone(doc))).success
    expect(bad(d => ({ ...d, controls: d.controls.map(c => (c.id === 'b' ? { ...c, code: 31 } : c)) }))).toBe(false)
    expect(bad(d => ({ ...d, controls: d.controls.map(c => (c.id === 's' ? { ...c, code: 1 } : c)) }))).toBe(false)
    expect(bad(d => ({ ...d, courses: d.courses.map(c => ({ ...c, controls: [...c.controls, 'ghost'] })) }))).toBe(false)
    expect(bad(d => ({ ...d, schemaVersion: 2 }))).toBe(false)
    expect(bad(d => d)).toBe(true)
  })
})

describe('commands', () => {
  it('never change the document they are given', () => {
    const doc = testEvent()
    const before = JSON.stringify(doc)
    moveControl(doc, 'a', [1, 2])
    deleteControl(doc, 'b')
    setLegBends(doc, 'A', 'a', 'b', [[0, 700]])
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('give controls the lowest free code from 31', () => {
    let doc = testEvent()
    expect(doc.controls.map(c => c.code)).toEqual([null, 31, 32, 33, null])
    doc = deleteControl(doc, 'b')
    expect(nextFreeCode(doc)).toBe(32)
    doc = addControl(doc, { id: 'd', kind: 'control', position: [5, 5] })
    expect(doc.controls.find(c => c.id === 'd')?.code).toBe(32)
    doc = addControl(doc, { id: 'x', kind: 'crossingPoint', position: [6, 6] })
    expect(doc.controls.find(c => c.id === 'x')?.code).toBeNull()
  })

  it('keep control codes unique', () => {
    const doc = testEvent()
    expect(() => setControlCode(doc, 'a', 32)).toThrow(CourseError)
    expect(() => addControl(doc, { id: 'd', kind: 'control', position: [0, 0], code: 33 })).toThrow(/already used/)
    expect(() => setControlCode(doc, 's', 50)).toThrow(/has no code/)
    expect(setControlCode(doc, 'a', 100).controls.find(c => c.id === 'a')?.code).toBe(100)
  })

  it('move a control shared by several courses in all of them', () => {
    const doc = moveControl(testEvent(), 'b', [300, 1200])
    expect(coursesUsing(doc, 'b').map(c => c.id)).toEqual(['A', 'B'])
    // Course A: s -> a (500) -> b (800) -> c (632.46) -> f (1000); B: s -> b -> f.
    expect(legLengths(doc, courseById(doc, 'A'))[1]).toBeCloseTo(800, 9)
    expect(legLengths(doc, courseById(doc, 'B'))[0]).toBeCloseTo(Math.hypot(300, 1200), 9)
  })

  it('delete a control from the pool and from every course, with its bends', () => {
    let doc = setLegBends(testEvent(), 'A', 'a', 'b', [[0, 700]])
    doc = deleteControl(doc, 'b')
    expect(doc.controls.map(c => c.id)).toEqual(['s', 'a', 'c', 'f'])
    expect(courseById(doc, 'A').controls).toEqual(['s', 'a', 'c', 'f'])
    expect(courseById(doc, 'B').controls).toEqual(['s', 'f'])
    expect(courseById(doc, 'A').bends).toEqual({})
  })

  it('insert, remove and reorder controls in a course without touching the pool', () => {
    let doc = insertCourseControl(testEvent(), 'B', 'c', 2)
    expect(courseById(doc, 'B').controls).toEqual(['s', 'b', 'c', 'f'])
    doc = moveCourseControl(doc, 'B', 2, 1)
    expect(courseById(doc, 'B').controls).toEqual(['s', 'c', 'b', 'f'])
    doc = removeCourseControl(doc, 'B', 1)
    expect(courseById(doc, 'B').controls).toEqual(['s', 'b', 'f'])
    expect(doc.controls).toHaveLength(5)
    expect(() => removeCourseControl(doc, 'B', 9)).toThrow(CourseError)
    expect(() => insertCourseControl(doc, 'B', 'ghost')).toThrow(/No control/)
    expect(() => updateCourse(doc, 'Z', { name: 'x' })).toThrow(/No course/)
  })

  it('allow a control to be visited twice in one course (butterflies)', () => {
    const doc = insertCourseControl(testEvent(), 'A', 'a', 4)
    expect(courseStops(doc, courseById(doc, 'A')).map(s => [s.code, s.number])).toEqual([
      [null, null],
      [31, 1],
      [32, 2],
      [33, 3],
      [31, 4],
      [null, null],
    ])
  })
})

describe('course length', () => {
  it('adds up straight legs from start through the controls to finish', () => {
    const doc = testEvent()
    expect(legLengths(doc, courseById(doc, 'A'))).toEqual([500, 600, 600, 1000])
    expect(courseLength(doc, courseById(doc, 'A'))).toBe(2700)
  })

  it('follows bend points and crossing points', () => {
    let doc = setLegBends(testEvent(), 'A', 'c', 'f', [[1200, 1000]])
    // c (900,1000) -> bend (1200,1000) -> f (900,0): 300 + √(300² + 1000²)
    expect(legLengths(doc, courseById(doc, 'A'))[3]).toBeCloseTo(300 + Math.hypot(300, 1000), 9)
    doc = addControl(testEvent(), { id: 'x', kind: 'crossingPoint', position: [600, 0] })
    doc = insertCourseControl(doc, 'B', 'x', 2)
    // B: s -> b (1044) -> x (1044) -> f (300)
    expect(courseLength(doc, courseById(doc, 'B'))).toBeCloseTo(Math.hypot(300, 1000) * 2 + 300, 9)
    expect(courseStops(doc, courseById(doc, 'B')).map(s => s.number)).toEqual([null, 1, null, null])
  })

  it('is zero for an empty or one-stop course', () => {
    const doc = emptyDoc(15000)
    expect(courseLength(doc, { id: 'x', name: 'x', controls: [], printScale: 15000, bends: {}, numberPositions: {} })).toBe(0)
  })

  it('keys bends by the leg', () => {
    expect(legKey('a', 'b')).toBe('a>b')
  })
})

describe('history', () => {
  it('undoes and redoes, and an edit after undo drops the redo', () => {
    const one = testEvent()
    const two = moveControl(one, 'a', [1, 1])
    const three = moveControl(two, 'a', [2, 2])
    let h = record(record(createHistory(one), two), three)
    expect(canRedo(h)).toBe(false)
    h = undo(h)
    expect(h.present).toBe(two)
    h = undo(h)
    expect(h.present).toBe(one)
    expect(canUndo(h)).toBe(false)
    expect(undo(h)).toBe(h)
    h = redo(h)
    expect(h.present).toBe(two)
    h = record(h, moveControl(two, 'b', [0, 0]))
    expect(canRedo(h)).toBe(false)
    expect(h.past).toEqual([one, two])
  })

  it('keeps at most the limit and ignores edits that change nothing', () => {
    let h = createHistory(0)
    for (let i = 1; i <= 150; i++) h = record(h, i)
    expect(h.past).toHaveLength(100)
    expect(h.past[0]).toBe(50)
    expect(record(h, h.present)).toBe(h)
  })
})

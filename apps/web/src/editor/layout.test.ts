import {
  addControl,
  addCourse,
  courseById,
  type EventDoc,
  emptyDoc,
  fieldValues,
  insertCourseControl,
  type PageElementSpec,
  type PrintSettings,
} from '@course-setter/core'
import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'
import en from '../locales/en.json' with { type: 'json' }
import {
  familyOf,
  fontFor,
  hiddenState,
  isBold,
  layerName,
  nextSelection,
  paletteElement,
  pinnedText,
  placeElement,
  placeMany,
  removeMany,
  setHidden,
  shownElement,
} from './layout.ts'

/** English texts as i18next would give them, for checking the words. */
const t = ((key: string, values: Record<string, unknown> = {}) => {
  const text = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], en) as string
  return text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(values[k] ?? ''))
}) as unknown as TFunction

const settings: PrintSettings = { paper: 'A4', orientation: 'portrait', center: [0, 0], margin: 5, layout: [] }
const rect = (id: string, over: Partial<PageElementSpec> = {}): PageElementSpec =>
  ({ id, kind: 'shape', shape: 'rect', anchor: 'tl', offset: [10, 10], size: [40, 20], ...over }) as PageElementSpec

function event(): EventDoc {
  let doc = emptyDoc(10000)
  doc = addControl(doc, { id: 'a', kind: 'control', position: [0, 0] })
  for (const id of ['A', 'B']) {
    doc = addCourse(doc, { id, name: id, printScale: 10000 })
    doc = insertCourseControl(doc, id, 'a')
  }
  return { ...doc, printLayout: { elements: [rect('x')] } }
}

describe('placing an element', () => {
  it('for every course: the shared element moves, and this course’s own position of it goes', () => {
    let doc = placeElement(event(), courseById(event(), 'A'), settings, 'course', rect('x', { offset: [30, 30] }))
    expect(courseById(doc, 'A').print?.overrides?.x).toEqual({ offset: [30, 30], size: [40, 20] })
    expect(doc.printLayout?.elements[0]?.offset).toEqual([10, 10])
    const a = courseById(doc, 'A')
    doc = placeElement(doc, a, a.print as PrintSettings, 'all', rect('x', { offset: [50, 60] }))
    expect(doc.printLayout?.elements[0]?.offset).toEqual([50, 60])
    expect(courseById(doc, 'A').print?.overrides).toBeUndefined()
    expect(shownElement(doc, courseById(doc, 'B').print ?? settings, 'x')?.offset).toEqual([50, 60])
  })

  it('keeps a course’s hiding when the element is placed for every course', () => {
    let doc = setHidden(event(), courseById(event(), 'A'), settings, 'course', 'x', true)
    doc = placeElement(doc, courseById(doc, 'A'), courseById(doc, 'A').print as PrintSettings, 'course', rect('x', { offset: [1, 1] }))
    const a = courseById(doc, 'A')
    doc = placeElement(doc, a, a.print as PrintSettings, 'all', rect('x', { offset: [2, 2] }))
    expect(courseById(doc, 'A').print?.overrides).toEqual({ x: { hidden: true } })
  })
})

describe('hiding an element', () => {
  it('for every course or only this one, and says which', () => {
    const doc = event()
    const a = courseById(doc, 'A')
    const all = setHidden(doc, a, settings, 'all', 'x', true)
    expect(hiddenState(all, settings, 'x')).toBe('all')
    const one = setHidden(doc, a, settings, 'course', 'x', true)
    expect(hiddenState(one, courseById(one, 'A').print as PrintSettings, 'x')).toBe('course')
    expect(hiddenState(one, courseById(one, 'B').print ?? settings, 'x')).toBe('no')
    const shownAgain = setHidden(one, courseById(one, 'A'), courseById(one, 'A').print as PrintSettings, 'course', 'x', false)
    expect(courseById(shownAgain, 'A').print?.overrides).toBeUndefined()
  })
})

describe('naming and describing elements', () => {
  it('names a text element by its first line, fields filled in, and others by their kind', () => {
    const doc = event()
    const text: PageElementSpec = { ...rect('t'), kind: 'text', text: '\n{course} night', font: 'sans', sizePt: 12, color: '#000000' }
    expect(layerName(text, t)).toBe('{course} night')
    expect(layerName(text, t, fieldValues(doc, courseById(doc, 'A'), 'Club night'))).toBe('A night')
    expect(layerName(rect('r'), t)).toBe('Shape')
  })

  it('says where an element is pinned', () => {
    expect(pinnedText(rect('r', { anchor: 'tl', offset: [7, 5] }), t)).toBe('7 mm from the left, 5 mm from the top')
    expect(pinnedText(rect('r', { anchor: 'br', offset: [10, 12.5] }), t)).toBe('10 mm from the right, 12.5 mm from the bottom')
    expect(pinnedText(rect('r', { anchor: 'b', offset: [0, 8] }), t)).toBe('centred, 8 mm from the bottom')
    expect(pinnedText(rect('r', { anchor: 'c', offset: [-4, 3] }), t)).toBe('4 mm left of the centre, 3 mm below the centre')
    expect(pinnedText(rect('r', { anchor: 'tl', offset: [0, 0], stretch: [5, 6] }), t)).toBe(
      'across the page (5 mm and 6 mm in), 0 mm from the top',
    )
  })

  it('splits a font into family and weight and back', () => {
    expect([familyOf('display-bold'), isBold('display-bold')]).toEqual(['display', true])
    expect([familyOf('serif'), isBold('serif')]).toEqual(['serif', false])
    expect(fontFor('condensed', true)).toBe('condensed-bold')
    expect(fontFor('sans', false)).toBe('sans')
  })

  it('places a new element 10 mm inside the margin', () => {
    expect(paletteElement('text', 'n', 5).offset).toEqual([15, 15])
  })
})

describe('several elements at once', () => {
  const two = (): EventDoc => ({ ...event(), printLayout: { elements: [rect('x'), rect('y', { offset: [60, 40] })] } })

  it('selects with Shift adding and taking away, the map alone', () => {
    expect(nextSelection([], 'x', false, '#map')).toEqual(['x'])
    expect(nextSelection(['x'], 'y', true, '#map')).toEqual(['x', 'y'])
    expect(nextSelection(['x', 'y'], 'x', true, '#map')).toEqual(['y'])
    expect(nextSelection(['x', 'y'], 'y', false, '#map')).toEqual(['y'])
    expect(nextSelection(['x'], '#map', true, '#map')).toEqual(['#map'])
    expect(nextSelection(['#map'], 'x', true, '#map')).toEqual(['x'])
    expect(nextSelection(['x'], null, false, '#map')).toEqual([])
  })

  it('places them for one course, each becoming its override', () => {
    const doc = two()
    const next = placeMany(doc, courseById(doc, 'A'), settings, 'course', [rect('x', { offset: [1, 1] }), rect('y', { offset: [1, 2] })])
    expect(courseById(next, 'A').print?.overrides).toEqual({ x: { offset: [1, 1], size: [40, 20] }, y: { offset: [1, 2], size: [40, 20] } })
    expect(next.printLayout).toEqual(doc.printLayout)
  })

  it('removes them for every course, or hides them on one', () => {
    const doc = two()
    expect(removeMany(doc, courseById(doc, 'A'), settings, 'all', ['x', 'y']).printLayout?.elements).toEqual([])
    const hidden = removeMany(doc, courseById(doc, 'A'), settings, 'course', ['x', 'y'])
    expect(hidden.printLayout).toEqual(doc.printLayout)
    expect(courseById(hidden, 'A').print?.overrides).toEqual({ x: { hidden: true }, y: { hidden: true } })
  })
})

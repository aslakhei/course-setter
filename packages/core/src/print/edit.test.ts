import { describe, expect, it } from 'vitest'
import { addControl, addCourse, insertCourseControl, setPrintSettings } from '../course/commands.ts'
import {
  ALL_CONTROLS,
  CourseError,
  courseById,
  type EventDoc,
  emptyDoc,
  eventDocSchema,
  type Point,
  type PrintSettings,
} from '../course/doc.ts'
import { elementBox, layoutFor } from './compose.ts'
import {
  addLayoutElement,
  detachLayout,
  duplicateLayoutElement,
  moveSpec,
  newElement,
  reattachLayout,
  removeLayoutElement,
  reorderLayoutElement,
  setElementOverride,
  setMapAreaRadius,
  specForBox,
  updateLayoutElement,
} from './edit.ts'
import { ANCHORS, type PageElementSpec } from './elements.ts'
import { pageSize } from './layout.ts'

const settings: PrintSettings = { paper: 'A4', orientation: 'portrait', center: [0, 0], margin: 5, layout: [] }
const rect = (id: string, over: Partial<PageElementSpec> = {}): PageElementSpec =>
  ({ id, kind: 'shape', shape: 'rect', anchor: 'tl', offset: [10, 10], size: [40, 20], ...over }) as PageElementSpec

/** Courses A and B on a two-control event, with a shared layout of elements x and y. */
function event(): EventDoc {
  let doc = emptyDoc(10000)
  doc = addControl(doc, { id: 'a', kind: 'control', position: [0, 0] })
  for (const id of ['A', 'B']) {
    doc = addCourse(doc, { id, name: id, printScale: 10000 })
    doc = insertCourseControl(doc, id, 'a')
  }
  return { ...doc, printLayout: { elements: [rect('x'), rect('y')] } }
}
const ids = (doc: EventDoc) => doc.printLayout?.elements.map(e => e.id)
const code = (f: () => unknown) => {
  try {
    f()
    return null
  } catch (err) {
    return err instanceof CourseError ? err.code : String(err)
  }
}

describe('editing the shared layout', () => {
  it('adds, changes, duplicates, reorders and removes elements', () => {
    let doc = addLayoutElement(event(), 'A', settings, rect('z'))
    expect(ids(doc)).toEqual(['x', 'y', 'z'])
    doc = updateLayoutElement(doc, 'A', settings, 'x', e => ({ ...e, size: [50, 25] }))
    expect(doc.printLayout?.elements[0]?.size).toEqual([50, 25])
    doc = duplicateLayoutElement(doc, 'A', settings, 'x', 'x2')
    expect(ids(doc)).toEqual(['x', 'x2', 'y', 'z'])
    expect(doc.printLayout?.elements[1]?.offset).toEqual([15, 15])
    doc = reorderLayoutElement(doc, 'A', settings, 'z', 0)
    expect(ids(doc)).toEqual(['z', 'x', 'x2', 'y'])
    doc = removeLayoutElement(doc, 'A', settings, 'x2')
    expect(ids(doc)).toEqual(['z', 'x', 'y'])
    expect(eventDocSchema.safeParse(doc).success).toBe(true)
  })

  it('refuses what makes the layout invalid', () => {
    expect(code(() => addLayoutElement(event(), 'A', settings, rect('x')))).toBe('invalid_layout')
    expect(code(() => updateLayoutElement(event(), 'A', settings, 'x', e => ({ ...e, size: [0, 1] })))).toBe('invalid_layout')
    expect(code(() => updateLayoutElement(event(), 'A', settings, 'nope', e => e))).toBe('invalid_layout')
  })

  it('removes every course’s overrides of a removed element, the all-controls page’s too', () => {
    let doc = event()
    doc = setElementOverride(doc, 'A', settings, 'x', { hidden: true })
    doc = setElementOverride(doc, ALL_CONTROLS, settings, 'x', { offset: [1, 1] })
    doc = setElementOverride(doc, 'B', settings, 'y', { hidden: true })
    doc = removeLayoutElement(doc, 'A', settings, 'x')
    expect(courseById(doc, 'A').print?.overrides).toBeUndefined()
    expect(courseById(doc, ALL_CONTROLS).print?.overrides).toBeUndefined()
    expect(courseById(doc, 'B').print?.overrides).toEqual({ y: { hidden: true } })
  })

  it('rounds the map area’s corners and squares them again', () => {
    const round = setMapAreaRadius(event(), 'A', settings, 6)
    expect(round.printLayout?.mapArea).toEqual({ radius: 6 })
    expect(setMapAreaRadius(round, 'A', settings, 0).printLayout?.mapArea).toBeUndefined()
  })
})

describe('one course differing from the shared layout', () => {
  it('moves, resizes or hides an element for one course only', () => {
    let doc = setElementOverride(event(), 'A', settings, 'x', { offset: [30, 40], size: [10, 10] })
    doc = setElementOverride(doc, 'A', courseById(doc, 'A').print as PrintSettings, 'y', { hidden: true })
    const a = courseById(doc, 'A')
    expect(layoutFor(doc, a.print).elements.map(e => [e.id, e.offset])).toEqual([['x', [30, 40]]])
    expect(layoutFor(doc, courseById(doc, 'B').print).elements.map(e => e.id)).toEqual(['x', 'y'])
    // Null (or nothing left to override) takes the course back to the shared layout's element.
    doc = setElementOverride(doc, 'A', a.print as PrintSettings, 'x', null)
    doc = setElementOverride(doc, 'A', courseById(doc, 'A').print as PrintSettings, 'y', {})
    expect(courseById(doc, 'A').print?.overrides).toBeUndefined()
  })

  it('gives a course a layout of its own as it printed, and takes it back to the shared one', () => {
    let doc = setElementOverride(event(), 'A', settings, 'x', { offset: [30, 40] })
    doc = detachLayout(doc, 'A', courseById(doc, 'A').print as PrintSettings)
    const own = courseById(doc, 'A').print as PrintSettings
    expect(own.overrides).toBeUndefined()
    expect(own.ownLayout?.elements.map(e => [e.id, e.offset])).toEqual([
      ['x', [30, 40]],
      ['y', [10, 10]],
    ])
    // Edits now go to the course's own layout; the shared one and course B keep theirs.
    doc = addLayoutElement(doc, 'A', own, rect('mine'))
    expect(courseById(doc, 'A').print?.ownLayout?.elements.map(e => e.id)).toEqual(['x', 'y', 'mine'])
    expect(ids(doc)).toEqual(['x', 'y'])
    expect(code(() => setElementOverride(doc, 'A', courseById(doc, 'A').print as PrintSettings, 'x', { hidden: true }))).toBe(
      'invalid_layout',
    )
    doc = reattachLayout(doc, 'A', courseById(doc, 'A').print as PrintSettings)
    expect(courseById(doc, 'A').print?.ownLayout).toBeUndefined()
    expect(layoutFor(doc, courseById(doc, 'A').print).elements.map(e => e.id)).toEqual(['x', 'y'])
  })

  it('keeps the rest of the course’s print settings', () => {
    let doc = setPrintSettings(event(), 'A', { ...settings, paper: 'A3', layout: [{ kind: 'descriptions', at: [10, 10] }] })
    doc = setElementOverride(doc, 'A', courseById(doc, 'A').print as PrintSettings, 'x', { hidden: true })
    expect(courseById(doc, 'A').print).toMatchObject({ paper: 'A3', layout: [{ kind: 'descriptions', at: [10, 10] }] })
  })
})

describe('moving and re-boxing elements', () => {
  const pages: Point[] = [pageSize('A4', 'portrait'), pageSize('A4', 'landscape'), pageSize('A3', 'portrait')]

  it('moves an element by the delta on the page, whatever it is pinned to', () => {
    for (const size of pages)
      for (const anchor of ANCHORS) {
        const spec = rect('x', { anchor, offset: [12, 7] })
        const before = elementBox(spec, size, 40, 20)
        const after = elementBox(moveSpec(spec, [5, -3]), size, 40, 20)
        expect(after.minX - before.minX, `${anchor}`).toBeCloseTo(5, 9)
        expect(after.minY - before.minY, `${anchor}`).toBeCloseTo(-3, 9)
      }
  })

  it('puts an element at a box, pinned to its own anchor or another, so that it lies exactly there', () => {
    const box = { minX: 31.5, minY: 120, maxX: 81.5, maxY: 145 }
    for (const size of pages)
      for (const anchor of ANCHORS) {
        const spec = specForBox(rect('x', { anchor: 'br' }), box, size, anchor)
        expect(spec.anchor).toBe(anchor)
        const placed = elementBox(spec, size, spec.size[0], spec.size[1])
        for (const k of ['minX', 'minY', 'maxX', 'maxY'] as const) expect(placed[k], `${anchor} ${k}`).toBeCloseTo(box[k], 6)
      }
  })

  it('keeps a band spanning between insets, and a text element as high as its lines', () => {
    const band = rect('b', { stretch: [5, 5] })
    expect(moveSpec(band, [3, 0]).stretch).toEqual([8, 2])
    expect(specForBox(band, { minX: 10, minY: 0, maxX: 190, maxY: 20 }, [210, 297]).stretch).toEqual([10, 20])
    const text: PageElementSpec = { ...rect('t'), kind: 'text', text: 'Hi', font: 'sans', sizePt: 12, color: '#000000', size: [40, 1] }
    expect(specForBox(text, { minX: 0, minY: 0, maxX: 70, maxY: 50 }, [210, 297]).size).toEqual([70, 1])
  })
})

describe('new elements', () => {
  it('have valid defaults for every kind', () => {
    const kinds = ['text', 'shape', 'northArrow', 'scaleBar'] as const
    const elements = [
      ...kinds.map(k => newElement(k, k, [10, 10])),
      newElement('image', 'image', [10, 10], { asset: 'logo', aspect: 4 }),
      newElement('qr', 'qr', [10, 10], { url: 'https://www.livelox.com/' }),
    ]
    const doc = { ...event(), printLayout: { elements } }
    expect(eventDocSchema.safeParse(doc).success).toBe(true)
    expect(elements.find(e => e.kind === 'image')?.size).toEqual([40, 10])
  })

  it('need an asset for an image and an address for a QR code', () => {
    expect(code(() => newElement('image', 'i', [0, 0]))).toBe('invalid_layout')
    expect(code(() => newElement('qr', 'q', [0, 0]))).toBe('invalid_layout')
  })
})

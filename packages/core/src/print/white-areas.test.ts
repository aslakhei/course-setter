import { describe, expect, it } from 'vitest'
import { addControl, addCourse, insertCourseControl } from '../course/commands.ts'
import { CourseError, courseById, type EventDoc, emptyDoc, eventDocSchema, type PrintSettings } from '../course/doc.ts'
import type { PathCommand } from '../render/primitives.ts'
import { addLayoutElement, addWhiteArea, removeWhiteArea, setElementOverride, updateWhiteArea } from './edit.ts'
import type { PageElementSpec, WhiteArea } from './elements.ts'
import { insidePath, whiteAreaAt } from './geometry.ts'
import { printPage } from './layout.ts'

const settings: PrintSettings = { paper: 'A4', orientation: 'portrait', center: [1500, 2000], margin: 5, layout: [] }

/** Course K at 1:10 000 on an event whose page is centred on ground (1500, 2000). */
function event(): EventDoc {
  let doc = emptyDoc(10000)
  doc = addControl(doc, { id: 'a', kind: 'control', position: [1500, 2000] })
  doc = addCourse(doc, { id: 'K', name: 'K', printScale: 10000 })
  return insertCourseControl(doc, 'K', 'a')
}

/** A triangle on the map, 100 m on its sides, its lower-left corner at the page's centre. */
const onMap: WhiteArea = {
  id: 'garden',
  on: 'map',
  nodes: [{ at: [1500, 2000] }, { at: [1600, 2000] }, { at: [1500, 2100] }],
}
/** A rounded area on the page: a curve point at the top. */
const onPage: WhiteArea = {
  id: 'corner',
  on: 'page',
  nodes: [{ at: [10, 10], out: [20, 5] }, { at: [40, 10], in: [30, 5] }, { at: [25, 30] }],
}
const code = (f: () => unknown) => {
  try {
    f()
    return null
  } catch (err) {
    return err instanceof CourseError ? err.code : String(err)
  }
}

describe('white areas in the layout', () => {
  it('are added, changed and removed, with ids unique among elements too', () => {
    let doc = addWhiteArea(event(), 'K', settings, onMap)
    doc = updateWhiteArea(doc, 'K', settings, 'garden', a => ({ ...a, locked: true }))
    expect(doc.printLayout?.whiteAreas).toEqual([{ ...onMap, locked: true }])
    const element = { id: 'garden', kind: 'shape', shape: 'rect', anchor: 'tl', offset: [0, 0], size: [5, 5] } as PageElementSpec
    expect(code(() => addLayoutElement(doc, 'K', settings, element))).toBe('invalid_layout')
    expect(code(() => updateWhiteArea(doc, 'K', settings, 'nope', a => a))).toBe('invalid_layout')
    doc = removeWhiteArea(doc, 'K', settings, 'garden')
    expect(doc.printLayout?.whiteAreas).toBeUndefined()
    expect(eventDocSchema.safeParse(doc).success).toBe(true)
  })

  it('need three points or more', () => {
    expect(code(() => addWhiteArea(event(), 'K', settings, { ...onMap, nodes: onMap.nodes.slice(0, 2) }))).toBe('invalid_layout')
  })

  it('can be hidden on one course, and the hiding goes with the area', () => {
    let doc = addWhiteArea(event(), 'K', settings, onMap)
    doc = setElementOverride(doc, 'K', settings, 'garden', { hidden: true })
    const course = courseById(doc, 'K')
    expect(printPage(doc, course, 'x', course.print).whiteAreas).toEqual([])
    doc = removeWhiteArea(doc, 'K', course.print as PrintSettings, 'garden')
    expect(courseById(doc, 'K').print?.overrides).toBeUndefined()
  })
})

describe('white areas on the page', () => {
  it('put a map area where its ground is printed, and a page area at its page position', () => {
    const doc = { ...addWhiteArea(event(), 'K', settings, onMap), printLayout: { elements: [], whiteAreas: [onMap, onPage] } }
    const [garden, corner] = printPage(doc, courseById(doc, 'K'), 'x', settings).whiteAreas
    // Ground (1500, 2000) is the page's centre (105, 148.5); 100 m is 10 mm at 1:10 000.
    expect(garden?.commands).toEqual([['M', 105, 148.5], ['L', 115, 148.5], ['L', 105, 158.5], ['L', 105, 148.5], ['Z']])
    // Page points are y down from the top; curves where a point has a handle.
    expect(corner?.commands).toEqual([['M', 10, 287], ['C', 20, 292, 30, 292, 40, 287], ['L', 25, 267], ['L', 10, 287], ['Z']])
    expect(garden?.primitives[0]).toMatchObject({ type: 'path', filled: true, color: '#ffffff', owner: 'garden' })
  })

  it('stay on the terrain when the page moves; a page area stays on the page', () => {
    const doc = { ...event(), printLayout: { elements: [], whiteAreas: [onMap, onPage] } }
    const moved = { ...settings, center: [1600, 2000] as [number, number] }
    const [garden, corner] = printPage(doc, courseById(doc, 'K'), 'x', moved).whiteAreas
    expect(garden?.commands[0]).toEqual(['M', 95, 148.5])
    expect(corner?.commands[0]).toEqual(['M', 10, 287])
  })

  it('leave out areas hidden for every course', () => {
    const doc = { ...event(), printLayout: { elements: [], whiteAreas: [{ ...onMap, hidden: true }] } }
    expect(printPage(doc, courseById(doc, 'K'), 'x', settings).whiteAreas).toEqual([])
  })
})

describe('picking white areas', () => {
  it('finds a point inside a curved outline', () => {
    const doc = { ...event(), printLayout: { elements: [], whiteAreas: [onPage] } }
    const [corner] = printPage(doc, courseById(doc, 'K'), 'x', settings).whiteAreas
    const commands = corner?.commands ?? []
    // Inside the bulge the curve adds above the straight top edge (page y up: the top is 287 + …).
    expect(insidePath(commands, [25, 289])).toBe(true)
    expect(insidePath(commands, [25, 280])).toBe(true)
    expect(insidePath(commands, [25, 293])).toBe(false)
    expect(insidePath(commands, [45, 280])).toBe(false)
  })

  it('takes the topmost unlocked area', () => {
    const square = (x: number): PathCommand[] => [['M', x, 0], ['L', x + 10, 0], ['L', x + 10, 10], ['L', x, 10], ['Z']]
    const areas = [
      { id: 'a', commands: square(0), locked: false },
      { id: 'b', commands: square(5), locked: false },
      { id: 'c', commands: square(5), locked: true },
    ]
    expect(whiteAreaAt(areas, [7, 5])?.id).toBe('b')
    expect(whiteAreaAt(areas, [2, 5])?.id).toBe('a')
    expect(whiteAreaAt(areas, [30, 5])).toBeNull()
  })
})

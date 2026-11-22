import { describe, expect, it } from 'vitest'
import { addControl, addCourse, insertCourseControl, setPrintSettings } from '../course/commands.ts'
import { courseById, type EventDoc, emptyDoc, eventDocSchema, type PrintSettings } from '../course/doc.ts'
import { detachLayout, setElementOverride, setMapAreaRadius, setMapAreaStroke } from './edit.ts'
import type { PageElementSpec, PrintLayout } from './elements.ts'
import { printPage } from './layout.ts'
import {
  applyLayout,
  type Branding,
  DEFAULT_COLOURS,
  NO_BRANDING,
  parseTemplate,
  resolveTemplate,
  sponsorToken,
  TOKENS,
  tokenizeLayout,
} from './templates.ts'
import { UNIVERSAL_TEMPLATES } from './universal.ts'

const settings: PrintSettings = { paper: 'A4', orientation: 'portrait', center: [0, 0], margin: 5, layout: [] }
const BRANDING: Branding = { logo: 'logo-id', colour: '#1f5a3a', colour2: '#d9b44a', sponsors: ['s1', 's2'] }

function event(): EventDoc {
  let doc = emptyDoc(10000)
  doc = addControl(doc, { id: 'a', kind: 'control', position: [0, 0] })
  for (const id of ['A', 'B']) {
    doc = addCourse(doc, { id, name: id, printScale: 10000 })
    doc = insertCourseControl(doc, id, 'a')
  }
  return doc
}

const counter = () => {
  let n = 0
  return () => `id-${++n}`
}

const template: PrintLayout = {
  mapArea: { stroke: { color: TOKENS.colour2, width: 1 } },
  elements: [
    {
      id: 'band',
      kind: 'shape',
      shape: 'rect',
      anchor: 'tl',
      offset: [0, 0],
      stretch: [0, 0],
      size: [1, 20],
      fill: { color: TOKENS.colour, opacity: 1 },
    },
    { id: 'logo', kind: 'image', anchor: 'tr', offset: [5, 5], size: [10, 10], asset: TOKENS.logo },
    ...[1, 2, 3].map(
      (n): PageElementSpec => ({ id: `s${n}`, kind: 'image', anchor: 'br', offset: [n * 20, 5], size: [15, 8], asset: sponsorToken(n) }),
    ),
  ],
}

describe('resolving a template', () => {
  it('fills in the club’s logo, colours and sponsors, with new ids', () => {
    const layout = resolveTemplate(template, BRANDING, counter())
    expect(layout.mapArea?.stroke?.color).toBe('#d9b44a')
    expect(layout.elements.map(e => [e.id, e.kind === 'image' ? e.asset : e.kind === 'shape' ? e.fill?.color : null])).toEqual([
      ['id-1', '#1f5a3a'],
      ['id-2', 'logo-id'],
      ['id-3', 's1'],
      ['id-4', 's2'],
    ])
  })

  it('leaves out images it has nothing for, and takes default colours', () => {
    const layout = resolveTemplate(template, NO_BRANDING, counter())
    expect(layout.elements.map(e => e.kind)).toEqual(['shape'])
    expect(layout.elements[0]?.kind === 'shape' && layout.elements[0].fill?.color).toBe(DEFAULT_COLOURS.colour)
  })

  it('makes a valid layout of every universal template, with and without branding', () => {
    for (const t of UNIVERSAL_TEMPLATES)
      for (const b of [BRANDING, NO_BRANDING]) {
        const layout = resolveTemplate(t.layout, b, counter())
        expect(eventDocSchema.safeParse({ ...event(), printLayout: layout }).success, t.id).toBe(true)
      }
  })
})

describe('applying a layout', () => {
  const layout = resolveTemplate(template, BRANDING, counter())

  it('to every course: the shared layout, without the courses’ changes to the old one', () => {
    let doc: EventDoc = {
      ...event(),
      printLayout: {
        elements: [{ id: 'old', kind: 'scaleBar', anchor: 'br', offset: [5, 5], size: [30, 6], color: '#000000' } as PageElementSpec],
      },
    }
    doc = setElementOverride(doc, 'A', settings, 'old', { hidden: true })
    doc = detachLayout(doc, 'B', settings)
    doc = applyLayout(doc, layout, 'all')
    expect(doc.printLayout).toEqual(layout)
    expect(courseById(doc, 'A').print?.overrides).toBeUndefined()
    // B keeps its own layout.
    expect(courseById(doc, 'B').print?.ownLayout?.elements.map(e => e.id)).toEqual(['old'])
  })

  it('to one course: its own layout', () => {
    const doc = applyLayout(event(), layout, { courseId: 'A', settings })
    expect(courseById(doc, 'A').print?.ownLayout).toEqual(layout)
    expect(doc.printLayout).toBeUndefined()
  })
})

describe('a line round the map area', () => {
  it('is drawn round the (rounded) map area when the layout has one', () => {
    let doc = setMapAreaStroke(event(), 'A', settings, { color: '#1f5a3a', width: 1.2 })
    doc = setMapAreaRadius(doc, 'A', settings, 6)
    expect(doc.printLayout?.mapArea).toEqual({ stroke: { color: '#1f5a3a', width: 1.2 }, radius: 6 })
    const page = printPage(doc, courseById(doc, 'A'), 'x', settings)
    expect(page.mapOutline).toEqual([
      { type: 'path', role: 'layout', commands: page.mapClip, lineWidth: 1.2, join: 'round', color: '#1f5a3a' },
    ])
    const none = setMapAreaRadius(setMapAreaStroke(doc, 'A', settings, null), 'A', settings, 0)
    expect(none.printLayout?.mapArea).toBeUndefined()
    expect(printPage(none, courseById(none, 'A'), 'x', settings).mapOutline).toEqual([])
  })

  it('keeps the course’s other print settings when applied to one course', () => {
    const doc = setPrintSettings(event(), 'A', { ...settings, paper: 'A3' })
    const applied = applyLayout(doc, { elements: [] }, { courseId: 'A', settings: courseById(doc, 'A').print as PrintSettings })
    expect(courseById(applied, 'A').print?.paper).toBe('A3')
  })
})

describe('saving a layout as a template', () => {
  it('turns the club’s logo, colours and sponsors into tokens, and back for another club', () => {
    const layout = resolveTemplate(template, BRANDING, counter())
    const saved = tokenizeLayout(layout, BRANDING)
    expect(saved.mapArea?.stroke?.color).toBe(TOKENS.colour2)
    expect(saved.elements.map(e => (e.kind === 'image' ? e.asset : e.kind === 'shape' ? e.fill?.color : null))).toEqual([
      TOKENS.colour,
      TOKENS.logo,
      sponsorToken(1),
      sponsorToken(2),
    ])
    // In another club: its logo and colours.
    const other: Branding = { logo: 'their-logo', colour: '#c8102e', colour2: null, sponsors: [] }
    const there = resolveTemplate(saved, other, counter())
    expect(there.mapArea?.stroke?.color).toBe(DEFAULT_COLOURS.colour2)
    expect(there.elements.map(e => (e.kind === 'image' ? e.asset : e.kind === 'shape' ? e.fill?.color : null))).toEqual([
      '#c8102e',
      'their-logo',
    ])
  })

  it('keeps colours and images that are not the club’s', () => {
    const layout: PrintLayout = {
      elements: [
        { id: 'x', kind: 'text', anchor: 'tl', offset: [0, 0], size: [10, 1], text: 'Hi', font: 'sans', sizePt: 10, color: '#123456' },
      ],
    }
    expect(tokenizeLayout(layout, BRANDING)).toEqual(layout)
  })

  it('checks stored templates', () => {
    expect(parseTemplate(template)).toEqual(template)
    expect(parseTemplate(tokenizeLayout(resolveTemplate(template, BRANDING, counter()), BRANDING))).not.toBeNull()
    expect(parseTemplate({ elements: [{ id: 'x', kind: 'nonsense' }] })).toBeNull()
    expect(parseTemplate('no')).toBeNull()
  })
})

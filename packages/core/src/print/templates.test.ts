import { describe, expect, it } from 'vitest'
import { addControl, addCourse, insertCourseControl, setPrintSettings } from '../course/commands.ts'
import { courseById, type EventDoc, emptyDoc, eventDocSchema, type PrintSettings } from '../course/doc.ts'
import { detachLayout, setElementOverride, setMapAreaBands, setMapAreaRadius, setMapAreaStroke } from './edit.ts'
import type { PageElementSpec, PrintLayout } from './elements.ts'
import { printPage } from './layout.ts'
import {
  applyLayout,
  type Branding,
  clubColours,
  DEFAULT_COLOUR,
  fitImages,
  NO_BRANDING,
  parseTemplate,
  resolveTemplate,
  sponsorToken,
  TOKENS,
  tokenizeLayout,
} from './templates.ts'
import { UNIVERSAL_TEMPLATES, universalLayout } from './universal.ts'

const settings: PrintSettings = { paper: 'A4', orientation: 'portrait', center: [0, 0], margin: 5, layout: [] }
const BRANDING: Branding = { logo: 'logo-id', colour: '#1f5a3a', colour2: '#d9b44a', colour3: null, sponsors: ['s1', 's2'] }

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
    expect(layout.elements[0]?.kind === 'shape' && layout.elements[0].fill?.color).toBe(DEFAULT_COLOUR)
  })

  it('makes a valid layout of every universal template, with and without branding', () => {
    for (const t of UNIVERSAL_TEMPLATES)
      for (const b of [BRANDING, NO_BRANDING, { ...BRANDING, colour3: '#ffffff' }]) {
        const layout = resolveTemplate(universalLayout(t, b), b, counter())
        expect(eventDocSchema.safeParse({ ...event(), printLayout: layout }).success, t.id).toBe(true)
      }
  })

  it('counts the colours the club has set, gaps closed up, the default when none', () => {
    expect(clubColours(NO_BRANDING)).toEqual([DEFAULT_COLOUR])
    expect(clubColours(BRANDING)).toEqual(['#1f5a3a', '#d9b44a'])
    expect(clubColours({ ...NO_BRANDING, colour: '#111111', colour3: '#333333' })).toEqual(['#111111', '#333333'])
  })

  it('gives a colour the club lacks its last one', () => {
    const three: PrintLayout = {
      elements: [TOKENS.colour, TOKENS.colour2, TOKENS.colour3].map(
        (color, i): PageElementSpec => ({ id: `t${i}`, kind: 'scaleBar', anchor: 'br', offset: [5, 5 + i * 10], size: [30, 6], color }),
      ),
    }
    const colours = (b: Branding) => resolveTemplate(three, b, counter()).elements.map(e => (e.kind === 'scaleBar' ? e.color : null))
    expect(colours({ ...NO_BRANDING, colour: '#111111' })).toEqual(['#111111', '#111111', '#111111'])
    expect(colours(BRANDING)).toEqual(['#1f5a3a', '#d9b44a', '#d9b44a'])
    expect(colours({ ...BRANDING, colour3: '#333333' })).toEqual(['#1f5a3a', '#d9b44a', '#333333'])
  })

  it('makes the stripes and ribbon templates for as many colours as the club has', () => {
    const stripes = UNIVERSAL_TEMPLATES.find(t => t.id === 'stripes')
    const ribbon = UNIVERSAL_TEMPLATES.find(t => t.id === 'ribbon')
    if (!stripes || !ribbon) throw new Error('missing template')
    const clubs: Branding[] = [
      { ...NO_BRANDING, colour: '#111111' },
      { ...NO_BRANDING, colour: '#111111', colour2: '#222222' },
      { ...NO_BRANDING, colour: '#111111', colour2: '#222222', colour3: '#333333' },
    ]
    expect(clubs.map(b => resolveTemplate(universalLayout(stripes, b), b, counter()).mapArea?.bands?.map(band => band.color))).toEqual([
      ['#111111'],
      ['#111111', '#222222'],
      ['#111111', '#222222', '#333333'],
    ])
    const fills = (b: Branding) =>
      resolveTemplate(universalLayout(ribbon, b), b, counter()).elements.flatMap(e => (e.kind === 'shape' ? [e.fill?.color] : []))
    expect(clubs.map(fills)).toEqual([
      ['#111111', '#111111'],
      ['#111111', '#222222', '#111111', '#222222'],
      ['#111111', '#222222', '#333333', '#111111', '#222222', '#333333'],
    ])
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

  it('has coloured bands round it, outermost first, taking their width from the map area', () => {
    const plain = printPage(event(), courseById(event(), 'A'), 'x', settings)
    let doc = setMapAreaBands(event(), 'A', settings, [
      { color: '#111111', width: 2 },
      { color: '#222222', width: 1 },
    ])
    doc = setMapAreaStroke(doc, 'A', settings, { color: '#000000', width: 0.2 })
    const page = printPage(doc, courseById(doc, 'A'), 'x', settings)
    expect(page.mapArea).toEqual({
      minX: plain.mapArea.minX + 3,
      minY: plain.mapArea.minY + 3,
      maxX: plain.mapArea.maxX - 3,
      maxY: plain.mapArea.maxY - 3,
    })
    // The bands fill the space between the margin and the map, the line on the map's edge last.
    expect(page.mapOutline.map(p => (p.type === 'path' ? [p.color, p.lineWidth, p.commands[0]] : null))).toEqual([
      ['#111111', 2, ['M', plain.mapArea.minX + 1, plain.mapArea.maxY - 1]],
      ['#222222', 1, ['M', plain.mapArea.minX + 2.5, plain.mapArea.maxY - 2.5]],
      ['#000000', 0.2, ['M', page.mapArea.minX, page.mapArea.maxY]],
    ])
    // The map stays where it was: only less of it shows.
    expect(page.groundArea.minX).toBeGreaterThan(plain.groundArea.minX)
    expect((page.groundArea.minX + page.groundArea.maxX) / 2).toBeCloseTo((plain.groundArea.minX + plain.groundArea.maxX) / 2)
    expect(setMapAreaBands(doc, 'A', settings, [])?.printLayout?.mapArea).toEqual({ stroke: { color: '#000000', width: 0.2 } })
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
    const other: Branding = { logo: 'their-logo', colour: '#c8102e', colour2: null, colour3: null, sponsors: [] }
    const there = resolveTemplate(saved, other, counter())
    // The club has one colour: it goes where the second one went.
    expect(there.mapArea?.stroke?.color).toBe('#c8102e')
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

  it('takes a colour the club has once as its first token, in a club with fewer colours', () => {
    const one: Branding = { ...NO_BRANDING, colour: '#c8102e' }
    const layout: PrintLayout = { mapArea: { stroke: { color: '#C8102E', width: 1 } }, elements: [] }
    expect(tokenizeLayout(layout, one).mapArea?.stroke?.color).toBe(TOKENS.colour)
    const three: Branding = { ...BRANDING, colour3: '#333333' }
    expect(tokenizeLayout({ ...layout, mapArea: { stroke: { color: '#333333', width: 1 } } }, three).mapArea?.stroke?.color).toBe(
      TOKENS.colour3,
    )
  })

  it('checks stored templates', () => {
    expect(parseTemplate(template)).toEqual(template)
    expect(parseTemplate(tokenizeLayout(resolveTemplate(template, BRANDING, counter()), BRANDING))).not.toBeNull()
    expect(parseTemplate({ elements: [{ id: 'x', kind: 'nonsense' }] })).toBeNull()
    expect(parseTemplate('no')).toBeNull()
  })
})

describe('fitting images to their pictures', () => {
  type Image = Extract<PageElementSpec, { kind: 'image' }>
  const image = (anchor: Image['anchor'], size: [number, number], extra: Partial<Image> = {}): Image => ({
    id: 'i',
    kind: 'image',
    anchor,
    offset: [5, 5],
    size,
    asset: 'a',
    ...extra,
  })
  const fitted = (e: Image, aspect: number | null) => {
    const out = fitImages({ elements: [e] }, () => aspect).elements[0]
    return out ? { size: out.size, offset: out.offset } : null
  }

  it('makes the box the picture’s shape, as large as fits, centred where the box was', () => {
    expect(fitted(image('tr', [18, 18]), 3)).toEqual({ size: [18, 6], offset: [5, 11] })
    expect(fitted(image('bl', [18, 18]), 0.5)).toEqual({ size: [9, 18], offset: [9.5, 5] })
    expect(fitted(image('br', [36, 14]), 2)).toEqual({ size: [28, 14], offset: [9, 5] })
    // An element in the middle of an edge stays centred on it.
    expect(fitted(image('t', [18, 18]), 3)).toEqual({ size: [18, 6], offset: [5, 11] })
    expect(fitted(image('c', [18, 18]), 3)).toEqual({ size: [18, 6], offset: [5, 5] })
  })

  it('keeps boxes of pictures it does not know, and images stretched across the page', () => {
    expect(fitted(image('tr', [18, 18]), null)).toEqual({ size: [18, 18], offset: [5, 5] })
    expect(fitted(image('tl', [18, 18], { stretch: [0, 0] }), 2)).toEqual({ size: [18, 18], offset: [5, 5] })
  })

  it('leaves other elements alone', () => {
    const layout: PrintLayout = { elements: [{ id: 's', kind: 'scaleBar', anchor: 'br', offset: [5, 5], size: [30, 6], color: '#000000' }] }
    expect(fitImages(layout, () => 2)).toEqual(layout)
  })
})

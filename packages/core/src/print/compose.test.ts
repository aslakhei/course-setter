import { createCanvas } from '@napi-rs/canvas'
import jsQR from 'jsqr'
import { describe, expect, it } from 'vitest'
import { addControl, addCourse, insertCourseControl, updateCourse } from '../course/commands.ts'
import {
  ALL_CONTROLS,
  courseById,
  type EventDoc,
  emptyDoc,
  eventDocSchema,
  type Point,
  type PrintSettings,
  parseDoc,
} from '../course/doc.ts'
import { testEvent } from '../course/test-doc.ts'
import { drawPrimitives, paperToDevice } from '../render/canvas.ts'
import type { Primitive } from '../render/primitives.ts'
import { MM_PER_PT, textWidth } from '../text/lines.ts'
import { composeLayout, elementBox, fieldValues, fillFields, layoutFor, type PageContext } from './compose.ts'
import type { PageElementSpec, PrintLayout } from './elements.ts'
import { defaultPrintSettings, pagePosition, pageSize, placeDescriptions, printPage } from './layout.ts'
import { scaleBarLength } from './marks.ts'

/** A course at 1:10 000 with two controls 1 km apart, east-west. */
function kilometre(layout?: PrintLayout): EventDoc {
  let doc = emptyDoc(10000)
  doc = addControl(doc, { id: 'a', kind: 'control', position: [1000, 2000] })
  doc = addControl(doc, { id: 'b', kind: 'control', position: [2000, 2000] })
  doc = addCourse(doc, { id: 'K', name: 'Long', printScale: 10000 })
  doc = insertCourseControl(doc, 'K', 'a')
  doc = insertCourseControl(doc, 'K', 'b')
  return layout ? { ...doc, printLayout: layout } : doc
}

const settings = (over: Partial<PrintSettings> = {}): PrintSettings => ({
  paper: 'A4',
  orientation: 'portrait',
  center: [1500, 2000],
  margin: 5,
  layout: [],
  ...over,
})

const box = (over: Partial<PageElementSpec> = {}): PageElementSpec =>
  ({ id: 'x', kind: 'shape', shape: 'rect', anchor: 'tl', offset: [10, 5], size: [40, 20], ...over }) as PageElementSpec

const CONTEXT: PageContext = {
  eventDate: '2026-11-22',
  clubName: 'Hamar OK',
  setter: 'Kari Nordmann',
  map: { name: 'Lillehammer nord', contour: 5, mapper: 'Ola Mapper', year: 2024 },
}

describe('fields', () => {
  it('fills in the course, the event, the club and the map', () => {
    let doc = kilometre()
    doc = updateCourse(doc, 'K', { climb: 45 })
    const values = fieldValues(doc, courseById(doc, 'K'), 'Club night', CONTEXT)
    const text =
      '{event} {date}: {course} {length}, {climb}, {controls} controls, {scale}, {contour} contours, {map} ({mapper} {mapYear}), {club}, {setter}'
    expect(fillFields(text, values)).toBe(
      'Club night 22 November 2026: Long 1.0 km, 45 m, 2 controls, 1:10 000, 5 m contours, Lillehammer nord (Ola Mapper 2024), Hamar OK, Kari Nordmann',
    )
  })

  it('leaves missing values empty and unknown braces as they are', () => {
    const doc = kilometre()
    const values = fieldValues(doc, courseById(doc, 'K'), 'Club night')
    expect(fillFields('Contour {contour}|{date}|{climb}|{nope}', values)).toBe('Contour |||{nope}')
  })

  it('counts every control and gives no length on the all-controls page', () => {
    const doc = testEvent()
    const values = fieldValues(doc, courseById(doc, ALL_CONTROLS), 'x')
    expect(values.controls).toBe(String(doc.controls.filter(c => c.kind === 'control').length))
    expect(values.length).toBe('')
  })
})

describe('elementBox', () => {
  const pages: [string, Point][] = [
    ['A4 portrait', pageSize('A4', 'portrait')],
    ['A4 landscape', pageSize('A4', 'landscape')],
    ['A3 portrait', pageSize('A3', 'portrait')],
  ]

  it.each(pages)('pins an element to each corner, edge middle and the centre of %s', (_, size) => {
    const [W, H] = size
    const at = (anchor: PageElementSpec['anchor']) => elementBox(box({ anchor }), size, 40, 20)
    // Corners: 10 mm in from the side, 5 mm in from the top or bottom (page y up).
    expect(at('tl')).toEqual({ minX: 10, maxX: 50, minY: H - 25, maxY: H - 5 })
    expect(at('tr')).toEqual({ minX: W - 50, maxX: W - 10, minY: H - 25, maxY: H - 5 })
    expect(at('bl')).toEqual({ minX: 10, maxX: 50, minY: 5, maxY: 25 })
    expect(at('br')).toEqual({ minX: W - 50, maxX: W - 10, minY: 5, maxY: 25 })
    // Middles: centred, moved right and down by the offset.
    expect(at('t')).toEqual({ minX: (W - 40) / 2 + 10, maxX: (W + 40) / 2 + 10, minY: H - 25, maxY: H - 5 })
    expect(at('l')).toEqual({ minX: 10, maxX: 50, minY: (H - 20) / 2 - 5, maxY: (H + 20) / 2 - 5 })
    expect(at('c').minX).toBeCloseTo((W - 40) / 2 + 10, 9)
    expect(at('r').maxX).toBe(W - 10)
    expect(at('b').minY).toBe(5)
  })

  it.each(pages)('stretches a band between its insets on %s', (_, size) => {
    const band = box({ anchor: 'tl', offset: [0, 0], stretch: [5, 5], size: [1, 15] })
    const placed = composeLayout(kilometre({ elements: [band] }), courseById(kilometre(), 'K'), 'x', settings(), size).elements[0]
    expect(placed?.box).toEqual({ minX: 5, maxX: size[0] - 5, minY: size[1] - 15, maxY: size[1] })
  })
})

describe('layoutFor', () => {
  const layout: PrintLayout = { elements: [box({ id: 'a' }), box({ id: 'b' }), box({ id: 'c' })] }
  const doc = kilometre(layout)

  it('is the shared layout with the course moving, resizing or hiding single elements', () => {
    const own = layoutFor(doc, settings({ overrides: { a: { offset: [20, 30] }, b: { size: [10, 10] }, c: { hidden: true } } }))
    expect(own.elements.map(e => [e.id, e.offset, e.size])).toEqual([
      ['a', [20, 30], [40, 20]],
      ['b', [10, 5], [10, 10]],
    ])
    expect(layoutFor(doc, undefined)).toEqual(layout)
  })

  it("is the course's own layout when it has one, without overrides", () => {
    const ownLayout: PrintLayout = { elements: [box({ id: 'mine' })] }
    expect(layoutFor(doc, settings({ ownLayout, overrides: { mine: { hidden: true } } }))).toEqual(ownLayout)
  })

  it('is empty for an event without a layout', () => {
    expect(layoutFor(kilometre(), settings())).toEqual({ elements: [] })
  })
})

describe('printPage with a layout', () => {
  const header = box({
    id: 'header',
    anchor: 'tl',
    offset: [0, 0],
    stretch: [0, 0],
    size: [1, 30],
    pushMap: true,
    fill: { color: '#0b62a4', opacity: 1 },
  })
  const footer = box({ id: 'footer', anchor: 'bl', offset: [0, 0], stretch: [0, 0], size: [1, 12], pushMap: true, backing: { padding: 2 } })

  it('keeps the map clear of bands without moving it', () => {
    const plain = kilometre()
    const banded = kilometre({ elements: [header, footer] })
    const [course, s] = [courseById(plain, 'K'), settings()]
    const without = printPage(plain, course, 'x', s)
    const withBands = printPage(banded, courseById(banded, 'K'), 'x', s)
    expect(without.mapArea).toEqual({ minX: 5, minY: 5, maxX: 205, maxY: 292 })
    // The header ends 30 mm below the top; the footer (with its 2 mm white backing) 14 mm above the bottom.
    expect(withBands.mapArea).toEqual({ minX: 5, minY: 14, maxX: 205, maxY: 267 })
    // The course is where it was; the ground shown shrinks with the map area.
    expect(withBands.course).toEqual(without.course)
    expect(pagePosition(course, s, [1500, 2000])).toEqual([105, 148.5])
    expect(withBands.groundArea.maxY - withBands.groundArea.minY).toBeCloseTo((267 - 14) * 10, 6)
    expect(withBands.groundArea.maxY).toBeCloseTo(2000 + (267 - 148.5) * 10, 6)
  })

  it('places the description sheet clear of bands, and keeps it there when dragged', () => {
    const doc = kilometre({ elements: [header] })
    const course = courseById(doc, 'K')
    const defaults = defaultPrintSettings(doc, course, 'x')
    const page = printPage(doc, course, 'x', defaults)
    expect(page.descriptions?.box.maxY).toBeLessThanOrEqual(267 + 1e-9)
    const dragged = placeDescriptions(doc, course, 'x', defaults, [10, 0])
    expect(printPage(doc, course, 'x', dragged).descriptions?.box.maxY).toBeLessThanOrEqual(267 + 1e-9)
  })

  it('rounds the map area corners when the layout says so', () => {
    const doc = kilometre({ elements: [], mapArea: { radius: 8 } })
    const page = printPage(doc, courseById(doc, 'K'), 'x', settings())
    expect(page.mapClip.filter(c => c[0] === 'C')).toHaveLength(4)
    expect(printPage(kilometre(), courseById(doc, 'K'), 'x', settings()).mapClip.some(c => c[0] === 'C')).toBe(false)
  })

  it('draws a text element with its fields filled in, as high as its lines, pinned by its bottom', () => {
    const title: PageElementSpec = {
      id: 't',
      kind: 'text',
      anchor: 'bl',
      offset: [10, 8],
      size: [60, 1],
      text: '{course}\n{length}',
      font: 'display-bold',
      sizePt: 20,
      color: '#0b62a4',
    }
    const doc = kilometre({ elements: [title] })
    const [placed] = printPage(doc, courseById(doc, 'K'), 'x', settings(), CONTEXT).elements
    const lines = placed?.primitives.filter((p): p is Extract<Primitive, { type: 'textLine' }> => p.type === 'textLine') ?? []
    expect(lines.map(l => l.text)).toEqual(['Long', '1.0 km'])
    expect(lines.every(l => l.color === '#0b62a4' && l.owner === 't')).toBe(true)
    expect(placed?.box.minY).toBeCloseTo(8, 9)
    expect((placed?.box.maxY ?? 0) - (placed?.box.minY ?? 0)).toBeCloseTo(2 * 1.2 * 20 * MM_PER_PT, 9)
  })

  it('puts a white backing box first, reaching its padding beyond the element', () => {
    const doc = kilometre({ elements: [box({ backing: { padding: 3 }, stroke: { color: '#000000', width: 0.5 } })] })
    const [placed] = printPage(doc, courseById(doc, 'K'), 'x', settings()).elements
    const [first] = placed?.primitives ?? []
    expect(first).toMatchObject({ type: 'path', filled: true, color: '#ffffff' })
    const xs = first?.type === 'path' ? first.commands.flatMap(c => (c[0] === 'M' || c[0] === 'L' ? [c[1]] : [])) : []
    expect(Math.min(...xs)).toBe(7)
    expect(Math.max(...xs)).toBe(53)
  })

  it('prints old documents (no layout) as before', () => {
    const raw = JSON.parse(JSON.stringify(kilometre()))
    const doc = parseDoc(raw, 10000)
    expect(doc.printLayout).toBeUndefined()
    expect(printPage(doc, courseById(doc, 'K'), 'x', settings()).elements).toEqual([])
  })
})

describe('the layout schema', () => {
  it('refuses duplicate element ids and QR codes of anything but web addresses', () => {
    const doc = kilometre()
    expect(eventDocSchema.safeParse({ ...doc, printLayout: { elements: [box(), box()] } }).success).toBe(false)
    const qr = (url: string) => ({ ...doc, printLayout: { elements: [{ ...box(), kind: 'qr', url, color: '#000000' }] } })
    expect(eventDocSchema.safeParse(qr('https://livelox.com/x')).success).toBe(true)
    expect(eventDocSchema.safeParse(qr('javascript:alert(1)')).success).toBe(false)
  })
})

describe('scale bars', () => {
  it('show the longest round length that fits, measuring true at the print scale', () => {
    const label = 3
    for (const [width, scale] of [
      [40, 10000],
      [40, 15000],
      [25, 4000],
      [80, 7500],
    ] as const) {
      const metres = scaleBarLength(width, scale, label)
      const room =
        width - textWidth('0', 'sans', label) / 2 - textWidth(metres >= 1000 ? `${metres / 1000} km` : `${metres} m`, 'sans', label) / 2
      expect((metres * 1000) / scale, `${width} mm at 1:${scale}`).toBeLessThanOrEqual(room)
      expect([1, 2, 2.5, 5]).toContain(metres / 10 ** Math.floor(Math.log10(metres)))
    }
    expect(scaleBarLength(40, 10000, label)).toBe(250)
  })

  it('draws a bar of N metres N·1000/scale mm long', () => {
    const doc = kilometre({ elements: [box({ kind: 'scaleBar', color: '#000000', size: [40, 8] } as Partial<PageElementSpec>)] })
    const [placed] = printPage(doc, courseById(doc, 'K'), 'x', settings()).elements
    const outline = placed?.primitives.find(p => p.type === 'path' && !p.filled)
    const xs = outline?.type === 'path' ? outline.commands.flatMap(c => (c[0] === 'M' || c[0] === 'L' ? [c[1]] : [])) : []
    const width = Math.max(...xs) - Math.min(...xs) + (outline?.type === 'path' ? outline.lineWidth : 0)
    const labels = placed?.primitives.filter(p => p.type === 'textLine').map(p => (p.type === 'textLine' ? p.text : ''))
    const metres = Number.parseFloat(labels?.at(-1) ?? '')
    expect(width).toBeCloseTo((metres * 1000) / 10000, 6)
  })
})

describe('QR codes', () => {
  it('read back as their web address', () => {
    const url = 'https://www.livelox.com/Events/Show/123456'
    const doc = kilometre({ elements: [box({ kind: 'qr', url, color: '#000000', size: [30, 30] } as Partial<PageElementSpec>)] })
    const [placed] = printPage(doc, courseById(doc, 'K'), 'x', settings()).elements
    // Drawn at 10 px per mm with a quiet zone round it.
    const pxPerMm = 10
    const b = placed?.box ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 }
    const canvas = createCanvas(400, 400)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 400, 400)
    drawPrimitives(ctx, placed?.primitives ?? [], { transform: paperToDevice(pxPerMm, [b.minX - 5, b.minY - 5], 400), color: '#000' })
    // jsqr is CommonJS: its function is module.exports and also its .default, which is what the types know.
    const read = jsQR.default(ctx.getImageData(0, 0, 400, 400).data, 400, 400)
    expect(read?.data).toBe(url)
  })
})

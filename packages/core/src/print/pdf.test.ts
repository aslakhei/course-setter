// A whole printed page, rendered with mupdf and measured: the scale, the overprint effect, the margin,
// the description sheet's white box, and a print layout over the map.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createCanvas } from '@napi-rs/canvas'
import fontkit from '@pdf-lib/fontkit'
import * as mupdf from 'mupdf'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { addControl, addCourse, insertCourseControl } from '../course/commands.ts'
import { courseById, type EventDoc, emptyDoc, type PrintSettings } from '../course/doc.ts'
import { PT_PER_MM } from '../render/pdf.ts'
import { FONT_FEATURES, FONTS } from '../text/fonts.ts'
import type { PrintLayout } from './elements.ts'
import { fontsOnPage, mapAreaOf, printPage } from './layout.ts'
import { addPrintPage } from './pdf.ts'

const FONT = fileURLToPath(new URL('../../fonts/LiberationSans-Regular.ttf', import.meta.url))
const BOLD = fileURLToPath(new URL('../../fonts/LiberationSans-Bold.ttf', import.meta.url))
const PX_PER_MM = 10
const GREY = 128

/** Controls a (1000, 2000) and b (2000, 2000), 1 km apart, and c far outside the page; 1:10 000. */
function event(): EventDoc {
  let doc = emptyDoc(10000)
  doc = addControl(doc, { id: 'a', kind: 'control', position: [1000, 2000] })
  doc = addControl(doc, { id: 'b', kind: 'control', position: [2000, 2000] })
  doc = addCourse(doc, { id: 'K', name: 'Km', printScale: 10000 })
  doc = insertCourseControl(doc, 'K', 'a')
  return insertCourseControl(doc, 'K', 'b')
}

const SETTINGS: PrintSettings = {
  paper: 'A4',
  orientation: 'portrait',
  center: [1500, 2000],
  margin: 5,
  layout: [{ kind: 'descriptions', at: [10, 10] }],
}

async function render(
  doc = event(),
  settings = SETTINGS,
): Promise<{ width: number; height: number; px: (xMm: number, yUpMm: number) => [number, number, number] }> {
  const page = printPage(doc, courseById(doc, 'K'), 'Test', settings)
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  const layout: Record<string, Awaited<ReturnType<typeof pdf.embedFont>>> = {}
  for (const id of fontsOnPage(page)) {
    const file = fileURLToPath(new URL(`../../fonts/${FONTS[id].file}`, import.meta.url))
    layout[id] = await pdf.embedFont(readFileSync(file), { subset: true, features: FONT_FEATURES })
  }
  const fonts = {
    regular: await pdf.embedFont(readFileSync(FONT), { subset: true }),
    bold: await pdf.embedFont(readFileSync(BOLD), { subset: true }),
    digitHeight: 1409 / 2048,
    layout,
  }
  // A plain grey map image of the whole area inside the margin, 2 px per mm: the page clips it to its map area.
  const area = mapAreaOf(page.size, settings.margin)
  const canvas = createCanvas(Math.round((area.maxX - area.minX) * 2), Math.round((area.maxY - area.minY) * 2))
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = `rgb(${GREY}, ${GREY}, ${GREY})`
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const image = await pdf.embedPng(canvas.toBuffer('image/png'))
  addPrintPage(pdf, page, { kind: 'image', image, at: area }, fonts)
  const rendered = mupdf.Document.openDocument(await pdf.save(), 'application/pdf')
  const k = PX_PER_MM / PT_PER_MM
  const pixmap = rendered.loadPage(0).toPixmap(mupdf.Matrix.scale(k, k), mupdf.ColorSpace.DeviceRGB, false)
  const data = new Uint8Array(pixmap.getPixels())
  const [width, height, n] = [pixmap.getWidth(), pixmap.getHeight(), pixmap.getNumberOfComponents()]
  const px = (xMm: number, yUpMm: number): [number, number, number] => {
    const x = Math.round(xMm * PX_PER_MM)
    const y = Math.round((page.size[1] - yUpMm) * PX_PER_MM)
    const i = (y * width + x) * n
    return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0]
  }
  return { width, height, px }
}

/** Purple over the grey map, multiplied: much more red than green. */
const isPurple = ([r, g]: [number, number, number]) => r - g > 25

describe('a printed page', () => {
  it('is A4 at 1:10 000: the control circles are 100.0 mm apart (±0.1 mm)', async () => {
    const { px } = await render()
    // Centroid of the purple ring round each expected centre (page mm), within 4.3 mm: the circle
    // (radius 3.75 mm) but not the course line, which starts 4.65 mm out.
    const centroid = (cx: number, cy: number): [number, number] => {
      let [sx, sy, n] = [0, 0, 0]
      for (let x = cx - 4.3; x <= cx + 4.3; x += 1 / PX_PER_MM)
        for (let y = cy - 4.3; y <= cy + 4.3; y += 1 / PX_PER_MM) {
          if (Math.hypot(x - cx, y - cy) > 4.3 || !isPurple(px(x, y))) continue
          sx += x
          sy += y
          n++
        }
      return [sx / n, sy / n]
    }
    const a = centroid(55, 148.5)
    const b = centroid(155, 148.5)
    expect(b[0] - a[0]).toBeGreaterThan(99.9)
    expect(b[0] - a[0]).toBeLessThan(100.1)
    expect(Math.abs(b[1] - a[1])).toBeLessThan(0.1)
  })

  it('multiplies the purple onto the map, keeps the margin white and the description sheet on white', async () => {
    const { px } = await render()
    // On control a's ring (radius 3.75 mm): purple multiplied with grey is darker than purple itself (181, 23, 158).
    const ring = px(55 + 3.75, 148.5)
    expect(isPurple(ring)).toBe(true)
    expect(ring[0]).toBeLessThan(120)
    // The map shows in the map area, the margin is white.
    expect(px(100, 100)).toEqual([GREY, GREY, GREY])
    expect(px(2, 100)).toEqual([255, 255, 255])
    // The sheet's box (top-left at 10, 10 mm from the page's top-left) is white between its lines.
    const inside = px(10 + 6 * 2.5, 297 - 10 - 6 * 2.5)
    expect(inside).toEqual([255, 255, 255])
  })
})

describe('a printed page with a print layout', () => {
  const layout: PrintLayout = {
    mapArea: { radius: 10 },
    elements: [
      // A blue header band 30 mm high that keeps the map clear of it.
      {
        id: 'band',
        kind: 'shape',
        shape: 'rect',
        anchor: 'tl',
        offset: [0, 0],
        stretch: [0, 0],
        size: [1, 30],
        pushMap: true,
        fill: { color: '#0b62a4', opacity: 1 },
      },
      {
        id: 'title',
        kind: 'text',
        anchor: 'tl',
        offset: [10, 8],
        size: [150, 1],
        text: '{course}',
        font: 'display-bold',
        sizePt: 28,
        color: '#ffffff',
      },
      // A white box over control a (55, 148.5 mm).
      {
        id: 'cover',
        kind: 'shape',
        shape: 'rect',
        anchor: 'tl',
        offset: [49, 297 - 148.5 - 6],
        size: [12, 12],
        fill: { color: '#ffffff', opacity: 1 },
      },
    ],
  }

  it('draws the layout over the map and the course, and keeps the map in its rounded area', async () => {
    const { px } = await render({ ...event(), printLayout: layout }, { ...SETTINGS, layout: [] })
    // The band covers the top of the page; the map starts below it.
    expect(px(180, 280)).toEqual([0x0b, 0x62, 0xa4])
    expect(px(180, 260)).toEqual([GREY, GREY, GREY])
    // The title is drawn in white on the band (somewhere in its first letters).
    let white = 0
    for (let x = 10; x < 30; x += 0.2) if (px(x, 297 - 14)[0] === 255) white++
    expect(white).toBeGreaterThan(5)
    // The white box hides control a's ring; control b's ring is purple as before.
    expect(px(55 + 3.75, 148.5)).toEqual([255, 255, 255])
    expect(isPurple(px(155 + 3.75, 148.5))).toBe(true)
    // Rounded corners: just inside the bottom-left corner of the map area is white, a little further in is map.
    expect(px(6, 6)).toEqual([255, 255, 255])
    expect(px(6, 30)).toEqual([GREY, GREY, GREY])
  })
})

describe('a printed page with a white area', () => {
  it('covers the map with white under the course', async () => {
    // A square on the map round control a (ground 1000, 2000; page 55, 148.5 mm), 200 m on a side.
    const layout: PrintLayout = {
      elements: [],
      whiteAreas: [{ id: 'w', on: 'map', nodes: [{ at: [900, 1900] }, { at: [1100, 1900] }, { at: [1100, 2100] }, { at: [900, 2100] }] }],
    }
    const { px } = await render({ ...event(), printLayout: layout }, { ...SETTINGS, layout: [] })
    // The map is white inside the square, grey outside it.
    expect(px(50, 152)).toEqual([255, 255, 255])
    expect(px(70, 152)).toEqual([GREY, GREY, GREY])
    // Control a's ring is still drawn, in pure purple on the white.
    const ring = px(55 + 3.75, 148.5)
    expect(isPurple(ring)).toBe(true)
    expect(ring[0]).toBeGreaterThan(150)
  })
})

// Layout images: checked by their content, measured, previewed, and printed at the size of their box.
import {
  addControl,
  addCourse,
  type EventDoc,
  emptyDoc,
  insertCourseControl,
  type PageElementSpec,
  setPrintSettings,
} from '@course-setter/core'
import { MissingAssetError } from '@course-setter/core/pdf'
import * as mupdf from 'mupdf'
import { PDFDocument, type PDFImage, rgb } from 'pdf-lib'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { makeExport } from '../exports/render.ts'
import { PT_PER_MM } from '../maps/source.ts'
import { AssetError, type AssetFile, embedAsset, inspectImage, MAX_BYTES, sniff, svgHasExternalReferences } from './image.ts'

const RED = { r: 255, g: 0, b: 0 }
const png = (w = 400, h = 200) =>
  sharp({ create: { width: w, height: h, channels: 3, background: RED } })
    .png()
    .toBuffer()
const jpeg = (cmyk = false) => {
  const image = sharp({ create: { width: 300, height: 150, channels: 3, background: RED } })
  return (cmyk ? image.toColourspace('cmyk') : image).jpeg({ quality: 95 }).toBuffer()
}
const SVG = Buffer.from(
  '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><rect width="200" height="100" fill="#ff0000"/></svg>',
)
async function pdfImage(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  doc.addPage([100, 50]).drawRectangle({ x: 0, y: 0, width: 100, height: 50, color: rgb(1, 0, 0) })
  return Buffer.from(await doc.save())
}

const code = async (p: Promise<unknown>) => {
  try {
    await p
    return null
  } catch (err) {
    return err instanceof AssetError ? err.code : String(err)
  }
}

describe('checking an uploaded image', () => {
  it('knows each kind by its first bytes', async () => {
    expect(sniff(await png())).toBe('png')
    expect(sniff(await jpeg())).toBe('jpeg')
    expect(sniff(SVG)).toBe('svg')
    expect(sniff(Buffer.from('﻿<!-- logo -->\n<svg viewBox="0 0 1 1"></svg>'))).toBe('svg')
    expect(sniff(await pdfImage())).toBe('pdf')
    expect(sniff(Buffer.from('GIF89a'))).toBeNull()
    expect(sniff(Buffer.from('<html><svg></svg></html>'))).toBeNull()
  })

  it('reads the natural size: pixels, SVG units, PDF points; and previews a PDF', async () => {
    expect(await inspectImage(await png(), 'png')).toEqual({ kind: 'png', width: 400, height: 200 })
    expect(await inspectImage(await jpeg(), 'jpeg')).toEqual({ kind: 'jpeg', width: 300, height: 150 })
    expect(await inspectImage(SVG, 'svg')).toEqual({ kind: 'svg', width: 200, height: 100 })
    const pdf = await inspectImage(await pdfImage(), 'pdf')
    expect(pdf).toMatchObject({ kind: 'pdf', width: 100, height: 50 })
    const preview = await sharp(pdf.preview).metadata()
    expect([preview.format, preview.width, preview.height]).toEqual(['png', 1200, 600])
  })

  it('refuses what it cannot use, with a reason', async () => {
    expect(await code(inspectImage(Buffer.from('GIF89a........'), 'png'))).toBe('unsupported_image')
    expect(await code(inspectImage(await png(), 'jpeg'))).toBe('wrong_type')
    expect(await code(inspectImage(Buffer.concat([await png(), Buffer.alloc(MAX_BYTES)]), 'png'))).toBe('image_too_large')
    expect(await code(inspectImage(Buffer.from('%PDF-1.7 broken'), 'pdf'))).toBe('unreadable_image')
    expect(await code(inspectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect'), 'svg'))).toBe('unreadable_image')
  })

  it('refuses SVGs that refer to files or web addresses, so rendering reads nothing else', async () => {
    const svg = (inner: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10">${inner}</svg>`
    expect(svgHasExternalReferences(svg('<image href="/etc/hostname.png" width="10" height="10"/>'))).toBe(true)
    expect(svgHasExternalReferences(svg('<image xlink:href="https://example.com/a.png"/>'))).toBe(true)
    expect(svgHasExternalReferences(svg('<rect style="fill: url(file:///x)"/>'))).toBe(true)
    expect(svgHasExternalReferences(svg('<style>@import "a.css";</style>'))).toBe(true)
    expect(svgHasExternalReferences(svg('<use href="#a"/><rect fill="url(#g)"/><image href="data:image/png;base64,AAAA"/>'))).toBe(false)
    expect(await code(inspectImage(Buffer.from(svg('<image href="/etc/hostname.png"/>')), 'svg'))).toBe('unsupported_image')
  })
})

describe('embedding for print', () => {
  it('renders an SVG at 600 dpi for the width it is printed at', async () => {
    const pdf = await PDFDocument.create()
    const image = (await embedAsset(pdf, { kind: 'svg', file: SVG }, 30)) as PDFImage
    expect(image.width).toBe(Math.ceil((30 / 25.4) * 600))
    expect(Math.abs(image.height - image.width / 2)).toBeLessThanOrEqual(0.5)
  })

  it('embeds a CMYK JPEG as RGB, so it prints in the right colours', async () => {
    const pdf = await PDFDocument.create()
    const image = (await embedAsset(pdf, { kind: 'jpeg', file: await jpeg(true) }, 30)) as PDFImage
    expect([image.width, image.height]).toEqual([300, 150])
  })
})

/** A blank PDF map, 300 × 200 mm at 1:10 000, and an event with a course on it whose layout shows `elements`. */
async function blankMap(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  // A page needs content to be placed in another PDF: a thin grey frame.
  doc.addPage([300 * PT_PER_MM, 200 * PT_PER_MM]).drawRectangle({
    x: 1,
    y: 1,
    width: 300 * PT_PER_MM - 2,
    height: 200 * PT_PER_MM - 2,
    borderColor: rgb(0.8, 0.8, 0.8),
    borderWidth: 0.5,
  })
  return Buffer.from(await doc.save())
}
function event(elements: PageElementSpec[]): EventDoc {
  let doc = emptyDoc(10000)
  doc = addControl(doc, { id: 'a', kind: 'control', position: [1000, 1000] })
  doc = addCourse(doc, { id: 'K', name: 'K', printScale: 10000 })
  doc = insertCourseControl(doc, 'K', 'a')
  // A4 portrait without a description sheet, which would cover the top-left corner.
  doc = setPrintSettings(doc, 'K', { paper: 'A4', orientation: 'portrait', center: [1500, 1000], margin: 5, layout: [] })
  return { ...doc, printLayout: { elements } }
}
const image = (id: string, asset: string, offset: [number, number]): PageElementSpec => ({
  id,
  kind: 'image',
  anchor: 'tl',
  offset,
  size: [40, 20],
  asset,
})

/** The box (page mm, y up) of the red pixels within `area` (page mm), from a rendering at 10 px per mm. */
function redBox(pdf: Uint8Array, area: { minX: number; minY: number; maxX: number; maxY: number }) {
  const pxPerMm = 10
  const page = mupdf.Document.openDocument(pdf, 'application/pdf').loadPage(0)
  const pixmap = page.toPixmap(mupdf.Matrix.scale(pxPerMm / PT_PER_MM, pxPerMm / PT_PER_MM), mupdf.ColorSpace.DeviceRGB, false)
  const data = new Uint8Array(pixmap.getPixels())
  const [w, n, hMm] = [pixmap.getWidth(), pixmap.getNumberOfComponents(), pixmap.getHeight() / pxPerMm]
  let [minX, minY, maxX, maxY] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, -1, -1]
  for (let y = Math.round((hMm - area.maxY) * pxPerMm); y < Math.round((hMm - area.minY) * pxPerMm); y++)
    for (let x = Math.round(area.minX * pxPerMm); x < Math.round(area.maxX * pxPerMm); x++) {
      const i = (y * w + x) * n
      if ((data[i] ?? 0) - (data[i + 1] ?? 0) > 127) {
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
    }
  return { minX: minX / pxPerMm, maxX: (maxX + 1) / pxPerMm, minY: hMm - (maxY + 1) / pxPerMm, maxY: hMm - minY / pxPerMm }
}

describe('printing layout images', () => {
  it('prints PNG, JPEG, SVG and PDF images at the size of their box (±0.2 mm)', async () => {
    const assets = new Map<string, AssetFile>([
      ['p', { kind: 'png', file: await png() }],
      ['j', { kind: 'jpeg', file: await jpeg() }],
      ['s', { kind: 'svg', file: SVG }],
      ['v', { kind: 'pdf', file: await pdfImage() }],
    ])
    // Four boxes of 40 × 20 mm in the top-left of an A4 portrait page (297 mm high).
    const offsets: [string, [number, number]][] = [
      ['p', [10, 10]],
      ['j', [60, 10]],
      ['s', [10, 40]],
      ['v', [60, 40]],
    ]
    const doc = event(offsets.map(([asset, offset]) => image(asset, asset, offset)))
    const file = await makeExport({
      doc,
      eventName: 'E',
      courseIds: ['K'],
      separate: false,
      assets,
      map: { kind: 'pdf', scale: 10000, file: await blankMap() },
    })
    for (const [asset, [x, top]] of offsets) {
      const box = { minX: x, maxX: x + 40, minY: 297 - top - 20, maxY: 297 - top }
      const found = redBox(file.bytes, { minX: box.minX - 3, maxX: box.maxX + 3, minY: box.minY - 3, maxY: box.maxY + 3 })
      for (const k of ['minX', 'maxX', 'minY', 'maxY'] as const)
        expect(Math.abs(found[k] - box[k]), `${asset} ${k}`).toBeLessThanOrEqual(0.2)
    }
  })

  it('keeps a PDF image vector', async () => {
    const doc = event([image('v', 'v', [10, 10])])
    const assets = new Map<string, AssetFile>([['v', { kind: 'pdf', file: await pdfImage() }]])
    const file = await makeExport({
      doc,
      eventName: 'E',
      courseIds: ['K'],
      separate: false,
      assets,
      map: { kind: 'pdf', scale: 10000, file: await blankMap() },
    })
    expect(Buffer.from(file.bytes).includes('/Subtype /Image')).toBe(false)
  })

  it('refuses to print a layout whose image it was not given', async () => {
    const doc = event([image('x', 'not-allowed', [10, 10])])
    await expect(
      makeExport({
        doc,
        eventName: 'E',
        courseIds: ['K'],
        separate: false,
        assets: new Map(),
        map: { kind: 'pdf', scale: 10000, file: await blankMap() },
      }),
    ).rejects.toThrow(MissingAssetError)
  })
})

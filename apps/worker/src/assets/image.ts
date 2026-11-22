// Images for print layouts (see migration create_layout_assets): checking an uploaded file by its
// content, reading its natural size, rendering a preview of a PDF for the browser, and embedding the
// image in an exported PDF at the size it is printed (PNG and JPEG as they are, PDF as vector, SVG
// rendered at 600 dpi).
import { fileURLToPath } from 'node:url'
import { FONTS } from '@course-setter/core'
import { Resvg } from '@resvg/resvg-js'
import * as mupdf from 'mupdf'
import { type PDFDocument, type PDFEmbeddedPage, type PDFImage, PDFDocument as PdfLib } from 'pdf-lib'
import sharp, { type Metadata } from 'sharp'

export type AssetKind = 'png' | 'jpeg' | 'svg' | 'pdf'
export type AssetErrorCode = 'unsupported_image' | 'wrong_type' | 'unreadable_image' | 'image_too_large'

/** A file that cannot be used as an image: processing fails with this code, without retrying. */
export class AssetError extends Error {
  readonly code: AssetErrorCode
  constructor(code: AssetErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

/** The bucket's limit too. */
export const MAX_BYTES = 5 * 1024 * 1024
/** Raster images larger than this are refused (a 600 dpi A3 page has 70 million). */
const MAX_PIXELS = 80_000_000
/** Longest side of a PDF image's preview, pixels. */
const PREVIEW_PX = 1200
/** Longest side an SVG is rendered at for print, pixels (an A4 page's width at 600 dpi is about 5000). */
const MAX_SVG_PX = 8000
export const PRINT_DPI = 600

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** What the file is, by its first bytes (not by its name or the type the browser sent). */
export function sniff(file: Buffer): AssetKind | null {
  if (file.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png'
  if (file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff) return 'jpeg'
  if (file.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf'
  const head = file.subarray(0, 4096).toString('utf8').replace(/^﻿/, '')
  if (/^\s*(<\?xml[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]/i.test(head)) return 'svg'
  return null
}

/**
 * Whether an SVG refers to anything outside itself (a file or a web address in an href or a CSS url()):
 * such references are refused, so rendering never reads a file on the worker or fetches anything.
 */
export function svgHasExternalReferences(svg: string): boolean {
  for (const m of svg.matchAll(/\bhref\s*=\s*["']\s*([^"']*)["']/gi)) {
    const href = (m[1] ?? '').trim()
    if (!href.startsWith('#') && !/^data:/i.test(href)) return true
  }
  for (const m of svg.matchAll(/url\(\s*["']?\s*([^"')]*)/gi)) {
    const url = (m[1] ?? '').trim()
    if (!url.startsWith('#') && !/^data:/i.test(url)) return true
  }
  return /@import/i.test(svg)
}

const fontDir = (file: string) => fileURLToPath(new URL(`../../../../packages/core/fonts/${file}`, import.meta.url))
/** Text in SVGs is drawn with the app's fonts only (no system fonts, so every worker draws the same). */
const SVG_FONTS = {
  loadSystemFonts: false,
  fontFiles: Object.values(FONTS).map(f => fontDir(f.file)),
  defaultFontFamily: 'Liberation Sans',
}

export type Inspected = {
  kind: AssetKind
  /** Natural size: pixels (PNG, JPEG), user units (SVG), points (PDF). */
  width: number
  height: number
  /** A PNG of a PDF's first page, for the browser. */
  preview?: Buffer
}

/** Checks an uploaded image and reads what the app needs to know about it. `declared` is the kind it was uploaded as. */
export async function inspectImage(file: Buffer, declared: AssetKind): Promise<Inspected> {
  if (file.length > MAX_BYTES) throw new AssetError('image_too_large', `The file is ${file.length} bytes; the limit is ${MAX_BYTES}.`)
  const kind = sniff(file)
  if (!kind) throw new AssetError('unsupported_image', 'The file is not a PNG, JPEG, SVG or PDF image.')
  if (kind !== declared) throw new AssetError('wrong_type', `The file is a ${kind} image, uploaded as ${declared}.`)

  if (kind === 'png' || kind === 'jpeg') {
    let meta: Metadata
    try {
      meta = await sharp(file).metadata()
    } catch (err) {
      throw new AssetError('unreadable_image', `The image could not be read: ${(err as Error).message}`)
    }
    if (!meta.width || !meta.height) throw new AssetError('unreadable_image', 'The image has no size.')
    if (meta.width * meta.height > MAX_PIXELS)
      throw new AssetError('image_too_large', `The image has ${meta.width} × ${meta.height} pixels.`)
    return { kind, width: meta.width, height: meta.height }
  }

  if (kind === 'svg') {
    const svg = file.toString('utf8')
    if (svgHasExternalReferences(svg)) throw new AssetError('unsupported_image', 'The SVG refers to other files or web addresses.')
    try {
      const resvg = new Resvg(svg, { font: SVG_FONTS })
      if (!(resvg.width > 0 && resvg.height > 0)) throw new Error('no size')
      return { kind, width: resvg.width, height: resvg.height }
    } catch (err) {
      throw new AssetError('unreadable_image', `The SVG could not be read: ${(err as Error).message}`)
    }
  }

  // PDF: its first page, as mupdf draws it (preview) and as pdf-lib embeds it (print).
  try {
    const doc = mupdf.Document.openDocument(file, 'application/pdf')
    if (doc.countPages() < 1) throw new Error('no pages')
    const page = doc.loadPage(0)
    const [x0, y0, x1, y1] = page.getBounds()
    const [width, height] = [x1 - x0, y1 - y0]
    if (!(width > 0 && height > 0)) throw new Error('the page has no size')
    const k = PREVIEW_PX / Math.max(width, height)
    const preview = Buffer.from(page.toPixmap(mupdf.Matrix.scale(k, k), mupdf.ColorSpace.DeviceRGB, true).asPNG())
    await (await PdfLib.create()).embedPdf(file, [0])
    return { kind, width, height, preview }
  } catch (err) {
    throw new AssetError('unreadable_image', `The PDF could not be read: ${(err as Error).message}`)
  }
}

/** An SVG as a PNG `widthPx` pixels wide (its height to scale), transparent where it draws nothing. */
export function svgToPng(svg: Buffer, widthPx: number): Buffer {
  const resvg = new Resvg(svg, { font: SVG_FONTS, fitTo: { mode: 'width', value: Math.max(1, Math.min(MAX_SVG_PX, Math.ceil(widthPx))) } })
  return Buffer.from(resvg.render().asPng())
}

/** An image ready to be embedded: its kind and file. */
export type AssetFile = { kind: AssetKind; file: Buffer }

/**
 * The image embedded in `pdf`, to be printed at most `widthMm` wide: PNG and JPEG as they are (as PNG
 * if pdf-lib cannot embed them as they are, or if a JPEG is CMYK), PDF as vector, SVG at 600 dpi.
 */
export async function embedAsset(pdf: PDFDocument, asset: AssetFile, widthMm: number): Promise<PDFImage | PDFEmbeddedPage> {
  const asPng = async () => pdf.embedPng(await sharp(asset.file).toColourspace('srgb').png().toBuffer())
  switch (asset.kind) {
    case 'png':
      return pdf.embedPng(asset.file).catch(asPng)
    case 'jpeg': {
      const meta = await sharp(asset.file).metadata()
      return meta.space === 'cmyk' ? asPng() : pdf.embedJpg(asset.file).catch(asPng)
    }
    case 'svg':
      return pdf.embedPng(svgToPng(asset.file, (widthMm / 25.4) * PRINT_DPI))
    case 'pdf': {
      const [page] = await pdf.embedPdf(asset.file, [0])
      if (!page) throw new Error('the PDF image has no page')
      return page
    }
  }
}

// pdf-lib backend for drawing primitives: the same symbols as the editor, as vector graphics on a PDF page.
// Exported separately (@course-setter/core/pdf) so pdf-lib stays out of the web app's bundle.
import {
  appendBezierCurve,
  asPDFNumber,
  type Color,
  ColorTypes,
  closePath,
  cmyk,
  grayscale,
  LineCapStyle,
  LineJoinStyle,
  lineTo,
  moveTo,
  PDFEmbeddedPage,
  type PDFFont,
  type PDFImage,
  type PDFName,
  PDFOperator,
  PDFOperatorNames,
  type PDFPage,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setDashPattern,
  setFillingColor,
  setGraphicsState,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingColor,
  stroke,
} from 'pdf-lib'
import type { Point } from '../similarity.ts'
import type { FontId } from '../text/fonts.ts'
import { ARIAL_DIGIT_HEIGHT, type LineCap, type LineJoin, MITER_LIMIT, type PathCommand, type Primitive } from './primitives.ts'

export const PT_PER_MM = 72 / 25.4
/** Bezier handle length for a quarter circle, as a fraction of the radius. */
const KAPPA = 0.5522847498

export type PdfOptions = {
  /** Where paper mm (0, 0) lies on the page, in points from the page's bottom-left corner. */
  origin: Point
  color: Color
  /** The font for text (Arial or a metric-compatible font such as Liberation Sans, embedded by the caller). */
  font: PDFFont
  /** Its bold face, for bold text (default: `font`). */
  boldFont?: PDFFont
  /** Digit height of `font` as a fraction of its size. */
  digitHeight?: number
  /** Fonts for text lines, embedded with FONT_FEATURES (see text/fonts.ts); a line in a font not given throws. */
  fonts?: Partial<Record<FontId, PDFFont>>
  /** The embedded image (PNG, JPG) or PDF page for an image primitive's asset; null throws MissingAssetError. */
  images?: (asset: string) => PDFImage | PDFEmbeddedPage | null
}

/** An image primitive whose asset the caller has no image for: a PDF never leaves a logo out silently. */
export class MissingAssetError extends Error {
  readonly code = 'missing_asset'
  readonly asset: string
  constructor(asset: string) {
    super(`An image in the print layout is missing, or cannot be used in this event (${asset}).`)
    this.asset = asset
  }
}

/** A #rrggbb colour as a pdf-lib colour. */
export function pdfColor(hex: string): Color {
  const n = Number.parseInt(hex.slice(1), 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

/** One graphics state per page and opacity, shared by every primitive drawn with it. */
const opacityStates = new WeakMap<PDFPage, Map<number, PDFName>>()
function opacityState(page: PDFPage, opacity: number): PDFName {
  const states = opacityStates.get(page) ?? new Map<number, PDFName>()
  opacityStates.set(page, states)
  let name = states.get(opacity)
  if (!name) {
    name = page.node.newExtGState('Opacity', page.doc.context.obj({ Type: 'ExtGState', ca: opacity, CA: opacity }))
    states.set(opacity, name)
  }
  return name
}

/** `share` of a colour on white paper: CMYK and grey ink scaled down, RGB mixed with white. */
function tinted(color: Color, share: number): Color {
  if (color.type === ColorTypes.CMYK) return cmyk(color.cyan * share, color.magenta * share, color.yellow * share, color.key * share)
  if (color.type === ColorTypes.Grayscale) return grayscale(1 - (1 - color.gray) * share)
  const mix = (v: number) => 1 - (1 - v) * share
  return rgb(mix(color.red), mix(color.green), mix(color.blue))
}

const CAPS: Record<LineCap, LineCapStyle> = { butt: LineCapStyle.Butt, round: LineCapStyle.Round, square: LineCapStyle.Projecting }
const JOINS: Record<LineJoin, LineJoinStyle> = { miter: LineJoinStyle.Miter, round: LineJoinStyle.Round, bevel: LineJoinStyle.Bevel }

export function drawPrimitivesOnPage(page: PDFPage, primitives: Primitive[], options: PdfOptions): void {
  const [ox, oy] = options.origin
  const x = (mm: number) => ox + mm * PT_PER_MM
  const y = (mm: number) => oy + mm * PT_PER_MM
  let ops: PDFOperator[] = [pushGraphicsState(), PDFOperator.of(PDFOperatorNames.SetLineMiterLimit, [asPDFNumber(MITER_LIMIT)])]
  // Text and images go through pdf-lib's own drawing calls: what is collected so far is written first,
  // so everything is drawn in the order of the primitives.
  const flush = () => {
    page.pushOperators(...ops)
    ops = []
  }
  const trace = (commands: PathCommand[]) => {
    for (const c of commands) {
      if (c[0] === 'M') ops.push(moveTo(x(c[1]), y(c[2])))
      else if (c[0] === 'L') ops.push(lineTo(x(c[1]), y(c[2])))
      else if (c[0] === 'C') ops.push(appendBezierCurve(x(c[1]), y(c[2]), x(c[3]), y(c[4]), x(c[5]), y(c[6])))
      else ops.push(closePath())
    }
  }
  const strokeWith = (lineWidth: number, cap: LineCap = 'butt', join: LineJoin = 'miter', dash?: number[]) => {
    ops.push(
      setLineWidth(lineWidth * PT_PER_MM),
      setLineCap(CAPS[cap]),
      setLineJoin(JOINS[join]),
      setDashPattern(
        (dash ?? []).map(v => v * PT_PER_MM),
        0,
      ),
      stroke(),
    )
  }
  const circle = ([cx, cy]: Point, r: number): PathCommand[] => {
    const k = r * KAPPA
    return [
      ['M', cx + r, cy],
      ['C', cx + r, cy + k, cx + k, cy + r, cx, cy + r],
      ['C', cx - k, cy + r, cx - r, cy + k, cx - r, cy],
      ['C', cx - r, cy - k, cx - k, cy - r, cx, cy - r],
      ['C', cx + k, cy - r, cx + r, cy - k, cx + r, cy],
      ['Z'],
    ]
  }
  // The colour last set for shapes (pdf-lib's text and image calls keep theirs to themselves).
  let current: string | null = null

  for (const p of primitives) {
    const color = p.color ? pdfColor(p.color) : options.color
    const opacity = p.opacity ?? 1
    const translucent = opacity < 1 ? { opacity } : {}

    if (p.type === 'text') {
      // Centred on the middle of the digits, as in the Canvas backend.
      flush()
      const font = p.bold ? (options.boldFont ?? options.font) : options.font
      let digit = p.height * PT_PER_MM
      let size = digit / (options.digitHeight ?? ARIAL_DIGIT_HEIGHT)
      let width = font.widthOfTextAtSize(p.text, size)
      const max = p.maxWidth === undefined ? Number.POSITIVE_INFINITY : p.maxWidth * PT_PER_MM
      if (width > max) {
        const k = (max / width) * 0.95
        digit *= k
        size *= k
        width *= k
      }
      page.drawText(p.text, { x: x(p.at[0]) - width / 2, y: y(p.at[1]) - digit / 2, size, font, color, ...translucent })
      continue
    }
    if (p.type === 'textLine') {
      const font = options.fonts?.[p.font]
      if (!font) throw new Error(`No PDF font given for ${p.font}`)
      flush()
      page.drawText(p.text, { x: x(p.at[0]), y: y(p.at[1]), size: p.size * PT_PER_MM, font, color, ...translucent })
      continue
    }
    if (p.type === 'image') {
      const image = options.images?.(p.asset) ?? null
      if (!image) throw new MissingAssetError(p.asset)
      flush()
      const box = {
        x: x(p.box.minX),
        y: y(p.box.minY),
        width: (p.box.maxX - p.box.minX) * PT_PER_MM,
        height: (p.box.maxY - p.box.minY) * PT_PER_MM,
        ...translucent,
      }
      if (image instanceof PDFEmbeddedPage) page.drawPage(image, box)
      else page.drawImage(image, box)
      continue
    }

    const key = p.color ?? ''
    if (key !== current) {
      ops.push(setStrokingColor(color), setFillingColor(color))
      current = key
    }
    if (opacity < 1) ops.push(pushGraphicsState(), setGraphicsState(opacityState(page, opacity)))
    if (p.type === 'circle') {
      trace(circle(p.center, p.radius))
      if (p.filled) ops.push(PDFOperator.of(PDFOperatorNames.FillNonZero))
      else strokeWith(p.lineWidth)
    } else if (p.type === 'polyline') {
      const [first, ...rest] = p.points
      if (first) {
        trace([['M', first[0], first[1]], ...rest.map((q): PathCommand => ['L', q[0], q[1]]), ...(p.closed ? [['Z'] as PathCommand] : [])])
        strokeWith(p.lineWidth, p.cap, p.join, p.dash)
      }
    } else if (p.filled && p.tint !== undefined && p.tint < 1) {
      trace(p.commands)
      ops.push(setFillingColor(tinted(color, p.tint)), PDFOperator.of(PDFOperatorNames.FillEvenOdd), setFillingColor(color))
    } else {
      trace(p.commands)
      if (p.filled) ops.push(PDFOperator.of(PDFOperatorNames.FillEvenOdd))
      else strokeWith(p.lineWidth, p.cap, p.join, p.dash)
    }
    if (opacity < 1) ops.push(popGraphicsState())
  }
  ops.push(popGraphicsState())
  flush()
}

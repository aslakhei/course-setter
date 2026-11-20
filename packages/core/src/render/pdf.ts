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
  type PDFFont,
  PDFOperator,
  PDFOperatorNames,
  type PDFPage,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setDashPattern,
  setFillingColor,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingColor,
  stroke,
} from 'pdf-lib'
import type { Point } from '../similarity.ts'
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
  const ops: PDFOperator[] = [
    pushGraphicsState(),
    setStrokingColor(options.color),
    setFillingColor(options.color),
    PDFOperator.of(PDFOperatorNames.SetLineMiterLimit, [asPDFNumber(MITER_LIMIT)]),
  ]
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
  const texts: Extract<Primitive, { type: 'text' }>[] = []

  for (const p of primitives) {
    if (p.type === 'circle') {
      trace(circle(p.center, p.radius))
      if (p.filled) ops.push(PDFOperator.of(PDFOperatorNames.FillNonZero))
      else strokeWith(p.lineWidth)
    } else if (p.type === 'polyline') {
      const [first, ...rest] = p.points
      if (!first) continue
      trace([['M', first[0], first[1]], ...rest.map((q): PathCommand => ['L', q[0], q[1]]), ...(p.closed ? [['Z'] as PathCommand] : [])])
      strokeWith(p.lineWidth, p.cap, p.join, p.dash)
    } else if (p.type === 'path') {
      trace(p.commands)
      if (p.filled && p.tint !== undefined && p.tint < 1) {
        ops.push(
          setFillingColor(tinted(options.color, p.tint)),
          PDFOperator.of(PDFOperatorNames.FillEvenOdd),
          setFillingColor(options.color),
        )
      } else if (p.filled) ops.push(PDFOperator.of(PDFOperatorNames.FillEvenOdd))
      else strokeWith(p.lineWidth, p.cap, p.join, p.dash)
    } else {
      texts.push(p)
    }
  }
  ops.push(popGraphicsState())
  page.pushOperators(...ops)

  // Centred on the middle of the digits, as in the Canvas backend.
  for (const t of texts) {
    const font = t.bold ? (options.boldFont ?? options.font) : options.font
    let digit = t.height * PT_PER_MM
    let size = digit / (options.digitHeight ?? ARIAL_DIGIT_HEIGHT)
    let width = font.widthOfTextAtSize(t.text, size)
    const max = t.maxWidth === undefined ? Number.POSITIVE_INFINITY : t.maxWidth * PT_PER_MM
    if (width > max) {
      const k = (max / width) * 0.95
      digit *= k
      size *= k
      width *= k
    }
    page.drawText(t.text, { x: x(t.at[0]) - width / 2, y: y(t.at[1]) - digit / 2, size, font, color: options.color })
  }
}

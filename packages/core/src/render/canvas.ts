// Canvas 2D backend for drawing primitives: used by the editor (inside an OpenLayers layer) and by the
// snapshot tests (@napi-rs/canvas in Node). It computes device positions itself instead of setting a
// canvas transform, so it draws correctly into a context whatever transform the host already uses.
import type { Point } from '../similarity.ts'
import { FONTS, type FontId } from '../text/fonts.ts'
import { ARIAL_DIGIT_HEIGHT, type LineCap, type LineJoin, MITER_LIMIT, type PathCommand, type Primitive } from './primitives.ts'

/** The parts of CanvasRenderingContext2D the backend uses (so any compatible canvas works). */
export interface CanvasTarget {
  save(): void
  restore(): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void
  closePath(): void
  arc(x: number, y: number, radius: number, start: number, end: number): void
  stroke(): void
  fill(fillRule?: 'nonzero' | 'evenodd'): void
  translate(x: number, y: number): void
  rotate(angle: number): void
  fillText(text: string, x: number, y: number): void
  drawImage(image: object, x: number, y: number, width: number, height: number): void
  globalAlpha: number
  measureText(text: string): { width: number }
  setLineDash(segments: number[]): void
  lineWidth: number
  lineCap: string
  lineJoin: string
  miterLimit: number
  strokeStyle: unknown
  fillStyle: unknown
  font: string
  textAlign: string
  textBaseline: string
  /** Set to turn kerning and ligatures off where the canvas supports it (text lines are measured without them). */
  fontKerning?: string
  textRendering?: string
}

/**
 * Paper mm -> device pixels as a canvas matrix [a, b, c, d, e, f]: device x = a·x + c·y + e,
 * device y = b·x + d·y + f. It must be a similarity (uniform scale, rotation, the y flip).
 */
export type DeviceTransform = [number, number, number, number, number, number]

export type CanvasOptions = {
  transform: DeviceTransform
  color: string
  /** Replaces the primitives' own dashes with this pattern in device pixels (previews). */
  dashPx?: number[]
  /** Lines and text never get thinner or smaller than this, in device pixels (zoomed-out views). */
  minLineWidthPx?: number
  font?: string
  /** Digit height of `font` as a fraction of its size. */
  digitHeight?: number
  /**
   * The image for an image primitive's asset (an HTMLImageElement, ImageBitmap …), or null while it is not
   * loaded: then a grey box with a cross stands in its place.
   */
  images?: (asset: string) => object | null
}

const PLACEHOLDER = { fill: '#ece9ee', line: '#a59fa9' }

/**
 * Sets up `ctx` to draw a text line in `font` at `px` pixels: the family the host registered the font
 * file under (FONTS), kerning off, and `textRendering` set to what turns ligatures off in Chrome and Skia.
 */
export function setTextLineFont(ctx: CanvasTarget, font: FontId, px: number): void {
  const { weight, family } = FONTS[font]
  ctx.font = `${weight} ${px}px "${family}"`
  ctx.fontKerning = 'none'
  ctx.textRendering = 'optimizeSpeed'
}

/**
 * The text with a zero-width non-joiner between characters, so no browser joins letters into ligatures
 * (fi, ffl) even where `textRendering` is ignored: core measures each character on its own.
 */
const ZWNJ = String.fromCodePoint(0x200c)
export const withoutLigatures = (text: string): string => [...text].join(ZWNJ)

/**
 * A transform drawing paper mm at `pxPerMm`, y up, with paper point `origin` at the bottom-left corner of
 * a device area `deviceHeight` pixels high.
 */
export function paperToDevice(pxPerMm: number, origin: Point = [0, 0], deviceHeight = 0): DeviceTransform {
  return [pxPerMm, 0, 0, -pxPerMm, -origin[0] * pxPerMm, deviceHeight + origin[1] * pxPerMm]
}

const CAPS: Record<LineCap, string> = { butt: 'butt', round: 'round', square: 'square' }
const JOINS: Record<LineJoin, string> = { miter: 'miter', round: 'round', bevel: 'bevel' }

export function drawPrimitives(ctx: CanvasTarget, primitives: Primitive[], options: CanvasOptions): void {
  const [a, b, c, d, e, f] = options.transform
  const scale = Math.sqrt(Math.abs(a * d - b * c))
  const angle = Math.atan2(b, a)
  const minWidth = options.minLineWidthPx ?? 0
  const at = (x: number, y: number): Point => [a * x + c * y + e, b * x + d * y + f]
  const trace = (commands: PathCommand[]) => {
    for (const cmd of commands) {
      if (cmd[0] === 'M') ctx.moveTo(...at(cmd[1], cmd[2]))
      else if (cmd[0] === 'L') ctx.lineTo(...at(cmd[1], cmd[2]))
      else if (cmd[0] === 'C') ctx.bezierCurveTo(...at(cmd[1], cmd[2]), ...at(cmd[3], cmd[4]), ...at(cmd[5], cmd[6]))
      else ctx.closePath()
    }
  }
  const strokeWith = (lineWidth: number, cap: LineCap = 'butt', join: LineJoin = 'miter', dash?: number[]) => {
    ctx.lineWidth = Math.max(minWidth, lineWidth * scale)
    ctx.lineCap = CAPS[cap]
    ctx.lineJoin = JOINS[join]
    ctx.miterLimit = MITER_LIMIT
    ctx.setLineDash(options.dashPx ?? (dash ? dash.map(v => v * scale) : []))
    ctx.stroke()
  }

  ctx.save()
  for (const p of primitives) {
    const color = p.color ?? options.color
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.globalAlpha = p.opacity ?? 1
    ctx.beginPath()
    if (p.type === 'circle') {
      ctx.arc(...at(p.center[0], p.center[1]), p.radius * scale, 0, 2 * Math.PI)
      if (p.filled) ctx.fill()
      else strokeWith(p.lineWidth, 'butt', 'miter')
    } else if (p.type === 'polyline') {
      const [first, ...rest] = p.points
      if (!first) continue
      trace([['M', first[0], first[1]], ...rest.map((q): PathCommand => ['L', q[0], q[1]]), ...(p.closed ? [['Z'] as PathCommand] : [])])
      strokeWith(p.lineWidth, p.cap, p.join, p.dash)
    } else if (p.type === 'path') {
      trace(p.commands)
      if (p.filled) {
        // A tint over white is the colour at that opacity (and with Multiply, the same over the map).
        ctx.globalAlpha = (p.opacity ?? 1) * (p.tint ?? 1)
        ctx.fill('evenodd')
      } else strokeWith(p.lineWidth, p.cap, p.join, p.dash)
    } else if (p.type === 'textLine') {
      ctx.save()
      ctx.translate(...at(p.at[0], p.at[1]))
      ctx.rotate(angle)
      setTextLineFont(ctx, p.font, p.size * scale)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(withoutLigatures(p.text), 0, 0)
      ctx.restore()
    } else if (p.type === 'image') {
      // From the box's top-left corner (y up: its top edge), along the page's axes.
      const [w, h] = [(p.box.maxX - p.box.minX) * scale, (p.box.maxY - p.box.minY) * scale]
      const image = options.images?.(p.asset) ?? null
      ctx.save()
      ctx.translate(...at(p.box.minX, p.box.maxY))
      ctx.rotate(angle)
      if (image) ctx.drawImage(image, 0, 0, w, h)
      else {
        ctx.moveTo(0, 0)
        ctx.lineTo(w, 0)
        ctx.lineTo(w, h)
        ctx.lineTo(0, h)
        ctx.closePath()
        ctx.fillStyle = PLACEHOLDER.fill
        ctx.fill()
        ctx.moveTo(0, 0)
        ctx.lineTo(w, h)
        ctx.moveTo(w, 0)
        ctx.lineTo(0, h)
        ctx.strokeStyle = PLACEHOLDER.line
        ctx.lineWidth = Math.max(1, minWidth)
        ctx.setLineDash([])
        ctx.stroke()
      }
      ctx.restore()
    } else {
      // Centred on the middle of the digits: the baseline lies half a digit height below `at`.
      let digitPx = Math.max(minWidth, p.height * scale)
      const family = options.font ?? 'Arial, "Liberation Sans", sans-serif'
      const font = (px: number) => `${p.bold ? 'bold ' : ''}${px}px ${family}`
      ctx.save()
      ctx.translate(...at(p.at[0], p.at[1]))
      ctx.rotate(angle)
      ctx.font = font(digitPx / (options.digitHeight ?? ARIAL_DIGIT_HEIGHT))
      if (p.maxWidth !== undefined) {
        const width = ctx.measureText(p.text).width
        const max = p.maxWidth * scale
        if (width > max) {
          digitPx *= (max / width) * 0.95
          ctx.font = font(digitPx / (options.digitHeight ?? ARIAL_DIGIT_HEIGHT))
        }
      }
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(p.text, 0, digitPx / 2)
      ctx.restore()
    }
  }
  ctx.restore()
}

// Drawing primitives in paper millimetres, y up. Course symbols, special symbols and control description
// symbols are all built from these, and every backend (Canvas 2D in the editor, pdf-lib for print) draws
// the same list, so what the setter sees is what gets printed.
import type { Point } from '../similarity.ts'

/**
 * What a primitive draws: a control's symbol, its number, a course line, or part of a control description.
 * `owner` is the control it belongs to (for highlighting and dragging in the editor).
 */
export type PrimitiveRole = 'symbol' | 'number' | 'leg' | 'description' | 'special'
type Tagged = { role: PrimitiveRole; owner?: string }

export type LineCap = 'butt' | 'round' | 'square'
export type LineJoin = 'miter' | 'round' | 'bevel'
/** Line ends and corners (default butt ends and mitred corners) and an optional dash pattern in mm. */
type StrokeStyle = { cap?: LineCap; join?: LineJoin; dash?: number[] }

/** One step of a path: move, line, cubic bezier (two control points, then the end point), close. */
export type PathCommand = ['M', number, number] | ['L', number, number] | ['C', number, number, number, number, number, number] | ['Z']

export type Primitive =
  /** A circle line, or a filled disc when `filled` (then `lineWidth` is not used). */
  | ({ type: 'circle'; center: Point; radius: number; lineWidth: number; filled?: boolean } & Tagged)
  | ({ type: 'polyline'; points: Point[]; lineWidth: number; closed: boolean } & StrokeStyle & Tagged)
  /**
   * Lines and beziers, stroked with `lineWidth`, or filled (even-odd rule) when `filled`; `tint` fills
   * with that share of the colour (714: 50 % purple), mixed with white as printed.
   */
  | ({ type: 'path'; commands: PathCommand[]; lineWidth: number; filled?: boolean; tint?: number } & StrokeStyle & Tagged)
  /**
   * Text centred on `at`. `height` is the height of a digit (ISOM: "Arial, 4.0 mm" means 4.0 mm digits,
   * a font size of about 5.6 mm), so numbers have the specified size whatever font a backend uses.
   * Text wider than `maxWidth` (mm) is drawn smaller, to 95 % of it, as Purple Pen does.
   */
  | ({ type: 'text'; at: Point; text: string; height: number; bold?: boolean; maxWidth?: number } & Tagged)

/** Height of a digit in Arial as a fraction of the font size (glyph "1": 1472 of 2048 units). */
export const ARIAL_DIGIT_HEIGHT = 1472 / 2048
/** Miter limit for mitred corners in every backend. */
export const MITER_LIMIT = 5

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

/** Every point a path passes through or uses as a control point. */
export function pathPoints(commands: PathCommand[]): Point[] {
  const out: Point[] = []
  for (const c of commands) {
    if (c[0] === 'M' || c[0] === 'L') out.push([c[1], c[2]])
    else if (c[0] === 'C') out.push([c[1], c[2]], [c[3], c[4]], [c[5], c[6]])
  }
  return out
}

/** A box (in mm) that holds everything the primitives draw, including line widths; null when empty. */
export function primitivesBounds(primitives: Primitive[]): Bounds | null {
  let b: Bounds | null = null
  const add = ([x, y]: Point, pad: number) => {
    if (!b) b = { minX: x - pad, minY: y - pad, maxX: x + pad, maxY: y + pad }
    else {
      b.minX = Math.min(b.minX, x - pad)
      b.minY = Math.min(b.minY, y - pad)
      b.maxX = Math.max(b.maxX, x + pad)
      b.maxY = Math.max(b.maxY, y + pad)
    }
  }
  for (const p of primitives) {
    if (p.type === 'circle') add(p.center, p.radius + (p.filled ? 0 : p.lineWidth / 2))
    else if (p.type === 'polyline') for (const q of p.points) add(q, (p.lineWidth / 2) * (p.join === 'miter' || !p.join ? MITER_LIMIT : 1))
    else if (p.type === 'path') for (const q of pathPoints(p.commands)) add(q, p.filled ? 0 : (p.lineWidth / 2) * MITER_LIMIT)
    else {
      // Text: a generous box, the font size is digit height / 0.72 and digits are about 0.56 of it wide.
      const size = p.height / ARIAL_DIGIT_HEIGHT
      const half = Math.min(size * 0.6 * p.text.length, p.maxWidth ?? Number.POSITIVE_INFINITY) / 2
      add([p.at[0] - half, p.at[1] - size / 2], 0)
      add([p.at[0] + half, p.at[1] + size / 2], 0)
    }
  }
  return b
}

/** The primitives moved by `[dx, dy]` and scaled by `factor` about the origin. */
export function transformPrimitives(primitives: Primitive[], factor: number, [dx, dy]: Point): Primitive[] {
  const t = ([x, y]: Point): Point => [x * factor + dx, y * factor + dy]
  const dash = (d?: number[]) => (d ? { dash: d.map(v => v * factor) } : {})
  return primitives.map((p): Primitive => {
    if (p.type === 'circle') return { ...p, center: t(p.center), radius: p.radius * factor, lineWidth: p.lineWidth * factor }
    if (p.type === 'polyline') return { ...p, points: p.points.map(t), lineWidth: p.lineWidth * factor, ...dash(p.dash) }
    if (p.type === 'text')
      return { ...p, at: t(p.at), height: p.height * factor, ...(p.maxWidth !== undefined ? { maxWidth: p.maxWidth * factor } : {}) }
    const commands = p.commands.map((c): PathCommand => {
      if (c[0] === 'Z') return c
      if (c[0] === 'C') {
        const [a, b, e] = [t([c[1], c[2]]), t([c[3], c[4]]), t([c[5], c[6]])]
        return ['C', a[0], a[1], b[0], b[1], e[0], e[1]]
      }
      const q = t([c[1], c[2]])
      return [c[0], q[0], q[1]]
    })
    return { ...p, commands, lineWidth: p.lineWidth * factor, ...dash(p.dash) }
  })
}

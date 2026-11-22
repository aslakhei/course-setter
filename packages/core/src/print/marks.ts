// Drawings of the layout elements that are not plain text or images: shapes, north arrows, scale bars
// and QR codes, as primitives in page mm (y up) filling a box.
import { encode } from 'uqr'
import type { Bounds, PathCommand, Primitive } from '../render/primitives.ts'
import type { Point } from '../similarity.ts'
import { capHeight, textWidth } from '../text/lines.ts'

/** Bezier handle length for a quarter circle, as a fraction of the radius. */
const KAPPA = 0.5522847498

/** A rectangle with corners rounded by `radius` (at most half its shorter side), clockwise from the top left. */
export function roundedRect(b: Bounds, radius = 0): PathCommand[] {
  const r = Math.max(0, Math.min(radius, (b.maxX - b.minX) / 2, (b.maxY - b.minY) / 2))
  if (r === 0) return [['M', b.minX, b.maxY], ['L', b.maxX, b.maxY], ['L', b.maxX, b.minY], ['L', b.minX, b.minY], ['Z']]
  const k = r * (1 - KAPPA)
  return [
    ['M', b.minX + r, b.maxY],
    ['L', b.maxX - r, b.maxY],
    ['C', b.maxX - k, b.maxY, b.maxX, b.maxY - k, b.maxX, b.maxY - r],
    ['L', b.maxX, b.minY + r],
    ['C', b.maxX, b.minY + k, b.maxX - k, b.minY, b.maxX - r, b.minY],
    ['L', b.minX + r, b.minY],
    ['C', b.minX + k, b.minY, b.minX, b.minY + k, b.minX, b.minY + r],
    ['L', b.minX, b.maxY - r],
    ['C', b.minX, b.maxY - k, b.minX + k, b.maxY, b.minX + r, b.maxY],
    ['Z'],
  ]
}

/** The ellipse filling a box. */
export function ellipse(b: Bounds): PathCommand[] {
  const [cx, cy] = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2]
  const [rx, ry] = [(b.maxX - b.minX) / 2, (b.maxY - b.minY) / 2]
  const [kx, ky] = [rx * KAPPA, ry * KAPPA]
  return [
    ['M', cx + rx, cy],
    ['C', cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry],
    ['C', cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
    ['C', cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry],
    ['C', cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy],
    ['Z'],
  ]
}

/** The box shrunk by `d` on every side. */
export const inset = (b: Bounds, d: number): Bounds => ({ minX: b.minX + d, minY: b.minY + d, maxX: b.maxX - d, maxY: b.maxY - d })

export type ShapeSpec = {
  shape: 'rect' | 'ellipse' | 'line'
  radius?: number
  stroke?: { color: string; width: number }
  fill?: { color: string; opacity: number }
}

/** A rectangle or ellipse filling the box (its line inside the box), or a line through its middle along the longer side. */
export function shapeDrawing(box: Bounds, spec: ShapeSpec, owner: string): Primitive[] {
  const tag = { role: 'layout' as const, owner }
  if (spec.shape === 'line') {
    const [w, h] = [box.maxX - box.minX, box.maxY - box.minY]
    const [cx, cy] = [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2]
    const points: Point[] =
      w >= h
        ? [
            [box.minX, cy],
            [box.maxX, cy],
          ]
        : [
            [cx, box.minY],
            [cx, box.maxY],
          ]
    const stroke = spec.stroke ?? { color: '#000000', width: 0.35 }
    return [{ type: 'polyline', ...tag, points, lineWidth: stroke.width, closed: false, color: stroke.color }]
  }
  const outline = (b: Bounds) => (spec.shape === 'ellipse' ? ellipse(b) : roundedRect(b, spec.radius))
  const out: Primitive[] = []
  if (spec.fill && spec.fill.opacity > 0) {
    const fill = spec.fill
    out.push({ type: 'path', ...tag, commands: outline(box), lineWidth: 0, filled: true, color: fill.color, ...opacityOf(fill.opacity) })
  }
  if (spec.stroke) {
    const half = spec.stroke.width / 2
    const radius = spec.radius === undefined ? {} : { radius: Math.max(0, spec.radius - half) }
    const commands = spec.shape === 'ellipse' ? ellipse(inset(box, half)) : roundedRect(inset(box, half), radius.radius ?? 0)
    out.push({ type: 'path', ...tag, commands, lineWidth: spec.stroke.width, join: 'round', color: spec.stroke.color })
  }
  return out
}

const opacityOf = (opacity: number) => (opacity < 1 ? { opacity } : {})

/** An "N" in bold sans, its capitals `height` mm high, centred on `cx` with its top at `top`. */
function letterN(cx: number, top: number, height: number, color: string, owner: string): Primitive {
  const size = height / capHeight('sans-bold', 1)
  const width = textWidth('N', 'sans-bold', size)
  return { type: 'textLine', role: 'layout', owner, at: [cx - width / 2, top - height], text: 'N', font: 'sans-bold', size, color }
}

/** A north arrow filling the box: an "N" above an arrow, or above a compass needle (west half filled). */
export function northArrowDrawing(box: Bounds, style: 'arrow' | 'needle', color: string, owner: string): Primitive[] {
  const [w, h] = [box.maxX - box.minX, box.maxY - box.minY]
  const cx = (box.minX + box.maxX) / 2
  const y0 = box.minY
  const tag = { role: 'layout' as const, owner, color }
  const letter = letterN(cx, box.maxY, Math.min(0.28 * h, 0.8 * w), color, owner)
  const top = y0 + 0.64 * h
  if (style === 'arrow') {
    const head = Math.min(0.26 * h, 0.9 * w)
    const half = Math.min(0.36 * w, head * 0.6)
    const shaft = Math.max(0.12 * w, 0.2)
    return [
      letter,
      {
        type: 'path',
        ...tag,
        filled: true,
        lineWidth: 0,
        commands: [
          ['M', cx, top],
          ['L', cx + half, top - head],
          ['L', cx + shaft / 2, top - head],
          ['L', cx + shaft / 2, y0],
          ['L', cx - shaft / 2, y0],
          ['L', cx - shaft / 2, top - head],
          ['L', cx - half, top - head],
          ['Z'],
        ],
      },
    ]
  }
  const half = Math.min(0.26 * w, 0.15 * h)
  const middle = (top + y0) / 2
  const line = Math.max(0.15, 0.04 * w)
  return [
    letter,
    {
      type: 'path',
      ...tag,
      filled: true,
      lineWidth: 0,
      commands: [['M', cx, top], ['L', cx - half, middle], ['L', cx, y0], ['Z']],
    },
    {
      type: 'path',
      ...tag,
      lineWidth: line,
      join: 'round',
      commands: [['M', cx, top], ['L', cx + half, middle], ['L', cx, y0], ['L', cx - half, middle], ['Z']],
    },
  ]
}

/** Round lengths a scale bar can show, in metres. */
const BAR_STEPS = [1, 2, 2.5, 5]

const formatMetres = (m: number) => (m >= 1000 ? `${m / 1000} km` : `${m} m`)
const formatNumber = (m: number) => String(m >= 1000 ? m / 1000 : m)

/**
 * The longest round length (1, 2, 2.5 or 5 times a power of ten metres) whose bar, with its first and
 * last labels, fits `width` mm at the print scale.
 */
export function scaleBarLength(width: number, printScale: number, labelSize: number): number {
  for (let power = 5; power >= -1; power--) {
    for (const step of [...BAR_STEPS].reverse()) {
      const metres = step * 10 ** power
      const bar = (metres * 1000) / printScale
      const room = width - textWidth('0', 'sans', labelSize) / 2 - textWidth(formatMetres(metres), 'sans', labelSize) / 2
      if (bar <= room) return metres
    }
  }
  return 1
}

/** A scale bar in the box at the print scale: four segments, alternately filled, labelled 0, half and the length. */
export function scaleBarDrawing(box: Bounds, printScale: number, color: string, owner: string): Primitive[] {
  const [w, h] = [box.maxX - box.minX, box.maxY - box.minY]
  const barHeight = 0.28 * h
  const cap = 0.36 * h
  const size = cap / capHeight('sans', 1)
  const metres = scaleBarLength(w, printScale, size)
  const length = (metres * 1000) / printScale
  const x0 = box.minX + textWidth('0', 'sans', size) / 2
  const y0 = box.minY
  const tag = { role: 'layout' as const, owner, color }
  const out: Primitive[] = []
  const segment = length / 4
  for (const i of [0, 2]) {
    const b = { minX: x0 + i * segment, maxX: x0 + (i + 1) * segment, minY: y0, maxY: y0 + barHeight }
    out.push({ type: 'path', ...tag, commands: roundedRect(b), lineWidth: 0, filled: true })
  }
  const line = Math.max(0.1, 0.08 * barHeight)
  out.push({
    type: 'path',
    ...tag,
    commands: roundedRect(inset({ minX: x0, maxX: x0 + length, minY: y0, maxY: y0 + barHeight }, line / 2)),
    lineWidth: line,
  })
  const baseline = y0 + barHeight + 0.14 * h
  const label = (x: number, text: string): Primitive => ({
    type: 'textLine',
    ...tag,
    at: [x - textWidth(text, 'sans', size) / 2, baseline],
    text,
    font: 'sans',
    size,
  })
  out.push(label(x0, '0'), label(x0 + length / 2, formatNumber(metres / 2)), label(x0 + length, formatMetres(metres)))
  return out
}

/** A QR code of `url`, as large as fits the box and centred in it; dark modules as one filled path. */
export function qrDrawing(box: Bounds, url: string, color: string, owner: string): Primitive[] {
  const qr = encode(url, { ecc: 'M', border: 0 })
  const side = Math.min(box.maxX - box.minX, box.maxY - box.minY)
  const module = side / qr.size
  const left = (box.minX + box.maxX - side) / 2
  const top = (box.minY + box.maxY + side) / 2
  const commands: PathCommand[] = []
  qr.data.forEach((row, r) => {
    let c = 0
    while (c < row.length) {
      if (!row[c]) {
        c++
        continue
      }
      const start = c
      while (c < row.length && row[c]) c++
      const b = { minX: left + start * module, maxX: left + c * module, maxY: top - r * module, minY: top - (r + 1) * module }
      commands.push(...roundedRect(b))
    }
  })
  return [{ type: 'path', role: 'layout', owner, commands, lineWidth: 0, filled: true, color }]
}

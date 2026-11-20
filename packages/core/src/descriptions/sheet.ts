// The control description sheet of a course (IOF Control Descriptions 2024, symbols only): which rows it
// has, and the rows drawn as primitives in paper mm. Line widths, the thick lines and the text sizes
// follow the IOF specification as Purple Pen draws it (DescriptionRenderer.cs).
import { type Course, controlById, type Description, type EventDoc } from '../course/doc.ts'
import { courseLength, legLengths, routeLength } from '../course/length.ts'
import { courseStops } from '../course/numbering.ts'
import { clearance, symbolSizes } from '../course/symbols.ts'
import type { Primitive } from '../render/primitives.ts'
import type { Point } from '../similarity.ts'
import { cellSymbol, descriptionSymbol, drawDescriptionSymbol } from './symbols.ts'

export type SheetLine =
  /** The event's name across the sheet. */
  | { kind: 'title'; text: string }
  /** Course name (columns A–C), length (D–F) and climb (G–H); without a climb the length spans D–H. */
  | { kind: 'header'; name: string; length: string; climb: string | null }
  /** The start (start symbol in A) or a control (number in A, code in B), with its description. */
  | { kind: 'control'; controlId: string; start: boolean; number: string; code: string; cells: Description }
  /** An instruction across the sheet: map issue point, marked route, mandatory crossing point, the way to the finish. */
  | { kind: 'directive'; controlId: string; symbol: string; text: string }

/** Instruction symbols (IOF 2024 columns V–Z). */
export const MAP_ISSUE_DIRECTIVE = '13.6' // navigate X m from the map issue point to the start
export const TAPED_FROM_CONTROL_DIRECTIVE = '13.1' // follow the taped route X m away from the control
export const MARKED_ROUTE_DIRECTIVE = '13.2' // follow the taped route X m between controls
export const CROSSING_DIRECTIVE = '13.3' // mandatory crossing point
export const MARKED_FINISH_DIRECTIVE = '14.1' // follow the taped route X m to the finish
export const FUNNEL_DIRECTIVE = '14.2' // navigate X m to the finish funnel, then follow the tapes
export const FINISH_DIRECTIVE = '14.3' // navigate X m to the finish

const formatKm = (metres: number) => `${(metres / 1000).toFixed(1)} km`
/** Extra reach when deciding whether a marked route ends at a symbol, in paper mm (beyond the course line's gap). */
const TOUCH_MM = 1.0

/**
 * The sheet's rows for a course, top to bottom. A marked route gets its own instruction line where the
 * course follows it: 13.1 when the tape starts at the control before it and ends before the next stop,
 * otherwise 13.2; a tape that ends at the finish becomes the finish line, 14.1 when it starts at the
 * last control, otherwise 14.2. Distances are rounded to 10 m.
 */
export function descriptionSheet(doc: EventDoc, course: Course, title: string): SheetLine[] {
  const climb = course.climb == null ? null : `${Math.round(course.climb / 5) * 5} m`
  const lines: SheetLine[] = [
    { kind: 'title', text: title },
    { kind: 'header', name: course.name, length: formatKm(courseLength(doc, course)), climb },
  ]
  const legs = legLengths(doc, course)
  const metres = (m: number | undefined) => (m === undefined ? '' : `${Math.round(m / 10) * 10} m`)
  const stops = courseStops(doc, course)
  const control = (i: number) => controlById(doc, course.controls[i] as string)
  const sizes = symbolSizes(doc.standard, course.printScale)
  /** Whether a ground point lies at the symbol of stop `i` (not a marked route), within its course line clearance. */
  const touches = (i: number, p: Point | undefined) => {
    const stop = stops[i]
    if (!stop || !p || stop.kind === 'markedRoute') return false
    const reach = ((clearance(stop.kind, sizes) + TOUCH_MM) * course.printScale) / 1000
    const at = control(i).position
    return Math.hypot(p[0] - at[0], p[1] - at[1]) <= reach
  }
  /** How far the course runs to stop `i` from the last control (or the start) before it. */
  const fromLastControl = (i: number) => {
    let total = 0
    for (let j = i - 1; j >= 0; j--) {
      total += (legs[j] ?? 0) + routeLength(doc, course.controls[j] as string)
      if (stops[j]?.kind === 'control' || stops[j]?.kind === 'start') break
    }
    return total
  }
  stops.forEach((stop, i) => {
    const route = control(i).route
    if (stop.kind === 'mapIssue') {
      lines.push({ kind: 'directive', controlId: stop.controlId, symbol: MAP_ISSUE_DIRECTIVE, text: metres(legs[i]) })
    } else if (stop.kind === 'markedRoute' && route) {
      if (stops[i + 1]?.kind === 'finish' && touches(i + 1, route.at(-1))) return // the finish line says it
      const fromControl = (stops[i - 1]?.kind === 'control' || stops[i - 1]?.kind === 'start') && touches(i - 1, route[0])
      const symbol = fromControl && !touches(i + 1, route.at(-1)) ? TAPED_FROM_CONTROL_DIRECTIVE : MARKED_ROUTE_DIRECTIVE
      lines.push({ kind: 'directive', controlId: stop.controlId, symbol, text: metres(routeLength(doc, stop.controlId)) })
    } else if (stop.kind === 'finish') {
      // Taped to the finish: 14.1 from the last control, 14.2 from a funnel; otherwise navigate (14.3).
      const tape = i > 0 ? control(i - 1).route : undefined
      const taped = tape !== undefined && touches(i, tape.at(-1))
      const symbol = !taped ? FINISH_DIRECTIVE : touches(i - 2, tape[0]) ? MARKED_FINISH_DIRECTIVE : FUNNEL_DIRECTIVE
      lines.push({ kind: 'directive', controlId: stop.controlId, symbol, text: metres(i > 0 ? fromLastControl(i) : undefined) })
    } else if (stop.kind === 'crossingPoint') {
      lines.push({ kind: 'directive', controlId: stop.controlId, symbol: CROSSING_DIRECTIVE, text: '' })
    } else {
      lines.push({
        kind: 'control',
        controlId: stop.controlId,
        start: stop.kind === 'start',
        number: stop.number === null ? '' : String(stop.number),
        code: stop.code === null ? '' : String(stop.code),
        cells: controlById(doc, stop.controlId).description ?? {},
      })
    }
  })
  return lines
}

/** Line widths and text sizes as fractions of the cell size. */
export const SHEET = {
  columns: 8,
  thickLine: 0.05,
  thinLine: 0.025,
  /** Digit heights: title, header and instruction text bold; column A bold; B; F; F with two sizes. */
  titleText: 0.4,
  numberText: 0.45,
  codeText: 0.4,
  sizeText: 0.36,
  twoSizesText: 0.3,
} as const

/** Where cell `column` (0 = A … 7 = H) of row `row` lies, in mm from the sheet's top-left corner, y up. */
export function sheetCell(row: number, column: number, cell: number): { left: number; top: number; size: number } {
  return { left: column * cell, top: -row * cell, size: cell }
}

/**
 * The sheet drawn with `cell` mm cells, its top-left corner at (0, 0) and the rows going down (negative y).
 * Description parts carry their control as `owner`.
 */
export function drawDescriptionSheet(lines: SheetLine[], cell: number): Primitive[] {
  const out: Primitive[] = []
  const thick = SHEET.thickLine * cell
  const thin = SHEET.thinLine * cell
  const width = SHEET.columns * cell
  const role = 'description' as const

  const hline = (y: number, lineWidth: number) =>
    out.push({
      type: 'polyline',
      points: [
        [0, y],
        [width, y],
      ],
      lineWidth,
      closed: false,
      role,
    })
  // Vertical lines reach over the horizontal ones so the corners are closed.
  const vline = (x: number, top: number, lineWidth: number) =>
    out.push({
      type: 'polyline',
      points: [
        [x, top + thick / 2],
        [x, top - cell - thick / 2],
      ],
      lineWidth,
      closed: false,
      role,
    })
  const text = (at: Point, s: string, height: number, maxWidth: number, extra: { bold?: boolean; owner?: string } = {}) => {
    if (s) out.push({ type: 'text', at, text: s, height: height * cell, maxWidth, role, ...extra })
  }

  // Thick line above every row that is not a control, above the first control after the start and
  // above every third control after that.
  let counter = 0
  lines.forEach((line, row) => {
    const top = -row * cell
    const middle = top - cell / 2
    const owner = 'controlId' in line ? { owner: line.controlId } : {}
    hline(top, line.kind !== 'control' || counter === 0 ? thick : thin)
    if (row === lines.length - 1) hline(top - cell, thick)
    vline(0, top, thick)
    vline(width, top, thick)

    if (line.kind === 'title') {
      text([width / 2, middle], line.text, SHEET.titleText, width * 0.95, { bold: true })
    } else if (line.kind === 'header') {
      vline(3 * cell, top, thick)
      text([1.5 * cell, middle], line.name, SHEET.titleText, 3 * cell, { bold: true })
      if (line.climb === null) text([5.5 * cell, middle], line.length, SHEET.titleText, 5 * cell, { bold: true })
      else {
        vline(6 * cell, top, thick)
        text([4.5 * cell, middle], line.length, SHEET.titleText, 3 * cell, { bold: true })
        text([7 * cell, middle], line.climb, SHEET.titleText, 2 * cell, { bold: true })
      }
    } else if (line.kind === 'directive') {
      const symbol = descriptionSymbol(line.symbol)
      if (symbol) out.push(...withOwner(drawDescriptionSymbol(symbol, [width / 2, middle], cell), line.controlId))
      text([width / 2, middle], line.text, SHEET.titleText, 2 * cell, { bold: true, ...owner })
    } else {
      for (const x of [1, 2, 4, 5, 7]) vline(x * cell, top, thin)
      for (const x of [3, 6]) vline(x * cell, top, thick)
      const centre = (column: number): Point => [(column + 0.5) * cell, middle]
      if (line.start) {
        const start = descriptionSymbol('start')
        if (start) out.push(...withOwner(drawDescriptionSymbol(start, centre(0), cell), line.controlId))
      } else text(centre(0), line.number, SHEET.numberText, cell, { bold: true, ...owner })
      text(centre(1), line.code, SHEET.codeText, cell, owner)
      ;(['c', 'd', 'e', 'f', 'g', 'h'] as const).forEach((key, i) => {
        const value = line.cells[key]
        if (!value) return
        const symbol = cellSymbol(key, value)
        if (symbol) out.push(...withOwner(drawDescriptionSymbol(symbol, centre(i + 2), cell), line.controlId))
        else if (key === 'f') out.push(...sizeText(value, 5 * cell, top, cell, line.controlId))
      })
    }

    if (line.kind === 'control') counter = line.start ? 0 : (counter + 1) % 3
    else counter = 0
  })
  return out
}

function withOwner(primitives: Primitive[], owner: string): Primitive[] {
  return primitives.map(p => ({ ...p, owner }))
}

/** Column F text: "1.5", "3x4" (drawn with ×), "0.5/2" split by a diagonal, "2|3" one above the other. */
function sizeText(value: string, left: number, top: number, cell: number, owner: string): Primitive[] {
  const s = value.replace('x', '×')
  const role = 'description' as const
  const t = (at: Point, text: string, height: number, maxWidth: number): Primitive => ({
    type: 'text',
    at,
    text,
    height: height * cell,
    maxWidth,
    role,
    owner,
  })
  const bar = s.indexOf('|')
  if (bar >= 0) {
    return [
      t([left + cell / 2, top - cell / 4], s.slice(0, bar), SHEET.twoSizesText, cell),
      t([left + cell / 2, top - (3 * cell) / 4], s.slice(bar + 1), SHEET.twoSizesText, cell),
    ]
  }
  const slash = s.indexOf('/')
  if (slash >= 0) {
    // The first size in the upper left 63 % of the cell, the second in the lower right, a thin line between.
    const w = 0.63 * cell
    return [
      {
        type: 'polyline',
        points: [
          [left + cell, top],
          [left, top - cell],
        ],
        lineWidth: SHEET.thinLine * cell,
        closed: false,
        role,
        owner,
      },
      t([left + w / 2, top - cell / 4], s.slice(0, slash), SHEET.twoSizesText, w),
      t([left + cell - w / 2, top - (3 * cell) / 4], s.slice(slash + 1), SHEET.twoSizesText, w),
    ]
  }
  return [t([left + cell / 2, top - cell / 2], s, SHEET.sizeText, cell)]
}

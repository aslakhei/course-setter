// IOF control description symbols (International Specification for Control Descriptions 2024), as
// drawing primitives. The artwork comes from Purple Pen (see symbols.data.ts); ids are Purple Pen's,
// which keep the 2004 specification's numbers for symbols that were renumbered later, so they stay stable.
import type { DescriptionColumnKey } from '../course/doc.ts'
import type { PathCommand, Primitive } from '../render/primitives.ts'
import type { Point } from '../similarity.ts'
import { SYMBOLS } from './symbols.data.ts'

/** Column of the description sheet a symbol belongs in; V-Z are the special instruction lines. */
export type DescriptionColumn = '@' | 'A' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'V' | 'W' | 'X' | 'Y' | 'Z'

export type DescriptionShape =
  | { disc: [number, number, number] }
  | { circle: [number, number, number]; width: number }
  | { line: PathCommand[]; width: number; cap: 'butt' | 'round'; join: 'miter' | 'round' }
  | { area: PathCommand[] }

export type DescriptionSymbolDef = {
  id: string
  column: string
  name: string
  /** Column F: a single number means a depth, not a height. */
  sizeIsDepth?: boolean
  shapes: DescriptionShape[]
}

/** Every description symbol, in the order of the specification. */
export const DESCRIPTION_SYMBOLS: readonly DescriptionSymbolDef[] = SYMBOLS

const byId = new Map(SYMBOLS.map(s => [s.id, s]))

export function descriptionSymbol(id: string): DescriptionSymbolDef | undefined {
  return byId.get(id)
}

/** Which symbol columns each description column takes: column E may also hold a second feature. */
export const CELL_SYMBOL_COLUMNS: Record<DescriptionColumnKey, readonly string[]> = {
  c: ['C'],
  d: ['D'],
  e: ['E', 'D'],
  f: ['F'],
  g: ['G'],
  h: ['H'],
}

/**
 * The symbol a cell's value stands for, or undefined when it is not a drawn symbol of that column. Ids
 * look like numbers ("1.5" is the quarry), so a size in column F must not be read as a symbol.
 */
export function cellSymbol(column: DescriptionColumnKey, value: string): DescriptionSymbolDef | undefined {
  const symbol = byId.get(value)
  return symbol && symbol.shapes.length > 0 && CELL_SYMBOL_COLUMNS[column].includes(symbol.column) ? symbol : undefined
}

/** Units of the symbol drawing per box: a symbol is drawn in a 200 × 200 unit box. */
export const SYMBOL_BOX_UNITS = 200

/**
 * The symbol drawn in a square cell `box` mm wide centred on `center` (instruction lines are 8 cells
 * wide and `box` mm high).
 */
export function drawDescriptionSymbol(symbol: DescriptionSymbolDef, center: Point, box: number): Primitive[] {
  const k = box / SYMBOL_BOX_UNITS
  const [cx, cy] = center
  const x = (u: number) => cx + u * k
  const y = (v: number) => cy + v * k
  const path = (commands: PathCommand[]): PathCommand[] =>
    commands.map((c): PathCommand => {
      if (c[0] === 'Z') return c
      if (c[0] === 'C') return ['C', x(c[1]), y(c[2]), x(c[3]), y(c[4]), x(c[5]), y(c[6])]
      return [c[0], x(c[1]), y(c[2])]
    })
  const tag = { role: 'description' } as const
  return symbol.shapes.map((s): Primitive => {
    if ('disc' in s)
      return { type: 'circle', center: [x(s.disc[0]), y(s.disc[1])], radius: s.disc[2] * k, lineWidth: 0, filled: true, ...tag }
    if ('circle' in s)
      return { type: 'circle', center: [x(s.circle[0]), y(s.circle[1])], radius: s.circle[2] * k, lineWidth: s.width * k, ...tag }
    if ('line' in s) return { type: 'path', commands: path(s.line), lineWidth: s.width * k, cap: s.cap, join: s.join, ...tag }
    return { type: 'path', commands: path(s.area), lineWidth: 0, filled: true, ...tag }
  })
}

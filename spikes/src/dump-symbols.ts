// Prototype: dump colour table and used symbols, to diagnose rendering differences.
// Usage: pnpm --dir spikes dump-symbols maps/<file>.ocd
import { readOcad } from 'ocad2geojson'

const file = process.argv[2]
if (!file) {
  console.error('Usage: dump-symbols <file.ocd>')
  process.exit(1)
}
const ocad = await readOcad(file, { quietWarnings: true })

console.log('# Colours (render order = index in colour table; lower is drawn on top)')
for (const c of ocad.colors) {
  if (c) console.log(`  #${String(c.number).padStart(3)}  order ${String(c.renderOrder).padStart(2)}  cmyk ${c.cmyk.join('/').padEnd(14)} ${c.rgb.padEnd(20)} ${c.name}`)
}

type Sym = {
  symNum: number
  type: number
  /** ocad2geojson stores the symbol name as `description`. */
  description?: string
  status?: number
  isHidden(): boolean
  fillOn?: boolean
  fillColor?: number
  colors?: number[]
  hatchMode?: number
  hatchColor?: number
  hatchDist?: number
  structMode?: number
  borderSym?: number
  lineColor?: number
  lineWidth?: number
  elements?: unknown[]
}
const objects = ocad.objects as unknown as Array<{ sym: number; objType: number }>
const counts = new Map<number, number>()
for (const o of objects) counts.set(o.sym, (counts.get(o.sym) ?? 0) + 1)

const fmtSym = (n: number) => `${Math.floor(n / 1000)}.${n % 1000}`
const colourName = (n?: number) => (n == null ? '-' : `${n}:${ocad.colors[n]?.name ?? '??'}`)
console.log('\n# Used symbols')
for (const s of (ocad.symbols as unknown as Sym[]).sort((a, b) => a.symNum - b.symNum)) {
  const n = counts.get(s.symNum)
  if (!n) continue
  const kind = ['', 'point', 'line', 'area', 'text', 'rect', 'ltext', 'utext'][s.type]
  let detail = ''
  if (s.type === 3) detail = `fillOn=${s.fillOn} fill=${colourName(s.fillColor)} hatch=${s.hatchMode}${s.hatchMode ? `(${colourName(s.hatchColor)}, every ${(s.hatchDist ?? 0) / 100} mm)` : ''} struct=${s.structMode} border=${s.borderSym ? fmtSym(s.borderSym) : '-'}`
  if (s.type === 2) detail = `width=${s.lineWidth} colour=${colourName(s.lineColor)}`
  if (s.type === 1) detail = `elements=${s.elements?.length}`
  console.log(`  ${fmtSym(s.symNum).padEnd(8)} ${kind.padEnd(5)} x${String(n).padEnd(5)} ${s.isHidden() ? 'HIDDEN ' : ''}${(s.description ?? '').padEnd(34)} ${detail}`)
}

// Prototype: can ocad2geojson read the file, and what scale/georef/extent does it carry?
// Usage: pnpm --dir spikes inspect-ocad maps/<file>.ocd [more files]
import { statSync } from 'node:fs'
import { basename } from 'node:path'
import { readOcad } from 'ocad2geojson'

// OCAD paper coordinates are in 1/100 mm.
const PAPER_UNITS_PER_MM = 100

const SYMBOL_TYPES: Record<number, string> = {
  1: 'point',
  2: 'line',
  3: 'area',
  4: 'text',
  5: 'rectangle',
  6: 'line text',
  7: 'unformatted text',
}
const OBJECT_TYPES: Record<number, string> = {
  1: 'point',
  2: 'line',
  3: 'area',
  4: 'unformatted text',
  5: 'formatted text',
  6: 'line text',
  7: 'rectangle',
}

function countBy<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1
  return out
}

async function inspect(path: string): Promise<void> {
  const t0 = performance.now()
  const ocad = await readOcad(path, { quietWarnings: true })
  const parseMs = performance.now() - t0

  const h = ocad.header
  const crs = ocad.getCrs()
  const [x0, y0, x1, y1] = ocad.getBounds()
  const widthMm = (x1 - x0) / PAPER_UNITS_PER_MM
  const heightMm = (y1 - y0) / PAPER_UNITS_PER_MM
  const groundM = (mm: number) => (mm / 1000) * crs.scale

  // ocad2geojson's bundled types omit these runtime fields.
  const objects = ocad.objects as unknown as Array<{ sym: number; objType: number }>
  const usedSymbols = new Set(objects.map(o => o.sym))
  const symbols = ocad.symbols as Array<{ symNum: number; type: number; name?: string; hatchMode?: number; structMode?: number }>

  console.log(`\n=== ${basename(path)} ===`)
  console.log(`file size:        ${(statSync(path).size / 1e6).toFixed(1)} MB`)
  console.log(`format version:   ${h.version}.${h.subVersion}.${h.subSubVersion} (file type ${h.fileType})`)
  console.log(`parse time:       ${parseMs.toFixed(0)} ms`)
  console.log(`warnings:         ${ocad.warnings.length}`)
  for (const w of ocad.warnings.slice(0, 5)) console.log(`  - ${w}`)
  console.log(`scale:            1:${crs.scale}`)
  console.log(
    `georef:           grid id ${crs.gridId} -> ${crs.catalog ?? '?'}:${crs.code ?? '?'} ${crs.name ?? '(not in ocad2geojson grid table)'}`,
  )
  console.log(`                  origin E ${crs.easting} N ${crs.northing}, grivation ${((crs.grivation * 180) / Math.PI).toFixed(3)}°`)
  console.log(`extent (paper):   ${widthMm.toFixed(1)} x ${heightMm.toFixed(1)} mm`)
  console.log(`extent (ground):  ${groundM(widthMm).toFixed(0)} x ${groundM(heightMm).toFixed(0)} m`)
  console.log(`colours:          ${ocad.colors.filter(Boolean).length}`)
  console.log(`symbols:          ${symbols.length} defined, ${usedSymbols.size} used`)
  console.log(
    `  by type (used): ${JSON.stringify(
      countBy(
        symbols.filter(s => usedSymbols.has(s.symNum)),
        s => SYMBOL_TYPES[s.type] ?? `type ${s.type}`,
      ),
    )}`,
  )
  console.log(
    `  area patterns:  ${symbols.filter(s => usedSymbols.has(s.symNum) && (s.hatchMode || s.structMode)).length} used area symbols with hatch/structure`,
  )
  console.log(`objects:          ${objects.length}`)
  console.log(`  by type:        ${JSON.stringify(countBy(objects, o => OBJECT_TYPES[o.objType] ?? `type ${o.objType}`))}`)
  const missing = [...usedSymbols].filter(n => !symbols.some(s => s.symNum === n))
  if (missing.length) console.log(`  objects with undefined symbol: ${missing.length} symbol numbers`)
}

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('Usage: inspect-ocad <file.ocd> [...]')
  process.exit(1)
}
for (const f of files) {
  try {
    await inspect(f)
  } catch (e) {
    console.log(`\n=== ${basename(f)} === FAILED: ${(e as Error).message}`)
  }
}

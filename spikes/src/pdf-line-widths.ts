// Prototype: histogram of stroke widths in a vector PDF map, to estimate its print scale.
// ISOM 2017-2 contour = 0.14 mm at 1:15 000; maps printed at 1:10 000 are enlarged 150 % (0.21 mm).
// Usage: pnpm --dir spikes pdf-line-widths maps/<file>.pdf
import { readFileSync } from 'node:fs'
import * as mupdf from 'mupdf'
import { PT_PER_MM } from './lib/util.ts'

const file = process.argv[2]
if (!file) {
  console.error('Usage: pdf-line-widths <file.pdf>')
  process.exit(1)
}
const doc = mupdf.Document.openDocument(readFileSync(file), 'application/pdf') as mupdf.PDFDocument
const page = doc.loadPage(0) as mupdf.PDFPage

// Collect content streams of the page and any form XObjects it uses.
const streams: string[] = []
const seen = new Set<string>()
function collect(obj: mupdf.PDFObject) {
  const o = obj.resolve()
  if (o.isArray()) {
    for (let i = 0; i < o.length; i++) collect(o.get(i))
  } else if (o.isStream()) {
    // readStream needs the indirect reference, not the resolved object.
    streams.push(obj.readStream().asString())
  }
}
const pageObj = page.getObject()
collect(pageObj.get('Contents'))
const xobjects = pageObj.get('Resources').resolve().get('XObject')
if (xobjects && !xobjects.isNull()) {
  xobjects.resolve().forEach((v: mupdf.PDFObject, k: string | number) => {
    const key = String(k)
    if (seen.has(key)) return
    seen.add(key)
    const x = v.resolve()
    if (x.get('Subtype').asName() === 'Form') streams.push(v.readStream().asString())
  })
}

// Scale from the current transformation matrix is ignored; OCAD writes widths in page units.
const counts = new Map<string, number>()
for (const s of streams) for (const m of s.matchAll(/(?:^|\s)(\d*\.?\d+)\s+w\b/g)) {
  const mm = (Number(m[1]) / PT_PER_MM).toFixed(3)
  counts.set(mm, (counts.get(mm) ?? 0) + 1)
}
console.log(`${file}: ${streams.length} content stream(s); most common stroke widths:`)
for (const [mm, n] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${mm} mm  x${n}`)

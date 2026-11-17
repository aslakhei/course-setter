// Prototype: render a PDF map page with mupdf.js and report its physical size.
// Usage: pnpm --dir spikes render-pdf maps/<file>.pdf [dpi=300]
import { readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import * as mupdf from 'mupdf'
import { isMain, mmToPx, outPath, PT_PER_MM, writeOut } from './lib/util.ts'

export function renderPdfPage(path: string, dpi: number) {
  const doc = mupdf.Document.openDocument(readFileSync(path), 'application/pdf')
  const page = doc.loadPage(0)
  const [x0, y0, x1, y1] = page.getBounds()
  const t0 = performance.now()
  const pixmap = page.toPixmap(mupdf.Matrix.scale(dpi / 72, dpi / 72), mupdf.ColorSpace.DeviceRGB, false, true)
  const renderMs = performance.now() - t0
  return {
    pages: doc.countPages(),
    creator: doc.getMetaData('info:Creator') ?? doc.getMetaData('info:Producer') ?? '?',
    widthMm: (x1 - x0) / PT_PER_MM,
    heightMm: (y1 - y0) / PT_PER_MM,
    pixmap,
    renderMs,
  }
}

if (isMain(import.meta.url)) {
  const [file, dpiArg] = process.argv.slice(2)
  if (!file) {
    console.error('Usage: render-pdf <file.pdf> [dpi]')
    process.exit(1)
  }
  const dpi = Number(dpiArg ?? 300)
  const r = renderPdfPage(file, dpi)
  const png = r.pixmap.asPNG()
  const out = writeOut(outPath(`${basename(file, '.pdf')}@${dpi}dpi.png`), png)
  console.log(`=== ${basename(file)} ===`)
  console.log(`file size:   ${(statSync(file).size / 1e6).toFixed(1)} MB, ${r.pages} page(s), creator ${r.creator}`)
  console.log(`page size:   ${r.widthMm.toFixed(1)} x ${r.heightMm.toFixed(1)} mm`)
  console.log(
    `render:      ${r.pixmap.getWidth()} x ${r.pixmap.getHeight()} px at ${dpi} dpi (expected ${mmToPx(r.widthMm, dpi).toFixed(0)} px wide) in ${r.renderMs.toFixed(0)} ms`,
  )
  console.log(`png:         ${(png.length / 1e6).toFixed(1)} MB -> ${out}`)
}

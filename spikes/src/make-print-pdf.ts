// Prototype: A4 print PDF = OCAD map rendered for the print area + test course on top (Multiply),
// then verified by rendering the PDF back and measuring known points.
// Usage: pnpm --dir spikes make-print-pdf maps/<map>.ocd [--print-scale 15000] [--dpi 600]
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { parseArgs } from 'node:util'
import { Resvg } from '@resvg/resvg-js'
import * as mupdf from 'mupdf'
import { BlendMode, PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import sharp from 'sharp'
import { mmToPx, OCAD_UNITS_PER_MM, outPath, PT_PER_MM, writeOut } from './lib/util.ts'
import { ocadSvg } from './render-ocad.ts'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { 'print-scale': { type: 'string' }, dpi: { type: 'string', default: '600' } },
})
const file = positionals[0]
if (!file) {
  console.error('Usage: make-print-pdf <map.ocd> [--print-scale N] [--dpi 600]')
  process.exit(1)
}
const DPI = Number(values.dpi)
const PAPER = { w: 210, h: 297 } // A4 portrait, mm
const MARGIN = 8 // mm, unprintable border on most printers
const PURPLE = rgb(158 / 255, 42 / 255, 151 / 255) // OCAD "Purple for course overprint"
// ISOM 2017-2 course symbol sizes at 1:15 000 (mm on paper).
const CONTROL_D = 5.0
const COURSE_LINE = 0.35

const map = await ocadSvg(file)
const mapScale = map.ocad.getCrs().scale
const printScale = Number(values['print-scale'] ?? mapScale)
/** OCAD units (1/100 mm at map scale) per mm on the printed paper. */
const unitsPerPaperMm = (OCAD_UNITS_PER_MM * printScale) / mapScale
const [, b1, , b3] = map.bounds

// Pick two boulders 60–150 mm apart on paper; centre the print area between them.
const boulders = (map.ocad.objects as unknown as Array<{ sym: number; coordinates: number[][] }>)
  .filter(o => o.sym === 204000)
  .map(o => o.coordinates[0])
let pair: [number[], number[]] | undefined
outer: for (let i = 0; i < boulders.length; i += 7)
  for (let j = i + 1; j < boulders.length; j += 3) {
    const dxMm = Math.abs(boulders[i][0] - boulders[j][0]) / unitsPerPaperMm
    const dyMm = Math.abs(boulders[i][1] - boulders[j][1]) / unitsPerPaperMm
    const d = Math.hypot(dxMm, dyMm)
    if (d > 60 && d < 150 && dxMm < PAPER.w - 4 * MARGIN && dyMm < PAPER.h - 4 * MARGIN) {
      pair = [boulders[i], boulders[j]]
      break outer
    }
  }
if (!pair) throw new Error('no suitable boulder pair found')
const [A, B] = pair
const centre = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2]

// Print area in OCAD units (y up) for the full sheet; the map is clipped to the margins below.
const area = {
  x0: centre[0] - (PAPER.w / 2) * unitsPerPaperMm,
  y1: centre[1] + (PAPER.h / 2) * unitsPerPaperMm,
  w: PAPER.w * unitsPerPaperMm,
  h: PAPER.h * unitsPerPaperMm,
}
// ocad2geojson's SVG: svgY = b1 + b3 - ocadY. Point the viewBox at the print area.
const svg = map.svg.replace(/viewBox="[^"]*"/, `viewBox="${area.x0},${b1 + b3 - area.y1},${area.w},${area.h}"`)

let t0 = performance.now()
const image = new Resvg(svg, {
  fitTo: { mode: 'width', value: Math.round(mmToPx(PAPER.w, DPI)) },
  background: 'white',
  font: { loadSystemFonts: true, defaultFontFamily: 'Arial' },
}).render()
const mapPng = await sharp(image.pixels, { raw: { width: image.width, height: image.height, channels: 4 } })
  .removeAlpha()
  .png({ palette: true, colours: 256 })
  .toBuffer()
const renderMs = performance.now() - t0

// --- Compose PDF --------------------------------------------------------------------
t0 = performance.now()
const pdf = await PDFDocument.create()
const page = pdf.addPage([PAPER.w * PT_PER_MM, PAPER.h * PT_PER_MM])
const png = await pdf.embedPng(mapPng)
// Clip map to the printable area by drawing the full sheet and white margins on top.
page.drawImage(png, { x: 0, y: 0, width: PAPER.w * PT_PER_MM, height: PAPER.h * PT_PER_MM })
const white = rgb(1, 1, 1)
const pt = (mm: number) => mm * PT_PER_MM
for (const r of [
  [0, 0, PAPER.w, MARGIN],
  [0, PAPER.h - MARGIN, PAPER.w, MARGIN],
  [0, 0, MARGIN, PAPER.h],
  [PAPER.w - MARGIN, 0, MARGIN, PAPER.h],
])
  page.drawRectangle({ x: pt(r[0]), y: pt(r[1]), width: pt(r[2]), height: pt(r[3]), color: white })

/** OCAD coordinate -> paper mm from bottom-left of the sheet. */
const toPaper = (c: number[]) => [(c[0] - area.x0) / unitsPerPaperMm, PAPER.h - (area.y1 - c[1]) / unitsPerPaperMm]
const pA = toPaper(A)
const pB = toPaper(B)
const course = { borderColor: PURPLE, borderWidth: pt(COURSE_LINE), blendMode: BlendMode.Multiply, opacity: 0, borderOpacity: 1 }
for (const p of [pA, pB]) page.drawCircle({ x: pt(p[0]), y: pt(p[1]), size: pt(CONTROL_D / 2), ...course })
// Leg line from circle edge to circle edge.
const len = Math.hypot(pB[0] - pA[0], pB[1] - pA[1])
const ux = (pB[0] - pA[0]) / len
const uy = (pB[1] - pA[1]) / len
const gap = CONTROL_D / 2 + 0.3
page.drawLine({
  start: { x: pt(pA[0] + ux * gap), y: pt(pA[1] + uy * gap) },
  end: { x: pt(pB[0] - ux * gap), y: pt(pB[1] - uy * gap) },
  thickness: pt(COURSE_LINE),
  color: PURPLE,
  blendMode: BlendMode.Multiply,
})
// 1 km scale bar for checking with a ruler.
const kmMm = (1000 / printScale) * 1000
const font = await pdf.embedFont(StandardFonts.Helvetica)
page.drawRectangle({ x: pt(MARGIN + 4), y: pt(MARGIN + 4), width: pt(kmMm + 4), height: pt(9), color: white })
page.drawLine({
  start: { x: pt(MARGIN + 6), y: pt(MARGIN + 6) },
  end: { x: pt(MARGIN + 6 + kmMm), y: pt(MARGIN + 6) },
  thickness: pt(0.3),
  color: rgb(0, 0, 0),
})
for (const x of [0, kmMm])
  page.drawLine({
    start: { x: pt(MARGIN + 6 + x), y: pt(MARGIN + 6) },
    end: { x: pt(MARGIN + 6 + x), y: pt(MARGIN + 9) },
    thickness: pt(0.3),
    color: rgb(0, 0, 0),
  })
page.drawText(`1 km = ${kmMm.toFixed(2)} mm at 1:${printScale} (map 1:${mapScale})`, {
  x: pt(MARGIN + 8),
  y: pt(MARGIN + 7.5),
  size: 7,
  font,
})

const bytes = await pdf.save()
const composeMs = performance.now() - t0
const out = writeOut(outPath(`print/${basename(file, '.ocd')}-A4-1_${printScale}-${DPI}dpi.pdf`), bytes)
console.log(`print 1:${printScale} from 1:${mapScale} map, A4 at ${DPI} dpi`)
console.log(
  `map raster ${image.width}x${image.height}px rendered in ${(renderMs / 1000).toFixed(1)} s; PDF composed in ${(composeMs / 1000).toFixed(1)} s`,
)
console.log(`PDF ${(bytes.length / 1e6).toFixed(1)} MB -> ${out}`)

// --- Verify: render the PDF and locate the two boulders -----------------------------
const VDPI = 600
const doc = mupdf.Document.openDocument(readFileSync(out), 'application/pdf')
const vpage = doc.loadPage(0)
const [, , pw, ph] = vpage.getBounds()
const pix = vpage.toPixmap(mupdf.Matrix.scale(VDPI / 72, VDPI / 72), mupdf.ColorSpace.DeviceRGB, false, true)
const W = pix.getWidth()
const px = pix.getPixels()
/** Centroid of black pixels within ±0.45 mm (just the boulder dot, not nearby black lines). */
function findDot(p: number[]) {
  const cx = mmToPx(p[0], VDPI)
  const cy = mmToPx(PAPER.h - p[1], VDPI)
  const r = Math.round(mmToPx(0.45, VDPI))
  let sx = 0
  let sy = 0
  let n = 0
  for (let y = Math.round(cy) - r; y <= cy + r; y++)
    for (let x = Math.round(cx) - r; x <= cx + r; x++) {
      const i = (y * W + x) * 3
      if (px[i] < 90 && px[i + 1] < 90 && px[i + 2] < 90) {
        sx += x
        sy += y
        n++
      }
    }
  if (!n) throw new Error(`no black dot near ${p.map(v => v.toFixed(1))} mm`)
  return { x: sx / n, y: sy / n, offMm: Math.hypot((sx / n - cx) * (25.4 / VDPI), (sy / n - cy) * (25.4 / VDPI)) }
}
const dA = findDot(pA)
const dB = findDot(pB)
const measuredMm = Math.hypot(dB.x - dA.x, dB.y - dA.y) * (25.4 / VDPI)
const groundM = (Math.hypot(B[0] - A[0], B[1] - A[1]) / OCAD_UNITS_PER_MM / 1000) * mapScale
const expectedMm = (groundM / printScale) * 1000
console.log(`verify: page ${(pw / PT_PER_MM).toFixed(1)} x ${(ph / PT_PER_MM).toFixed(1)} mm`)
console.log(
  `verify: boulders ${groundM.toFixed(1)} m apart -> expected ${expectedMm.toFixed(2)} mm, measured ${measuredMm.toFixed(2)} mm on the PDF (error ${(measuredMm - expectedMm).toFixed(2)} mm)`,
)
console.log(`verify: boulder centres are ${dA.offMm.toFixed(2)} / ${dB.offMm.toFixed(2)} mm from the control circle centres`)

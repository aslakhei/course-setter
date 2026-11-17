// Prototype: compare our OCAD render with an OCAD-exported reference PDF of (part of) the same map.
// 1. Find where the reference page sits in our render (coarse-to-fine template matching).
// 2. Measure scale error: local displacement of patches across the page, fitted linearly.
// 3. Write side-by-side detail crops and a difference image to spikes/out/compare/.
// Usage: pnpm --dir spikes compare-reference maps/<map>.ocd "maps/<reference>.pdf" [dpi=300]
import { mkdirSync } from 'node:fs'
import sharp, { type Sharp } from 'sharp'
import { outPath, pxToMm } from './lib/util.ts'
import { ocadSvg, rasterise } from './render-ocad.ts'
import { renderPdfPage } from './render-pdf.ts'

type Gray = { data: Uint8Array; w: number; h: number }
type Rgb = { data: Uint8Array; w: number; h: number }

const [ocdPath, refPath, dpiArg] = process.argv.slice(2)
if (!ocdPath || !refPath) {
  console.error('Usage: compare-reference <map.ocd> <reference.pdf> [dpi]')
  process.exit(1)
}
const DPI = Number(dpiArg ?? 300)

async function toRgb(img: Sharp): Promise<Rgb> {
  const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), w: info.width, h: info.height }
}
function toGray(rgb: Rgb): Gray {
  const out = new Uint8Array(rgb.w * rgb.h)
  for (let i = 0, j = 0; i < out.length; i++, j += 3) out[i] = (rgb.data[j] * 77 + rgb.data[j + 1] * 150 + rgb.data[j + 2] * 29) >> 8
  return { data: out, w: rgb.w, h: rgb.h }
}
async function downscale(rgb: Rgb, factor: number): Promise<Gray> {
  const img = sharp(Buffer.from(rgb.data), { raw: { width: rgb.w, height: rgb.h, channels: 3 } })
  return toGray(await toRgb(img.resize(Math.round(rgb.w / factor), Math.round(rgb.h / factor), { kernel: 'cubic' })))
}

/** Mean absolute difference of ref (in window) vs img shifted by (dx,dy), ignoring pixels white in both. */
function cost(ref: Gray, img: Gray, dx: number, dy: number, win = { x0: 0, y0: 0, x1: ref.w, y1: ref.h }, step = 1): number {
  let sum = 0
  let n = 0
  for (let y = win.y0; y < win.y1; y += step) {
    const iy = y + dy
    if (iy < 0 || iy >= img.h) continue
    for (let x = win.x0; x < win.x1; x += step) {
      const ix = x + dx
      if (ix < 0 || ix >= img.w) continue
      const a = ref.data[y * ref.w + x]
      const b = img.data[iy * img.w + ix]
      if (a > 250 && b > 250) continue
      sum += Math.abs(a - b)
      n++
    }
  }
  return n < 50 ? Infinity : sum / n
}

function bestShift(ref: Gray, img: Gray, cx: number, cy: number, radius: number, win?: Parameters<typeof cost>[4]) {
  let best = { dx: cx, dy: cy, c: Infinity }
  const costs = new Map<string, number>()
  for (let dy = cy - radius; dy <= cy + radius; dy++)
    for (let dx = cx - radius; dx <= cx + radius; dx++) {
      const c = cost(ref, img, dx, dy, win)
      costs.set(`${dx},${dy}`, c)
      if (c < best.c) best = { dx, dy, c }
    }
  // Sub-pixel refinement: parabola through neighbours on each axis.
  const sub = (cm: number | undefined, c0: number, cp: number | undefined) =>
    cm == null || cp == null || !Number.isFinite(cm) || !Number.isFinite(cp) || cm + cp - 2 * c0 <= 0
      ? 0
      : (cm - cp) / (2 * (cm + cp - 2 * c0))
  const sx = sub(costs.get(`${best.dx - 1},${best.dy}`), best.c, costs.get(`${best.dx + 1},${best.dy}`))
  const sy = sub(costs.get(`${best.dx},${best.dy - 1}`), best.c, costs.get(`${best.dx},${best.dy + 1}`))
  return { ...best, fx: best.dx + sx, fy: best.dy + sy }
}

// --- Render both at DPI ---------------------------------------------------------------
console.log(`Rendering reference and OCAD map at ${DPI} dpi…`)
const ref = renderPdfPage(refPath, DPI)
const refRgb = await toRgb(sharp(Buffer.from(ref.pixmap.asPNG())))
const map = await ocadSvg(ocdPath)
const { image } = rasterise(map.svg, map.widthMm, DPI)
const ocadRgb = await toRgb(sharp(Buffer.from(image.asPng())))
console.log(`reference ${refRgb.w}x${refRgb.h}px, ocad ${ocadRgb.w}x${ocadRgb.h}px`)

// --- Coarse-to-fine global alignment -------------------------------------------------
const levels = [50, 10, 2, 1] // downscale factors
let dx = 0
let dy = 0
for (const [i, f] of levels.entries()) {
  const r = f === 1 ? toGray(refRgb) : await downscale(refRgb, f)
  const o = f === 1 ? toGray(ocadRgb) : await downscale(ocadRgb, f)
  if (i === 0) {
    // Exhaustive search over all overlaps at the coarsest level.
    let best = { dx: 0, dy: 0, c: Infinity }
    for (let y = -r.h + 10; y < o.h - 10; y++)
      for (let x = -r.w + 10; x < o.w - 10; x++) {
        const c = cost(r, o, x, y)
        if (c < best.c) best = { dx: x, dy: y, c }
      }
    ;({ dx, dy } = best)
  } else {
    const ratio = levels[i - 1] / f
    const b = bestShift(r, o, Math.round(dx * ratio), Math.round(dy * ratio), Math.ceil(ratio) + 2)
    ;({ dx, dy } = b)
  }
  console.log(`  level 1/${f}: offset (${dx}, ${dy}) px`)
}
const offsetMm = [pxToMm(dx, DPI), pxToMm(dy, DPI)]
console.log(`Reference page top-left sits at (${offsetMm[0].toFixed(2)}, ${offsetMm[1].toFixed(2)}) mm in our render`)

// --- Local displacements -> scale error ----------------------------------------------
const refG = toGray(refRgb)
const ocadG = toGray(ocadRgb)
const P = Math.round((25 / 25.4) * DPI) // 25 mm patches
const samples: Array<{ x: number; y: number; ddx: number; ddy: number }> = []
for (let py = P; py + 2 * P < refG.h; py += P * 2)
  for (let px = P; px + 2 * P < refG.w; px += P * 2) {
    const win = { x0: px, y0: py, x1: px + P, y1: py + P }
    let ink = 0
    for (let y = win.y0; y < win.y1; y += 4) for (let x = win.x0; x < win.x1; x += 4) if (refG.data[y * refG.w + x] < 200) ink++
    if (ink < (P * P) / 16 / 10) continue // skip mostly-white patches
    const b = bestShift(refG, ocadG, dx, dy, 6, win)
    if (!Number.isFinite(b.c)) continue
    samples.push({ x: px + P / 2, y: py + P / 2, ddx: b.fx - dx, ddy: b.fy - dy })
  }
function fit(xs: number[], ys: number[]) {
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0
  let sxx = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
  }
  const slope = sxy / sxx
  const resid = Math.sqrt(xs.reduce((a, x, i) => a + (ys[i] - (my + slope * (x - mx))) ** 2, 0) / n)
  return { slope, resid }
}
const fx = fit(
  samples.map(s => s.x),
  samples.map(s => s.ddx),
)
const fy = fit(
  samples.map(s => s.y),
  samples.map(s => s.ddy),
)
const maxDisp = Math.max(...samples.map(s => Math.hypot(s.ddx, s.ddy)))
console.log(`Local alignment over ${samples.length} patches of 25 mm:`)
console.log(`  scale error x: ${(fx.slope * 100).toFixed(3)} %  (residual ${pxToMm(fx.resid, DPI).toFixed(3)} mm)`)
console.log(`  scale error y: ${(fy.slope * 100).toFixed(3)} %  (residual ${pxToMm(fy.resid, DPI).toFixed(3)} mm)`)
console.log(`  max local displacement: ${pxToMm(maxDisp, DPI).toFixed(3)} mm`)

// --- Pixel agreement + outputs --------------------------------------------------------
let agree = 0
let inked = 0
const diff = Buffer.alloc(refRgb.w * refRgb.h * 3, 255)
for (let y = 0; y < refRgb.h; y++)
  for (let x = 0; x < refRgb.w; x++) {
    const ox = x + dx
    const oy = y + dy
    if (ox < 0 || oy < 0 || ox >= ocadRgb.w || oy >= ocadRgb.h) continue
    const i = (y * refRgb.w + x) * 3
    const j = (oy * ocadRgb.w + ox) * 3
    const a = refRgb.data
    const b = ocadRgb.data
    if (a[i] > 250 && a[i + 1] > 250 && a[i + 2] > 250 && b[j] > 250 && b[j + 1] > 250 && b[j + 2] > 250) continue
    inked++
    const d = Math.abs(a[i] - b[j]) + Math.abs(a[i + 1] - b[j + 1]) + Math.abs(a[i + 2] - b[j + 2])
    if (d < 60) agree++
    // Diff image: grey = agreement, red = only in reference, blue = only in ours.
    const ga = a[i] + a[i + 1] + a[i + 2]
    const gb = b[j] + b[j + 1] + b[j + 2]
    const colour = d < 60 ? [200, 200, 200] : ga < gb ? [220, 30, 30] : [30, 60, 220]
    diff.set(colour, i)
  }
console.log(`Colour agreement on inked pixels: ${((agree / inked) * 100).toFixed(1)} %`)

mkdirSync(outPath('compare'), { recursive: true })
await sharp(diff, { raw: { width: refRgb.w, height: refRgb.h, channels: 3 } })
  .resize({ width: 1400 })
  .png()
  .toFile(outPath('compare/diff.png'))

// Side-by-side detail crops (reference left, ours right) at 1:1 pixels.
const C = Math.round((40 / 25.4) * DPI) // 40 mm square
const spots = samples.filter((_, i) => i % Math.max(1, Math.floor(samples.length / 6)) === 0).slice(0, 6)
for (const [k, s] of spots.entries()) {
  const left = Math.max(0, Math.min(refRgb.w - C, Math.round(s.x - C / 2)))
  const top = Math.max(0, Math.min(refRgb.h - C, Math.round(s.y - C / 2)))
  const r = await sharp(Buffer.from(refRgb.data), { raw: { width: refRgb.w, height: refRgb.h, channels: 3 } })
    .extract({ left, top, width: C, height: C })
    .png()
    .toBuffer()
  const o = await sharp(Buffer.from(ocadRgb.data), { raw: { width: ocadRgb.w, height: ocadRgb.h, channels: 3 } })
    .extract({ left: left + dx, top: top + dy, width: C, height: C })
    .png()
    .toBuffer()
  await sharp({ create: { width: C * 2 + 10, height: C, channels: 3, background: '#000' } })
    .composite([
      { input: r, left: 0, top: 0 },
      { input: o, left: C + 10, top: 0 },
    ])
    .png()
    .toFile(outPath(`compare/detail-${k + 1}.png`))
}
console.log(`Wrote ${outPath('compare/')} (diff.png, detail-1..${spots.length}.png: reference left, ours right)`)

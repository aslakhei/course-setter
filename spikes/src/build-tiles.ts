// Prototype: render a map once at the finest editor resolution, cut a 256 px tile pyramid in the
// map frame (ground metres, y up), compare tile encodings, and write PMTiles archives.
// Usage:
//   pnpm --dir spikes build-tiles maps/<map>.ocd [--paper-mm-per-px 0.05]
//   pnpm --dir spikes build-tiles maps/<map>.pdf --scale 15000 [--paper-mm-per-px 0.05]
import { readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { parseArgs } from 'node:util'
import * as mupdf from 'mupdf'
import { PMTiles, type Source } from 'pmtiles'
import sharp, { type Sharp } from 'sharp'
import { TileType, writePmtiles, type Tile } from './lib/pmtiles-writer.ts'
import { MM_PER_INCH, OCAD_UNITS_PER_MM, outPath, PT_PER_MM, writeOut } from './lib/util.ts'
import { ocadSvg, rasterise } from './render-ocad.ts'

const TILE = 256
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { scale: { type: 'string' }, 'paper-mm-per-px': { type: 'string', default: '0.05' } },
})
const file = positionals[0]
if (!file) {
  console.error('Usage: build-tiles <map.ocd|map.pdf> [--scale N] [--paper-mm-per-px 0.05]')
  process.exit(1)
}
const mmPerPx = Number(values['paper-mm-per-px'])
const dpi = MM_PER_INCH / mmPerPx
const name = basename(file, extname(file))

/** Raw RGB image of the whole map plus its placement in the map frame. */
type Source0 = { rgb: Buffer; w: number; h: number; scale: number; originM: [number, number]; widthM: number; extra: object }

async function renderSource(): Promise<Source0> {
  if (extname(file).toLowerCase() === '.ocd') {
    const map = await ocadSvg(file)
    const crs = map.ocad.getCrs()
    const { image } = rasterise(map.svg, map.widthMm, dpi)
    const rgb = await sharp(image.pixels, { raw: { width: image.width, height: image.height, channels: 4 } }).removeAlpha().raw().toBuffer()
    const m = (ocadUnits: number) => (ocadUnits / OCAD_UNITS_PER_MM / 1000) * crs.scale
    const [x0, , x1, y1] = map.bounds
    // Boulders (ISOM 204, black dot) as known points to check the tile-grid maths.
    const objects = map.ocad.objects as unknown as Array<{ sym: number; coordinates: number[][] }>
    const boulders = objects.filter(o => o.sym === 204000)
    const testPoints = Array.from({ length: Math.min(40, boulders.length) }, (_, i) => boulders[Math.floor((i * boulders.length) / 40)]).map(o => [
      m(o.coordinates[0][0]),
      m(o.coordinates[0][1]),
    ])
    return {
      rgb,
      w: image.width,
      h: image.height,
      scale: crs.scale,
      originM: [m(x0), m(y1)], // top-left corner in the map frame
      widthM: m(x1 - x0),
      extra: {
        crs: { epsg: crs.code, easting: crs.easting, northing: crs.northing, grivationDeg: (crs.grivation * 180) / Math.PI },
        testPoints,
      },
    }
  }
  const scale = Number(values.scale)
  if (!scale) throw new Error('PDF maps need --scale (the admin confirms it in the app)')
  const doc = mupdf.Document.openDocument(readFileSync(file), 'application/pdf')
  const page = doc.loadPage(0)
  const [x0, y0, x1, y1] = page.getBounds()
  const pix = page.toPixmap(mupdf.Matrix.scale(dpi / 72, dpi / 72), mupdf.ColorSpace.DeviceRGB, false, true)
  const widthMm = (x1 - x0) / PT_PER_MM
  const heightMm = (y1 - y0) / PT_PER_MM
  // Map frame for a PDF: origin at the page's bottom-left corner.
  return {
    rgb: Buffer.from(pix.getPixels()),
    w: pix.getWidth(),
    h: pix.getHeight(),
    scale,
    originM: [0, (heightMm / 1000) * scale],
    widthM: (widthMm / 1000) * scale,
    extra: {},
  }
}

let t0 = performance.now()
const src = await renderSource()
const renderMs = performance.now() - t0
const resM = src.widthM / src.w // ground metres per pixel at the finest level (from the actual pixel width)
const maxZ = Math.max(0, Math.ceil(Math.log2(Math.max(src.w, src.h) / TILE)))
console.log(`=== ${basename(file)} ===`)
console.log(`finest level: ${src.w} x ${src.h} px, ${mmPerPx} mm paper/px (${dpi.toFixed(0)} dpi), ${resM.toFixed(4)} m/px, rendered in ${(renderMs / 1000).toFixed(1)} s`)

// --- Cut tiles per level --------------------------------------------------------------
type RawTile = { z: number; x: number; y: number; rgb: Buffer }
const raw: RawTile[] = []
let level = { rgb: src.rgb, w: src.w, h: src.h }
let skippedWhite = 0
t0 = performance.now()
for (let z = maxZ; z >= 0; z--) {
  const nx = Math.ceil(level.w / TILE)
  const ny = Math.ceil(level.h / TILE)
  for (let ty = 0; ty < ny; ty++)
    for (let tx = 0; tx < nx; tx++) {
      const buf = Buffer.alloc(TILE * TILE * 3, 255)
      let ink = false
      for (let y = 0; y < TILE; y++) {
        const sy = ty * TILE + y
        if (sy >= level.h) break
        const sx0 = tx * TILE
        const n = Math.min(TILE, level.w - sx0)
        const from = (sy * level.w + sx0) * 3
        level.rgb.copy(buf, y * TILE * 3, from, from + n * 3)
        if (!ink) for (let i = from; i < from + n * 3; i++) if (level.rgb[i] < 250) ((ink = true), (i = Infinity))
      }
      if (ink) raw.push({ z, x: tx, y: ty, rgb: buf })
      else skippedWhite++
    }
  if (z > 0) {
    const w = Math.ceil(level.w / 2)
    const h = Math.ceil(level.h / 2)
    const rgb = await sharp(level.rgb, { raw: { width: level.w, height: level.h, channels: 3 } }).resize(w, h, { kernel: 'lanczos3' }).raw().toBuffer()
    level = { rgb, w, h }
  }
}
const cutMs = performance.now() - t0
console.log(`pyramid: z0..z${maxZ}, ${raw.length} tiles (+${skippedWhite} all-white tiles skipped), cut in ${(cutMs / 1000).toFixed(1)} s`)

// --- Encode in each candidate format ----------------------------------------------------
const formats = {
  // Plain lossy WebP uses 4:2:0 chroma subsampling, which smears alternating colour lines
  // (e.g. blue marsh hatch on yellow turns teal). Kept for reference only.
  'webp-q80': { type: TileType.webp, enc: (s: Sharp) => s.webp({ quality: 80 }) },
  'webp-smart-q90': { type: TileType.webp, enc: (s: Sharp) => s.webp({ quality: 90, smartSubsample: true }) },
  'webp-near-lossless': { type: TileType.webp, enc: (s: Sharp) => s.webp({ nearLossless: true, quality: 60, effort: 5 }) },
  'webp-lossless': { type: TileType.webp, enc: (s: Sharp) => s.webp({ lossless: true, effort: 5 }) },
  'png-palette': { type: TileType.png, enc: (s: Sharp) => s.png({ palette: true, colours: 256, effort: 7 }) },
  'png-lossless': { type: TileType.png, enc: (s: Sharp) => s.png({ compressionLevel: 9 }) },
} as const

const metadata = {
  name,
  source: basename(file),
  scale: src.scale,
  tileSize: TILE,
  paperMmPerPx: mmPerPx,
  minZoom: 0,
  maxZoom: maxZ,
  /** metres per pixel, index = zoom */
  resolutions: Array.from({ length: maxZ + 1 }, (_, z) => resM * 2 ** (maxZ - z)),
  /** top-left corner of tile (z, 0, 0) in the map frame (ground metres, y up) */
  origin: src.originM,
  extent: [src.originM[0], src.originM[1] - src.h * resM, src.originM[0] + src.w * resM, src.originM[1]],
  ...src.extra,
}

const results: Record<string, { bytes: number; ms: number; path: string }> = {}
for (const [fmt, { type, enc }] of Object.entries(formats)) {
  t0 = performance.now()
  const tiles: Tile[] = []
  for (let i = 0; i < raw.length; i += 32) {
    const batch = raw.slice(i, i + 32)
    const encoded = await Promise.all(batch.map(t => enc(sharp(t.rgb, { raw: { width: TILE, height: TILE, channels: 3 } })).toBuffer()))
    batch.forEach((t, k) => tiles.push({ z: t.z, x: t.x, y: t.y, data: encoded[k] }))
  }
  const archive = writePmtiles(tiles, type, { ...metadata, format: fmt }, 0, maxZ)
  const path = writeOut(outPath(`tiles/${name}.${fmt}.pmtiles`), archive)
  results[fmt] = { bytes: archive.length, ms: performance.now() - t0, path }
}

console.log(`source file: ${(statSync(file).size / 1e6).toFixed(1)} MB`)
console.log('format         archive     encode')
for (const [fmt, r] of Object.entries(results)) console.log(`${fmt.padEnd(14)} ${(r.bytes / 1e6).toFixed(1).padStart(6)} MB  ${(r.ms / 1000).toFixed(1).padStart(6)} s`)

// --- Validate: read back with the official reader and compare a few tiles --------------
const fmt0 = 'png-lossless'
const buf = readFileSync(results[fmt0].path)
const fileSource: Source = {
  getKey: () => results[fmt0].path,
  getBytes: async (offset, length) => ({ data: buf.buffer.slice(buf.byteOffset + offset, buf.byteOffset + offset + length) as ArrayBuffer }),
}
const reader = new PMTiles(fileSource)
const header = await reader.getHeader()
const meta = (await reader.getMetadata()) as typeof metadata
let checked = 0
for (const t of [raw[0], raw[Math.floor(raw.length / 2)], raw[raw.length - 1], ...raw.filter(r => r.z === maxZ).slice(0, 20)]) {
  const got = await reader.getZxy(t.z, t.x, t.y)
  if (!got) throw new Error(`tile ${t.z}/${t.x}/${t.y} missing on read-back`)
  const pixels = await sharp(Buffer.from(got.data)).removeAlpha().raw().toBuffer()
  if (!pixels.equals(t.rgb)) throw new Error(`tile ${t.z}/${t.x}/${t.y} differs on read-back`)
  checked++
}
// An in-bounds tile that was skipped (all white) must come back empty.
const stored = new Set(raw.filter(r => r.z === maxZ).map(r => `${r.x},${r.y}`))
const missingX = [...Array(2 ** maxZ).keys()].find(x => !stored.has(`${x},0`))
if (missingX !== undefined && (await reader.getZxy(maxZ, missingX, 0))) throw new Error('skipped tile returned data')

// Known points -> tile pixel with the same maths OpenLayers uses (origin top-left, y down).
const pts = (meta as { testPoints?: number[][] }).testPoints ?? []
if (pts.length) {
  let hits = 0
  const res = meta.resolutions[maxZ]
  for (const [X, Y] of pts) {
    const px = (X - meta.origin[0]) / res
    const py = (meta.origin[1] - Y) / res
    const tx = Math.floor(px / TILE)
    const ty = Math.floor(py / TILE)
    const t = await reader.getZxy(maxZ, tx, ty)
    if (!t) continue
    const pixels = await sharp(Buffer.from(t.data)).removeAlpha().raw().toBuffer()
    const i = (Math.floor(py - ty * TILE) * TILE + Math.floor(px - tx * TILE)) * 3
    if (pixels[i] + pixels[i + 1] + pixels[i + 2] < 3 * 90) hits++
  }
  console.log(`known points: ${hits}/${pts.length} boulder centres land on a black pixel`)
  if (hits < pts.length * 0.9) throw new Error('tile grid maths does not match the map')
}
console.log(`read-back OK: header v${header.specVersion}, z${header.minZoom}-${header.maxZoom}, ${header.numAddressedTiles} tiles, metadata scale 1:${meta.scale}; ${checked} tiles pixel-identical`)

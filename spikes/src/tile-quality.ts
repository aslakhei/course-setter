// Prototype: put the same tile from several PMTiles encodings side by side (3x, nearest neighbour)
// and report PSNR against the lossless PNG.
// Usage: pnpm --dir spikes tile-quality <name> <z> <x> <y>
import { readFileSync } from 'node:fs'
import { PMTiles, type Source } from 'pmtiles'
import sharp, { type OverlayOptions } from 'sharp'
import { outPath } from './lib/util.ts'

const [name, zs, xs, ys] = process.argv.slice(2)
const [z, x, y] = [zs, xs, ys].map(Number)
const fmts = ['png-lossless', 'png-palette', 'webp-lossless', 'webp-near-lossless', 'webp-smart-q90', 'webp-q80']

async function tile(fmt: string) {
  const path = outPath(`tiles/${name}.${fmt}.pmtiles`)
  const buf = readFileSync(path)
  const src: Source = {
    getKey: () => path,
    getBytes: async (o, l) => ({ data: buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + l) as ArrayBuffer }),
  }
  const t = await new PMTiles(src).getZxy(z, x, y)
  if (!t) throw new Error(`no tile ${z}/${x}/${y} in ${fmt}`)
  return sharp(Buffer.from(t.data)).removeAlpha().raw().toBuffer()
}

const ref = await tile(fmts[0])
const parts: OverlayOptions[] = []
for (const [i, fmt] of fmts.entries()) {
  const px = await tile(fmt)
  let se = 0
  for (let k = 0; k < px.length; k++) se += (px[k] - ref[k]) ** 2
  const psnr = 10 * Math.log10(255 ** 2 / (se / px.length || 1e-9))
  console.log(`${fmt.padEnd(13)} PSNR ${i === 0 ? '   ref' : psnr.toFixed(1).padStart(6)} dB`)
  const big = await sharp(px, { raw: { width: 256, height: 256, channels: 3 } })
    .extract({ left: 64, top: 64, width: 128, height: 128 })
    .resize(384, 384, { kernel: 'nearest' })
    .png()
    .toBuffer()
  parts.push({ input: big, left: i * 394, top: 0 })
}
const out = outPath(`compare/tile-quality-${name}-${z}-${x}-${y}.png`)
await sharp({ create: { width: fmts.length * 394 - 10, height: 384, channels: 3, background: '#000' } })
  .composite(parts)
  .png()
  .toFile(out)
console.log(`${fmts.join(' | ')} -> ${out}`)

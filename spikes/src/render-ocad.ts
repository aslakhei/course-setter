// Prototype: render an OCAD map via ocad2geojson -> SVG -> resvg at a given dpi.
// Usage: pnpm --dir spikes render-ocad maps/<file>.ocd [dpi=300]
import { basename } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { DOMImplementation, Element, XMLSerializer } from '@xmldom/xmldom'
import { ocadToSvg, readOcad } from 'ocad2geojson'
import { isMain, mmToPx, OCAD_UNITS_PER_MM, outPath, writeOut } from './lib/util.ts'

// ocad2geojson assigns `node.id = ...` (a browser DOM property). xmldom does not reflect
// that to an attribute, so every <pattern> lost its id and all hatch/structure fills broke.
Object.defineProperty(Element.prototype, 'id', {
  configurable: true,
  get(this: Element) {
    return this.getAttribute('id')
  },
  set(this: Element, value: string) {
    this.setAttribute('id', value)
  },
})

export async function ocadSvg(path: string) {
  const ocad = await readOcad(path, { quietWarnings: true })
  const document = new DOMImplementation().createDocument(null, '', null)
  const t0 = performance.now()
  const svgNode = ocadToSvg(ocad, { document })
  const svg = new XMLSerializer().serializeToString(svgNode as never)
  const svgMs = performance.now() - t0
  const [x0, y0, x1, y1] = ocad.getBounds()
  return {
    ocad,
    svg,
    svgMs,
    /** Map bounds in OCAD paper units (1/100 mm), y up. */
    bounds: [x0, y0, x1, y1] as const,
    widthMm: (x1 - x0) / OCAD_UNITS_PER_MM,
    heightMm: (y1 - y0) / OCAD_UNITS_PER_MM,
  }
}

export function rasterise(svg: string, widthMm: number, dpi: number) {
  const t0 = performance.now()
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: Math.round(mmToPx(widthMm, dpi)) },
    background: 'white',
    font: { loadSystemFonts: true, defaultFontFamily: 'Arial' },
    shapeRendering: 2,
    imageRendering: 0,
  })
  const image = resvg.render()
  return { image, renderMs: performance.now() - t0 }
}

if (isMain(import.meta.url)) {
  const [file, dpiArg] = process.argv.slice(2)
  if (!file) {
    console.error('Usage: render-ocad <file.ocd> [dpi]')
    process.exit(1)
  }
  const dpi = Number(dpiArg ?? 300)
  const r = await ocadSvg(file)
  const name = basename(file, '.ocd')
  writeOut(outPath(`${name}.svg`), r.svg)
  const { image, renderMs } = rasterise(r.svg, r.widthMm, dpi)
  const png = image.asPng()
  const out = writeOut(outPath(`${name}@${dpi}dpi.png`), png)
  console.log(`=== ${basename(file)} ===`)
  console.log(`svg:     ${(r.svg.length / 1e6).toFixed(1)} MB in ${r.svgMs.toFixed(0)} ms`)
  console.log(`extent:  ${r.widthMm.toFixed(1)} x ${r.heightMm.toFixed(1)} mm`)
  console.log(
    `render:  ${image.width} x ${image.height} px at ${dpi} dpi (expected ${mmToPx(r.widthMm, dpi).toFixed(0)} x ${mmToPx(r.heightMm, dpi).toFixed(0)}) in ${renderMs.toFixed(0)} ms`,
  )
  console.log(`png:     ${(png.length / 1e6).toFixed(1)} MB -> ${out}`)
}

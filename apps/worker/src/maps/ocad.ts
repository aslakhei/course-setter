// OCAD maps: ocad2geojson reads the file and builds an SVG (in OCAD paper units, 1/100 mm), resvg
// rasterises any region of it. Checked against OCAD's own PDF export in the rendering spike
// (spikes/FINDINGS.md): scale within 0.02 %.
import { Resvg } from '@resvg/resvg-js'
import { DOMImplementation, type Document, type Element, XMLSerializer, Element as XmlElement } from '@xmldom/xmldom'
import { ocadToSvg, readOcad } from 'ocad2geojson'
import { type Georef, MapError, type MapSource, type Region } from './source.ts'

const OCAD_MARK = 0x0cad
/** Formats ocad2geojson reads; an unknown number would crash it with an unhelpful message. */
const SUPPORTED_VERSIONS = new Set([10, 11, 12, 2018])
const UNITS_PER_MM = 100

// ocad2geojson sets `node.id = …` (a browser DOM property). xmldom does not turn that into an
// attribute, so every <pattern> would lose its id and all hatched and structured areas would vanish.
Object.defineProperty(XmlElement.prototype, 'id', {
  configurable: true,
  get(this: Element) {
    return this.getAttribute('id')
  },
  set(this: Element, value: string) {
    this.setAttribute('id', value)
  },
})

/** Format version from the file header, or a MapError when the file is not an OCAD map we can read. */
export function ocadVersion(file: Buffer): number {
  if (file.length < 8 || file.readUInt16LE(0) !== OCAD_MARK) {
    throw new MapError('not_ocad', 'The file is not an OCAD map.')
  }
  const version = file.readInt16LE(4)
  if (!SUPPORTED_VERSIONS.has(version)) {
    throw new MapError(
      'unsupported_ocad_version',
      `OCAD format version ${version} is not supported. Save the map as OCAD 2018 or OCAD 12 and upload it again.`,
    )
  }
  return version
}

type OcadColour = { rgb: string } | undefined
type ColourDef = Record<string, string | undefined>

export async function loadOcad(file: Buffer): Promise<MapSource> {
  const version = ocadVersion(file)
  let ocad: Awaited<ReturnType<typeof readOcad>>
  try {
    ocad = await readOcad(file, { quietWarnings: true })
  } catch (err) {
    throw new MapError('unreadable_file', `The OCAD file could not be read: ${(err as Error).message}`)
  }
  if (ocad.objects.length === 0) throw new MapError('empty_map', 'The map has no objects.')

  const crs = ocad.getCrs()
  if (!(crs.scale > 0)) throw new MapError('unreadable_file', 'The OCAD file has no map scale.')
  const [x0, y0, x1, y1] = ocad.getBounds() as [number, number, number, number]
  const ground = (units: number) => (units / UNITS_PER_MM / 1000) * crs.scale

  const document = new DOMImplementation().createDocument(null, '', null)
  const root = ocadToSvg(ocad, { document }) as unknown as Element
  groupOverprint(root, overprintColours(ocad.colors as OcadColour[], (ocad.parameterStrings[9] ?? []) as ColourDef[]), [x0, y0, x1, y1])
  // The root element is serialised once; each render only swaps in its size and viewBox.
  root.removeAttribute('viewBox')
  const svg = new XMLSerializer().serializeToString(root as never)
  const fontFamily = process.platform === 'win32' ? 'Arial' : 'Liberation Sans'

  const georef: Georef | null =
    crs.easting || crs.northing || crs.code
      ? {
          epsg: crs.catalog === 'EPSG' && crs.code ? Number(crs.code) : null,
          easting: crs.easting,
          northing: crs.northing,
          grivationDeg: (crs.grivation * 180) / Math.PI,
          ocadGridId: crs.gridId ?? null,
        }
      : null

  return {
    kind: 'ocad',
    widthMm: (x1 - x0) / UNITS_PER_MM,
    heightMm: (y1 - y0) / UNITS_PER_MM,
    scale: crs.scale,
    origin: [ground(x0), ground(y1)],
    georef,
    ocadVersion: String(version),
    render(region: Region, mmPerPx: number): Buffer {
      const unitsPerPx = mmPerPx * UNITS_PER_MM
      // SVG y runs down from the map's top edge, which ocad2geojson places at y0.
      const viewBox = [x0 + region.x * unitsPerPx, y0 + region.y * unitsPerPx, region.width * unitsPerPx, region.height * unitsPerPx]
      const sized = svg.replace('<svg', `<svg width="${region.width}" height="${region.height}" viewBox="${viewBox.join(' ')}"`)
      const image = new Resvg(sized, {
        fitTo: { mode: 'original' },
        background: 'white',
        font: { loadSystemFonts: true, defaultFontFamily: fontFamily },
        shapeRendering: 2,
      }).render()
      return rgbaToRgb(image.pixels, region.width * region.height)
    },
  }
}

/** rgb() strings of the colours OCAD prints as overprint ("o1" in the colour's parameter string). */
export function overprintColours(colours: OcadColour[], defs: ColourDef[]): Set<string> {
  const out = new Set<string>()
  for (const def of defs) {
    const rgb = colours[Number(def.n)]?.rgb
    if (def.o === '1' && rgb) out.add(rgb)
  }
  return out
}

/**
 * Draw overprint colours with Multiply, as OCAD does (blue marsh hatch over yellow turns green).
 * ocad2geojson sorts the map's elements by colour, so the elements of one overprint colour are a run
 * of siblings: each run goes into one group with `mix-blend-mode: multiply`, one blend per colour
 * instead of one per element.
 *
 * Each group starts with a white rectangle over the whole map (`bounds`, OCAD units). Multiplying
 * by white changes nothing, but it keeps every group inside every rendered region: resvg 2.6.2
 * panics on a blended group that lies entirely outside the region it renders.
 */
export function groupOverprint(root: Element, overprint: Set<string>, bounds?: [number, number, number, number]): void {
  if (overprint.size === 0) return
  const elements = (parent: Element) => Array.from(parent.childNodes).filter((n): n is Element => n.nodeType === 1)
  const defs = elements(root).find(e => e.tagName === 'defs')
  const content = elements(root).find(e => e.tagName === 'g')
  if (!content) return

  const colourOf = (style: string, prop: 'fill' | 'stroke') => new RegExp(`${prop}:\\s*([^;]+)`).exec(style)?.[1]?.trim()
  const coloursUsed = (e: Element): string[] => {
    const style = e.getAttribute('style') ?? ''
    const found = [colourOf(style, 'fill'), colourOf(style, 'stroke'), e.getAttribute('fill'), e.getAttribute('stroke')]
    return [...found.filter((c): c is string => Boolean(c) && c !== 'none' && c !== 'transparent'), ...elements(e).flatMap(coloursUsed)]
  }
  const overprintPatterns = new Set(
    (defs ? elements(defs) : [])
      .filter(p => {
        const used = coloursUsed(p)
        return used.length > 0 && used.every(c => overprint.has(c))
      })
      .map(p => `url(#${p.getAttribute('id')})`),
  )
  const isOverprint = (e: Element) => {
    const used = coloursUsed(e)
    return used.length > 0 && used.every(c => overprint.has(c) || overprintPatterns.has(c))
  }

  let group: Element | null = null
  for (const child of elements(content)) {
    if (!isOverprint(child)) {
      group = null
      continue
    }
    if (!group) {
      group = (content.ownerDocument as Document).createElementNS('http://www.w3.org/2000/svg', 'g')
      group.setAttribute('style', 'mix-blend-mode: multiply')
      if (bounds) {
        // Content coordinates are y-negated OCAD units (ocad2geojson flips y with the group's transform).
        const [bx0, by0, bx1, by1] = bounds
        const paper = (content.ownerDocument as Document).createElementNS('http://www.w3.org/2000/svg', 'rect')
        for (const [k, v] of Object.entries({ x: bx0, y: -by1, width: bx1 - bx0, height: by1 - by0, fill: 'white' })) {
          paper.setAttribute(k, String(v))
        }
        group.appendChild(paper)
      }
      content.insertBefore(group, child)
    }
    group.appendChild(child)
  }
}

function rgbaToRgb(rgba: Uint8Array, pixels: number): Buffer {
  const rgb = Buffer.allocUnsafe(pixels * 3)
  for (let i = 0, j = 0; i < pixels; i++, j += 4) {
    rgb[i * 3] = rgba[j] as number
    rgb[i * 3 + 1] = rgba[j + 1] as number
    rgb[i * 3 + 2] = rgba[j + 2] as number
  }
  return rgb
}

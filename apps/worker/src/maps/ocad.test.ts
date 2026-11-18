import { Resvg } from '@resvg/resvg-js'
import { DOMParser, type Element } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'
import { groupOverprint, loadOcad, ocadVersion, overprintColours } from './ocad.ts'
import { MapError } from './source.ts'
import { fixture } from './test-helpers.ts'

function header(mark: number, version: number): Buffer {
  const b = Buffer.alloc(64)
  b.writeUInt16LE(mark, 0)
  b.writeInt16LE(version, 4)
  return b
}

describe('ocadVersion', () => {
  it('reads the format version of supported files', () => {
    expect(ocadVersion(fixture('basic-1.ocd'))).toBe(12)
    expect(ocadVersion(header(0x0cad, 2018))).toBe(2018)
  })

  it.each([
    [header(0x0cad, 9), 'unsupported_ocad_version'],
    [header(0x0cad, 2030), 'unsupported_ocad_version'],
    [Buffer.from('%PDF-1.7 not an ocad file'), 'not_ocad'],
    [Buffer.alloc(3), 'not_ocad'],
  ])('rejects %#: %s', (file, code) => {
    expect(() => ocadVersion(file)).toThrow(MapError)
    try {
      ocadVersion(file)
    } catch (err) {
      expect((err as MapError).code).toBe(code)
    }
  })

  it('tells the admin how to fix an unsupported version', () => {
    expect(() => ocadVersion(header(0x0cad, 9))).toThrow(/Save the map as OCAD 2018 or OCAD 12/)
  })
})

describe('loadOcad', () => {
  it('reads scale, size, frame origin and georeferencing', async () => {
    const map = await loadOcad(fixture('basic-1.ocd'))
    expect(map).toMatchObject({ kind: 'ocad', scale: 15000, ocadVersion: '12' })
    expect(map.widthMm).toBeCloseTo(418, 0)
    expect(map.heightMm).toBeCloseTo(227, 0)
    expect(map.georef).toMatchObject({ ocadGridId: expect.any(Number) })
  })

  it('renders the requested region at the requested resolution', async () => {
    const map = await loadOcad(fixture('basic-1.ocd'))
    const rgb = map.render({ x: 0, y: 0, width: 100, height: 60 }, 1)
    expect(rgb.length).toBe(100 * 60 * 3)
  })
})

describe('overprint', () => {
  it('finds the colours flagged as overprint', () => {
    const colours = [{ rgb: 'rgb(0, 0, 0)' }, { rgb: 'rgb(0, 173, 239)' }, { rgb: 'rgb(255, 221, 154)' }]
    const defs = [
      { n: '0', o: '1' },
      { n: '1', o: '1' },
      { n: '2', o: '0' },
    ]
    expect(overprintColours(colours, defs)).toEqual(new Set(['rgb(0, 0, 0)', 'rgb(0, 173, 239)']))
  })

  it('puts each run of overprint elements into one multiply group', () => {
    const blue = 'rgb(0, 173, 239)'
    const svg = new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg">
        <defs><pattern id="marsh"><rect style="fill: ${blue};"/></pattern></defs>
        <g>
          <path style="fill: rgb(255, 221, 154);"/>
          <path style="fill: url(#marsh);"/>
          <path style="stroke: ${blue}; stroke-width: 10;"/>
          <path style="fill: rgb(0, 0, 0);"/>
        </g>
      </svg>`,
      'image/svg+xml',
    )
    const root = svg.documentElement as unknown as Element
    groupOverprint(root, new Set([blue]))
    const content = root.getElementsByTagName('g')[0]
    const children = Array.from(content?.childNodes ?? []).filter(n => n.nodeType === 1) as Element[]
    expect(children.map(c => c.tagName)).toEqual(['path', 'g', 'path'])
    expect(children[1]?.getAttribute('style')).toBe('mix-blend-mode: multiply')
    expect(children[1]?.getElementsByTagName('path').length).toBe(2)
  })

  it('makes blue over yellow green when rendered, as in print', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">
      <rect width="10" height="10" fill="rgb(255, 221, 0)"/>
      <g style="mix-blend-mode: multiply"><rect width="10" height="10" fill="rgb(0, 173, 239)"/></g>
    </svg>`
    const pixels = new Resvg(svg).render().pixels
    // Multiply: (0·255, 173·221, 239·0) / 255 = (0, 150, 0).
    expect([pixels[0], pixels[1], pixels[2]]).toEqual([0, 150, 0])
  })
})

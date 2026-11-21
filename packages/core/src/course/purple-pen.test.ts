// Our course lengths and IOF XML against Purple Pen's, on the club's own event (spikes/maps/, never committed: club
// property), so the test only runs where the files exist. The .ppen file gives control positions in
// map paper mm (as OCAD's paper coordinates, y up) and the course order; Purple Pen's IOF XML 3.0
// export of the same event gives its leg and course lengths.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { courseDataXml } from '../iof/xml.ts'
import { addControl, addCourse, insertCourseControl } from './commands.ts'
import { courseById, type EventDoc, emptyDoc } from './doc.ts'
import { courseLength, legLengths } from './length.ts'

const dir = fileURLToPath(new URL('../../../../spikes/maps/', import.meta.url))
const ppenFile = existsSync(dir) ? readdirSync(dir).find((f: string) => f.endsWith('.ppen')) : undefined
const xmlFile = ppenFile && readdirSync(dir).find((f: string) => f === ppenFile.replace(/\.ppen$/, '.xml'))

const attr = (tag: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1]

/** Our event document from a .ppen file: positions in ground metres = paper mm × scale / 1000. */
function fromPurplePen(xml: string): { doc: EventDoc; courseNames: Map<string, string> } {
  const scale = Number(attr(/<map [^>]*>/.exec(xml)?.[0] ?? '', 'scale'))
  let doc = emptyDoc(scale)
  for (const [, id, kind, body] of xml.matchAll(/<control id="(\d+)" kind="(\w+)">([\s\S]*?)<\/control>/g)) {
    const location = /<location [^>]*\/>/.exec(body ?? '')?.[0] ?? ''
    const position: [number, number] = [(Number(attr(location, 'x')) * scale) / 1000, (Number(attr(location, 'y')) * scale) / 1000]
    const ourKind = kind === 'start' ? 'start' : kind === 'finish' ? 'finish' : kind === 'crossing-point' ? 'crossingPoint' : 'control'
    const code = /<code>(\d+)<\/code>/.exec(body ?? '')?.[1]
    doc = addControl(doc, { id: `c${id}`, kind: ourKind, position, ...(code ? { code: Number(code) } : {}) })
  }
  // Course controls form a linked list: <course-control id control><next course-control/>.
  const links = new Map<string, { control: string; next?: string }>()
  for (const [, id, control, body] of xml.matchAll(/<course-control id="(\d+)" control="(\d+)"(?: \/>|>([\s\S]*?)<\/course-control>)/g)) {
    links.set(id as string, { control: control as string, next: /<next course-control="(\d+)"/.exec(body ?? '')?.[1] })
  }
  const courseNames = new Map<string, string>()
  for (const [, id, body] of xml.matchAll(/<course id="(\d+)"[^>]*>([\s\S]*?)<\/course>/g)) {
    const name = /<name>([^<]*)<\/name>/.exec(body ?? '')?.[1] ?? `Course ${id}`
    const printScale = Number(/print-scale="(\d+)"/.exec(body ?? '')?.[1] ?? scale)
    doc = addCourse(doc, { id: `k${id}`, name, printScale })
    courseNames.set(name, `k${id}`)
    for (let cc = /<first course-control="(\d+)"/.exec(body ?? '')?.[1]; cc; cc = links.get(cc)?.next) {
      doc = insertCourseControl(doc, `k${id}`, `c${links.get(cc)?.control}`)
    }
  }
  return { doc, courseNames }
}

describe.skipIf(!ppenFile || !xmlFile)('lengths against Purple Pen', () => {
  it('match Purple Pen leg by leg and in total', () => {
    const { doc, courseNames } = fromPurplePen(readFileSync(`${dir}${ppenFile}`, 'utf8'))
    const iof = readFileSync(`${dir}${xmlFile}`, 'utf8')
    const courses = [...iof.matchAll(/<Course>([\s\S]*?)<\/Course>/g)].map(([, body]) => ({
      name: /<Name>([^<]*)<\/Name>/.exec(body ?? '')?.[1] ?? '',
      length: Number(/<Length>(\d+)<\/Length>/.exec(body ?? '')?.[1]),
      legs: [...(body ?? '').matchAll(/<LegLength>(\d+)<\/LegLength>/g)].map(m => Number(m[1])),
    }))
    expect(courses.length).toBeGreaterThan(0)
    for (const pp of courses) {
      const course = courseById(doc, courseNames.get(pp.name) ?? '')
      const ours = legLengths(doc, course)
      // Purple Pen states legs in whole metres.
      expect(ours).toHaveLength(pp.legs.length)
      for (const [i, leg] of ours.entries()) expect(Math.abs(leg - (pp.legs[i] ?? 0))).toBeLessThanOrEqual(0.5 + 1e-6)
      // And the course length, which it rounds, within 1 %.
      const total = courseLength(doc, course)
      console.log(`${pp.name}: ours ${total.toFixed(1)} m, Purple Pen ${pp.length} m (legs ${pp.legs.reduce((a, b) => a + b, 0)} m)`)
      expect(Math.abs(total - pp.length) / pp.length).toBeLessThan(0.01)
    }
  })
})

describe.skipIf(!ppenFile || !xmlFile)('IOF XML against Purple Pen', () => {
  it('lists the same controls at the same map positions, and the same courses, stops and legs', () => {
    const { doc } = fromPurplePen(readFileSync(`${dir}${ppenFile}`, 'utf8'))
    const theirs = readFileSync(`${dir}${xmlFile}`, 'utf8')
    const scale = Number(/<Scale>(\d+)<\/Scale>/.exec(theirs)?.[1])
    const extent = { minX: 0, minY: 0, maxX: 1, maxY: 1 }
    const ours = courseDataXml(doc, { eventName: 'test', mapScale: scale, extent }).xml
    const controls = (xml: string) =>
      [...xml.matchAll(/<Control type="(\w+)">\s*<Id>([^<]+)<\/Id>[\s\S]*?<MapPosition x="([^"]+)" y="([^"]+)"/g)].map(m => ({
        type: m[1],
        id: m[2],
        x: Number(m[3]),
        y: Number(m[4]),
      }))
    const theirControls = controls(theirs)
    expect(controls(ours).map(c => c.id)).toEqual(theirControls.map(c => c.id))
    for (const [i, c] of controls(ours).entries()) {
      expect(c.type).toBe(theirControls[i]?.type)
      expect(Math.abs(c.x - (theirControls[i]?.x ?? 0))).toBeLessThanOrEqual(0.01 + 1e-9)
      expect(Math.abs(c.y - (theirControls[i]?.y ?? 0))).toBeLessThanOrEqual(0.01 + 1e-9)
    }
    const stops = (xml: string) =>
      [...xml.matchAll(/<Course>([\s\S]*?)<\/Course>/g)].map(([, body = '']) => ({
        controls: [
          ...body.matchAll(/<CourseControl type="(\w+)"[^>]*>\s*<Control>([^<]+)<\/Control>(?:\s*<MapText>([^<]+)<\/MapText>)?/g),
        ].map(m => `${m[1]} ${m[2]} ${m[3] ?? ''}`),
        legs: [...body.matchAll(/<LegLength>(\d+)<\/LegLength>/g)].map(m => Number(m[1])),
      }))
    const [ourCourses, theirCourses] = [stops(ours), stops(theirs)]
    expect(ourCourses.map(c => c.controls)).toEqual(theirCourses.map(c => c.controls))
    for (const [i, c] of ourCourses.entries()) {
      for (const [j, leg] of c.legs.entries()) expect(Math.abs(leg - (theirCourses[i]?.legs[j] ?? 0))).toBeLessThanOrEqual(1)
    }
  })
})

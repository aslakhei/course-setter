import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateXML } from 'xmllint-wasm'
import { addControl, addCourse, insertCourseControl, updateCourse } from '../course/commands.ts'
import { type EventDoc, emptyDoc } from '../course/doc.ts'
import { courseDataXml } from './xml.ts'

// The official IOF XML 3.0 schema, from a pinned commit of the IOF's repository. It has no licence
// file, so it is not committed: the test downloads it once and checks it is the expected file.
const COMMIT = '34c116ad1d17cffaf541197c261e535e499702db'
const XSD_URL = `https://raw.githubusercontent.com/international-orienteering-federation/datastandard-v3/${COMMIT}/IOF.xsd`
const XSD_SHA256 = '9d00abaea14ba4bedfae910d68a01506c097a57c29b0492c49abb19034ae90a1'

async function iofSchema(): Promise<string> {
  const cached = join(tmpdir(), `IOF-${XSD_SHA256.slice(0, 16)}.xsd`)
  if (existsSync(cached)) return readFileSync(cached, 'utf8')
  const response = await fetch(XSD_URL)
  if (!response.ok) throw new Error(`downloading IOF.xsd: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (hash !== XSD_SHA256) throw new Error(`IOF.xsd is not the pinned file (sha256 ${hash})`)
  writeFileSync(cached, bytes)
  return bytes.toString('utf8')
}

/**
 * At 1:15 000 (1 mm on the map is 15 m): map issue point, start, 31, a crossing point, 32, a marked
 * route and the finish; a short course sharing 32 with a climb; a course with only a start.
 */
function event(): EventDoc {
  let doc = emptyDoc(15000)
  doc = addControl(doc, { id: 'm', kind: 'mapIssue', position: [0, -300] })
  doc = addControl(doc, { id: 's', kind: 'start', position: [0, 0] })
  doc = addControl(doc, { id: 'a', kind: 'control', position: [300, 400] }) // 31
  doc = addControl(doc, { id: 'x', kind: 'crossingPoint', position: [300, 700] })
  doc = addControl(doc, { id: 'b', kind: 'control', position: [300, 1000] }) // 32
  doc = addControl(doc, {
    id: 'r',
    kind: 'markedRoute',
    position: [300, 1100],
    route: [
      [300, 1100],
      [300, 1300],
      [600, 1300],
    ],
  })
  doc = addControl(doc, { id: 'f', kind: 'finish', position: [900, 1300] })
  doc = addCourse(doc, { id: 'L', name: 'Long', printScale: 10000 })
  for (const id of ['m', 's', 'a', 'x', 'b', 'r', 'f']) doc = insertCourseControl(doc, 'L', id)
  doc = addCourse(doc, { id: 'K', name: 'Kort & godt', printScale: 10000 })
  for (const id of ['s', 'b', 'f']) doc = insertCourseControl(doc, 'K', id)
  doc = updateCourse(doc, 'K', { climb: 85 })
  doc = addCourse(doc, { id: 'E', name: 'Empty', printScale: 10000 })
  return insertCourseControl(doc, 'E', 's')
}

const options = {
  eventName: 'Tuesday <training>',
  date: '2026-11-24',
  mapScale: 15000,
  extent: { minX: -1500, minY: -1500, maxX: 3000, maxY: 3000 },
  createTime: new Date('2026-11-21T12:00:00Z'),
}

const all = (xml: string, re: RegExp) => [...xml.matchAll(re)].map(m => m[1] ?? '')
const courses = (xml: string) => all(xml, /<Course>([\s\S]*?)<\/Course>/g)

describe('courseDataXml', () => {
  const validate = async (xml: string) =>
    validateXML({ xml: [{ fileName: 'courses.xml', contents: xml }], schema: [{ fileName: 'IOF.xsd', contents: await iofSchema() }] })

  it('validates against the official IOF XML 3.0 schema', { timeout: 60_000 }, async () => {
    const result = await validate(courseDataXml(event(), options).xml)
    expect(result.errors.map(e => e.message)).toEqual([])
    expect(result.valid).toBe(true)
    // The check itself works: a course with a single stop is refused.
    const one = courseDataXml(event(), options).xml.replace(/(<Course>[\s\S]*?<\/CourseControl>)[\s\S]*?(<\/Course>)/, '$1\n$2')
    expect((await validate(one)).valid).toBe(false)
  })

  it('names the event and the map, with its corners in mm on the map', () => {
    const { xml } = courseDataXml(event(), options)
    expect(xml).toContain('<Name>Tuesday &lt;training&gt;</Name>')
    expect(xml).toContain('<Date>2026-11-24</Date>')
    expect(xml).toContain('<Scale>15000</Scale>')
    expect(xml).toContain('<MapPositionTopLeft x="-100" y="200" />')
    expect(xml).toContain('<MapPositionBottomRight x="200" y="-100" />')
  })

  it('lists start, controls by code, crossing points and finish, at their map position in mm', () => {
    const { xml } = courseDataXml(event(), options)
    expect(all(xml, /<Control type="(\w+)">/g)).toEqual(['Start', 'Control', 'Control', 'CrossingPoint', 'Finish'])
    expect(all(xml, /<Id>([^<]+)<\/Id>/g)).toEqual(['STA1', '31', '32', 'CP1', 'FIN1'])
    // 31 at 300 m, 400 m: 20 mm, 26.67 mm at 1:15 000.
    expect(xml).toMatch(/<Id>31<\/Id>\s*<MapPosition x="20" y="26.67" \/>/)
    // The map issue point and the marked route are not controls.
    expect(xml).not.toMatch(/<Control type="(MapIssue|EndOfMarkedRoute)"/)
  })

  it('gives each course its stops, control numbers and leg lengths', () => {
    const [long = ''] = courses(courseDataXml(event(), options).xml)
    expect(long).toContain('<Name>Long</Name>')
    expect(all(long, /<CourseControl type="(\w+)"/g)).toEqual(['Start', 'Control', 'CrossingPoint', 'Control', 'Finish'])
    expect(all(long, /<Control>([^<]+)<\/Control>/g)).toEqual(['STA1', '31', 'CP1', '32', 'FIN1'])
    expect(all(long, /<MapText>(\d+)<\/MapText>/g)).toEqual(['1', '2'])
    // The finish leg runs 100 m to the marked route, 500 m along it and 300 m on to the finish.
    expect(all(long, /<LegLength>(\d+)<\/LegLength>/g)).toEqual(['500', '300', '300', '900'])
    expect(long).toContain('<CourseControl type="Finish" specialInstruction="TapedRoute" tapedRouteLength="500">')
    // The course length also counts the 300 m from the map issue point to the start.
    expect(long).toContain('<Length>2300</Length>')
    expect(long).not.toContain('<Climb>')
  })

  it('writes the climb, and leaves out a course with fewer than two stops', () => {
    const { xml, skipped } = courseDataXml(event(), options)
    const [, short = ''] = courses(xml)
    expect(short).toContain('<Name>Kort &amp; godt</Name>')
    expect(short).toContain('<Climb>85</Climb>')
    expect(all(short, /<LegLength>(\d+)<\/LegLength>/g)).toEqual(['1044', '671'])
    expect(courses(xml)).toHaveLength(2)
    expect(skipped).toEqual(['Empty'])
  })
})

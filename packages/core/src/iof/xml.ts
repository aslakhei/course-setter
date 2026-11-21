// IOF XML 3.0 course data (a CourseData document), the format Livelox, Purple Pen, OCAD and event
// administration software read courses from. It follows Purple Pen's export: controls with their
// position on the map in mm (the map frame's paper coordinates at the map's scale, y up), courses as
// sequences of start, controls, crossing points and finish with their numbers and leg lengths.
// Real-world positions (lat/lng) are not written yet.
import { type Control, type Course, controlById, type EventDoc } from '../course/doc.ts'
import { courseLength, legPath, pathLength, routeLength } from '../course/length.ts'
import type { Extent } from '../tiles.ts'

export type CourseDataOptions = {
  eventName: string
  /** The event's date, YYYY-MM-DD. */
  date?: string | null
  /** Denominator of the map's scale (positions are in mm on the map, not on the printed course). */
  mapScale: number
  /** The map's extent in the map frame, written as the map's corners. */
  extent: Extent
  createTime?: Date
  creator?: string
}

export type CourseData = {
  xml: string
  /** Courses left out: IOF XML needs at least two stops (a start and a finish, say) on a course. */
  skipped: string[]
}

const IOF_TYPES = { start: 'Start', control: 'Control', crossingPoint: 'CrossingPoint', finish: 'Finish' } as const
type IofKind = keyof typeof IOF_TYPES
const isIof = (kind: Control['kind']): kind is IofKind => kind in IOF_TYPES

const xmlText = (text: string) =>
  text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c)

/** mm with at most two decimals (0.01 mm on the map), as Purple Pen writes them. */
const mm = (v: number) => String(Math.round(v * 100) / 100 + 0)

/**
 * The id of every control in the file: its code for a control, STA1, FIN1, CP1 … for starts, finishes
 * and crossing points (in the order of the event), in the order they are listed.
 */
function controlIds(doc: EventDoc): Map<string, string> {
  const ids = new Map<string, string>()
  const prefixes: [IofKind, string][] = [
    ['start', 'STA'],
    ['control', ''],
    ['crossingPoint', 'CP'],
    ['finish', 'FIN'],
  ]
  for (const [kind, prefix] of prefixes) {
    const controls = doc.controls.filter(c => c.kind === kind)
    if (kind === 'control') controls.sort((a, b) => (a.code ?? 0) - (b.code ?? 0))
    for (const [i, c] of controls.entries()) ids.set(c.id, prefix ? `${prefix}${i + 1}` : String(c.code))
  }
  return ids
}

type Stop = { control: Control; number: number | null; leg: number | null; taped: number }

/**
 * The stops of a course in IOF terms. The map issue point and marked routes are not stops of their own:
 * the way from the map issue point to the start is left out of the legs (it still counts in the course
 * length), and a marked route counts in the leg to the next stop, which is marked as reached by a taped
 * route of that length.
 */
function iofStops(doc: EventDoc, course: Course): Stop[] {
  const stops: Stop[] = []
  let leg = 0
  let taped = 0
  let number = 0
  course.controls.forEach((id, i) => {
    if (i > 0) leg += pathLength(legPath(doc, course, i - 1))
    const control = controlById(doc, id)
    if (control.kind === 'markedRoute') {
      const length = routeLength(doc, id)
      leg += length
      taped += length
    }
    if (!isIof(control.kind)) return
    stops.push({
      control,
      number: control.kind === 'control' ? ++number : null,
      leg: stops.length ? leg : null,
      taped: stops.length ? taped : 0,
    })
    leg = 0
    taped = 0
  })
  return stops
}

/** The event's courses as an IOF XML 3.0 CourseData document. */
export function courseDataXml(doc: EventDoc, options: CourseDataOptions): CourseData {
  const { eventName, date, mapScale, extent, createTime = new Date(), creator = 'Course-setter' } = options
  const toMm = (metres: number) => (metres * 1000) / mapScale
  const ids = controlIds(doc)
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<CourseData xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0" createTime="${createTime.toISOString()}" creator="${xmlText(creator)}">`,
    '  <Event>',
    `    <Name>${xmlText(eventName)}</Name>`,
    ...(date ? ['    <StartTime>', `      <Date>${date}</Date>`, '    </StartTime>'] : []),
    '  </Event>',
    '  <RaceCourseData>',
    '    <Map>',
    `      <Scale>${mapScale}</Scale>`,
    `      <MapPositionTopLeft x="${mm(toMm(extent.minX))}" y="${mm(toMm(extent.maxY))}" />`,
    `      <MapPositionBottomRight x="${mm(toMm(extent.maxX))}" y="${mm(toMm(extent.minY))}" />`,
    '    </Map>',
  ]

  const listed = [...ids.keys()].map(id => controlById(doc, id))
  for (const control of listed) {
    const [x, y] = control.position
    lines.push(
      `    <Control type="${IOF_TYPES[control.kind as IofKind]}">`,
      `      <Id>${ids.get(control.id)}</Id>`,
      `      <MapPosition x="${mm(toMm(x))}" y="${mm(toMm(y))}" />`,
      '    </Control>',
    )
  }

  const skipped: string[] = []
  for (const course of doc.courses) {
    const stops = iofStops(doc, course)
    if (stops.length < 2) {
      skipped.push(course.name)
      continue
    }
    lines.push(
      '    <Course>',
      `      <Name>${xmlText(course.name)}</Name>`,
      `      <Length>${Math.round(courseLength(doc, course))}</Length>`,
    )
    if (course.climb != null) lines.push(`      <Climb>${course.climb}</Climb>`)
    for (const stop of stops) {
      const taped = stop.taped > 0 ? ` specialInstruction="TapedRoute" tapedRouteLength="${Math.round(stop.taped)}"` : ''
      lines.push(
        `      <CourseControl type="${IOF_TYPES[stop.control.kind as IofKind]}"${taped}>`,
        `        <Control>${ids.get(stop.control.id)}</Control>`,
      )
      if (stop.number !== null) lines.push(`        <MapText>${stop.number}</MapText>`)
      if (stop.leg !== null) lines.push(`        <LegLength>${Math.round(stop.leg)}</LegLength>`)
      lines.push('      </CourseControl>')
    }
    lines.push('    </Course>')
  }
  lines.push('  </RaceCourseData>', '</CourseData>', '')
  return { xml: lines.join('\n'), skipped }
}

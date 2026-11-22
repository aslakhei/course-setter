// A course's print layout on its page: the event's shared layout with the course's changes (or the
// course's own layout), fields filled in for the course, each element placed by its anchor and drawn as
// primitives in page mm (y up), and the map area that is left for the map.

import { ALL_CONTROLS, type Course, controlById, courseById, type EventDoc, type Point, type PrintSettings } from '../course/doc.ts'
import { courseLength } from '../course/length.ts'
import type { Bounds, PathCommand, Primitive } from '../render/primitives.ts'
import { layoutText, textPrimitives } from '../text/lines.ts'
import type { PageElementSpec, PrintLayout } from './elements.ts'
import { northArrowDrawing, qrDrawing, roundedRect, scaleBarDrawing, shapeDrawing } from './marks.ts'

/** What fields need besides the event document: the event, its club and the map (absent values print nothing). */
export type PageContext = {
  /** The event's date, YYYY-MM-DD. */
  eventDate?: string | null
  clubName?: string | null
  /** Who set the courses. */
  setter?: string | null
  map?: { name?: string | null; contour?: number | null; mapper?: string | null; year?: number | null }
}

/** Fields a text element can hold, as {name}. */
export const FIELDS = [
  'event',
  'date',
  'course',
  'length',
  'climb',
  'controls',
  'scale',
  'contour',
  'map',
  'mapper',
  'mapYear',
  'club',
  'setter',
] as const
export type Field = (typeof FIELDS)[number]

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

/** "1:10 000" */
export const formatScaleText = (scale: number) => `1:${String(scale).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`

/** Each field's text on a course's page: the event's name is `title`, as on the description sheet. */
export function fieldValues(doc: EventDoc, course: Course, title: string, context: PageContext = {}): Record<Field, string> {
  const all = course.id === ALL_CONTROLS
  const controls = all
    ? doc.controls.filter(c => c.kind === 'control').length
    : course.controls.filter(id => controlById(doc, id).kind === 'control').length
  const date =
    context.eventDate && /^\d{4}-\d{2}-\d{2}$/.test(context.eventDate) ? dateFormat.format(new Date(`${context.eventDate}T00:00:00Z`)) : ''
  const map = context.map ?? {}
  return {
    event: title,
    date,
    course: course.name,
    length: all ? '' : `${(courseLength(doc, course) / 1000).toFixed(1)} km`,
    climb: course.climb == null ? '' : `${course.climb} m`,
    controls: String(controls),
    scale: formatScaleText(course.printScale),
    contour: map.contour == null ? '' : `${map.contour} m`,
    map: map.name ?? '',
    mapper: map.mapper ?? '',
    mapYear: map.year == null ? '' : String(map.year),
    club: context.clubName ?? '',
    setter: context.setter ?? '',
  }
}

/** The text with each known {field} replaced; unknown braces stay as they are. */
export function fillFields(text: string, values: Record<Field, string>): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.hasOwn(values, name) ? values[name as Field] : whole))
}

/**
 * The layout a course prints with: its own, or the event's shared one with the course's changes to single
 * elements (moved, resized, hidden). `settings` are the course's print settings (absent: none of its own).
 */
export function layoutFor(doc: EventDoc, settings: PrintSettings | undefined): PrintLayout {
  if (settings?.ownLayout) return settings.ownLayout
  const shared = doc.printLayout ?? { elements: [] }
  const overrides = settings?.overrides ?? {}
  return {
    ...shared,
    elements: shared.elements.flatMap(e => {
      const o = overrides[e.id]
      if (!o) return [e]
      if (o.hidden) return []
      return [{ ...e, ...(o.offset ? { offset: o.offset } : {}), ...(o.size ? { size: o.size } : {}) }]
    }),
  }
}

/** The images (asset ids) the layouts of these courses show, each once: what an export of them needs. */
export function layoutAssetIds(doc: EventDoc, courseIds: string[]): string[] {
  const ids = new Set<string>()
  for (const id of courseIds) for (const e of layoutFor(doc, courseById(doc, id).print).elements) if (e.kind === 'image') ids.add(e.asset)
  return [...ids]
}

/** An element on the page: its box (page mm, y up) and what it draws, a white backing box first. */
export type PlacedElement = { id: string; kind: PageElementSpec['kind']; box: Bounds; primitives: Primitive[]; locked: boolean }

/** Where an element of this width and height lies on a page of `size`, by its anchor, offset and stretch. */
export function elementBox(spec: PageElementSpec, size: Point, width: number, height: number): Bounds {
  const [pageW, pageH] = size
  const [dx, dy] = spec.offset
  const h = spec.anchor.endsWith('l') ? 'left' : spec.anchor.endsWith('r') ? 'right' : 'middle'
  const v = spec.anchor.startsWith('t') ? 'top' : spec.anchor.startsWith('b') ? 'bottom' : 'middle'
  const left = spec.stretch ? spec.stretch[0] : h === 'left' ? dx : h === 'right' ? pageW - dx - width : (pageW - width) / 2 + dx
  // From the top edge, y down; the box is returned y up.
  const top = v === 'top' ? dy : v === 'bottom' ? pageH - dy - height : (pageH - height) / 2 + dy
  return { minX: left, maxX: left + width, minY: pageH - top - height, maxY: pageH - top }
}

/** The element's width: the page between its stretch insets, or its own. */
const widthOf = (spec: PageElementSpec, size: Point) =>
  spec.stretch ? Math.max(0.5, size[0] - spec.stretch[0] - spec.stretch[1]) : spec.size[0]

function drawElement(spec: PageElementSpec, box: Bounds, values: Record<Field, string>, printScale: number): Primitive[] {
  const owner = spec.id
  switch (spec.kind) {
    case 'text':
      return textPrimitives(
        {
          text: fillFields(spec.text, values),
          font: spec.font,
          sizePt: spec.sizePt,
          width: box.maxX - box.minX,
          ...(spec.align ? { align: spec.align } : {}),
          ...(spec.lineHeight ? { lineHeight: spec.lineHeight } : {}),
        },
        [box.minX, box.maxY],
        { color: spec.color },
      ).map(p => ({ ...p, owner }))
    case 'image':
      return [{ type: 'image', role: 'layout', owner, box, asset: spec.asset }]
    case 'shape':
      return shapeDrawing(box, spec, owner)
    case 'northArrow':
      return northArrowDrawing(box, spec.style, spec.color, owner)
    case 'scaleBar':
      return scaleBarDrawing(box, printScale, spec.color, owner)
    case 'qr':
      return qrDrawing(box, spec.url, spec.color, owner)
  }
}

export type ComposedLayout = {
  elements: PlacedElement[]
  /** What is left for the map: the area inside the margin, less the bands that keep the map clear of them. */
  mapArea: Bounds
  /** The map area's outline (rounded when the layout says so), to clip the map and the course to. */
  mapClip: PathCommand[]
}

/**
 * The layout on a course's page of `size` mm with a white `margin`: every element placed and drawn, and
 * the map area that is left. Elements that keep the map clear (`pushMap`) end the map area at their edge:
 * at the bottom of one in the upper half of the page, at the top of one in the lower half.
 */
export function composeLayout(
  doc: EventDoc,
  course: Course,
  title: string,
  settings: PrintSettings,
  size: Point,
  context: PageContext = {},
): ComposedLayout {
  const layout = layoutFor(doc, settings)
  const values = fieldValues(doc, course, title, context)
  const area: Bounds = { minX: settings.margin, minY: settings.margin, maxX: size[0] - settings.margin, maxY: size[1] - settings.margin }
  const elements = layout.elements
    .filter(spec => !spec.hidden)
    .map((spec): PlacedElement => {
      const width = widthOf(spec, size)
      const height =
        spec.kind === 'text'
          ? layoutText({
              text: fillFields(spec.text, values),
              font: spec.font,
              sizePt: spec.sizePt,
              width,
              ...(spec.lineHeight ? { lineHeight: spec.lineHeight } : {}),
            }).height
          : spec.size[1]
      const box = elementBox(spec, size, width, height)
      const primitives = drawElement(spec, box, values, course.printScale)
      const pad = spec.backing?.padding
      const outer = pad === undefined ? box : { minX: box.minX - pad, minY: box.minY - pad, maxX: box.maxX + pad, maxY: box.maxY + pad }
      if (pad !== undefined)
        primitives.unshift({
          type: 'path',
          role: 'layout',
          owner: spec.id,
          commands: roundedRect(outer),
          lineWidth: 0,
          filled: true,
          color: '#ffffff',
        })
      if (spec.pushMap) {
        if ((outer.minY + outer.maxY) / 2 > size[1] / 2) area.maxY = Math.min(area.maxY, outer.minY)
        else area.minY = Math.max(area.minY, outer.maxY)
      }
      return { id: spec.id, kind: spec.kind, box, primitives, locked: spec.locked === true }
    })
  if (area.maxY < area.minY) area.maxY = area.minY
  return { elements, mapArea: area, mapClip: roundedRect(area, layout.mapArea?.radius ?? 0) }
}

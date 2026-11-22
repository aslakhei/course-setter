// Editing commands for print layouts: pure functions from a document to a new one, as the course
// commands are, so the editor's undo/redo covers layout changes too. A course uses either the event's
// shared layout (with its overrides: moved, resized or hidden elements) or a layout of its own; these
// commands change the layout the course uses. Invalid results throw CourseError('invalid_layout').
import { setPrintSettings } from '../course/commands.ts'
import { type Course, CourseError, courseById, type EventDoc, type Point, type PrintSettings } from '../course/doc.ts'
import type { FontId } from '../text/fonts.ts'
import { layoutFor } from './compose.ts'
import { type ElementOverrides, type PageElementSpec, type PrintLayout, printLayoutSchema, type WhiteArea } from './elements.ts'

/** Whether a course prints with a layout of its own (else the event's shared one). */
export const hasOwnLayout = (settings: PrintSettings | undefined): boolean => Boolean(settings?.ownLayout)

function checked(layout: PrintLayout): PrintLayout {
  const result = printLayoutSchema.safeParse(layout)
  if (!result.success) throw new CourseError('invalid_layout', result.error.issues[0]?.message ?? 'Invalid print layout')
  return result.data
}

/**
 * The document with the layout `course` prints with changed: its own (in its print settings, which
 * `settings` gives as it prints now), or else the event's shared one.
 */
function withLayout(doc: EventDoc, course: Course, settings: PrintSettings, change: (layout: PrintLayout) => PrintLayout): EventDoc {
  if (settings.ownLayout) return setPrintSettings(doc, course.id, { ...settings, ownLayout: checked(change(settings.ownLayout)) })
  return { ...doc, printLayout: checked(change(doc.printLayout ?? { elements: [] })) }
}

function elementIn(layout: PrintLayout, id: string): PageElementSpec {
  const found = layout.elements.find(e => e.id === id)
  if (!found) throw new CourseError('invalid_layout', `No layout element ${id}`)
  return found
}

/** Add an element on top of the layout the course uses. */
export function addLayoutElement(doc: EventDoc, courseId: string, settings: PrintSettings, element: PageElementSpec): EventDoc {
  return withLayout(doc, courseById(doc, courseId), settings, l => ({ ...l, elements: [...l.elements, element] }))
}

/**
 * Change an element of the layout the course uses (in the shared layout: for every course; a course's
 * own changes of position and size stay as they are).
 */
export function updateLayoutElement(
  doc: EventDoc,
  courseId: string,
  settings: PrintSettings,
  id: string,
  change: (element: PageElementSpec) => PageElementSpec,
): EventDoc {
  return withLayout(doc, courseById(doc, courseId), settings, l => {
    elementIn(l, id)
    return { ...l, elements: l.elements.map(e => (e.id === id ? change(e) : e)) }
  })
}

/** Remove an element; from the shared layout, every course's overrides of it go too. */
export function removeLayoutElement(doc: EventDoc, courseId: string, settings: PrintSettings, id: string): EventDoc {
  const removed = withLayout(doc, courseById(doc, courseId), settings, l => {
    elementIn(l, id)
    return { ...l, elements: l.elements.filter(e => e.id !== id) }
  })
  return settings.ownLayout ? removed : withoutOverrides(removed, id)
}

/** The document without any course's overrides of `id` (the all-controls page's too). */
function withoutOverrides(removed: EventDoc, id: string): EventDoc {
  const without = (print: PrintSettings | undefined): PrintSettings | undefined => {
    if (!print?.overrides || !(id in print.overrides)) return print
    const { [id]: _gone, ...rest } = print.overrides
    const { overrides: _old, ...bare } = print
    return Object.keys(rest).length ? { ...bare, overrides: rest } : bare
  }
  const courses = removed.courses.map(c => {
    const print = without(c.print)
    if (print === c.print) return c
    const { print: _old, ...bare } = c
    return print ? { ...bare, print } : bare
  })
  const allPrint = without(removed.allControls?.print)
  const allControls =
    removed.allControls && allPrint !== removed.allControls.print
      ? (({ print: _old, ...bare }) => (allPrint ? { ...bare, print: allPrint } : bare))(removed.allControls)
      : removed.allControls
  return { ...removed, courses, ...(allControls ? { allControls } : {}) }
}

/** A copy of an element just above it, 5 mm right and down, with id `newId`. */
export function duplicateLayoutElement(doc: EventDoc, courseId: string, settings: PrintSettings, id: string, newId: string): EventDoc {
  return withLayout(doc, courseById(doc, courseId), settings, l => {
    const original = elementIn(l, id)
    const copy = moveSpec({ ...original, id: newId, locked: false }, [5, -5])
    const at = l.elements.indexOf(original)
    return { ...l, elements: [...l.elements.slice(0, at + 1), copy, ...l.elements.slice(at + 1)] }
  })
}

/** Move an element to `index` in the drawing order (0: at the bottom). */
export function reorderLayoutElement(doc: EventDoc, courseId: string, settings: PrintSettings, id: string, index: number): EventDoc {
  return withLayout(doc, courseById(doc, courseId), settings, l => {
    const element = elementIn(l, id)
    const rest = l.elements.filter(e => e !== element)
    const at = Math.max(0, Math.min(rest.length, index))
    return { ...l, elements: [...rest.slice(0, at), element, ...rest.slice(at)] }
  })
}

/** Round the map area's corners (0: square), in the layout the course uses. */
export function setMapAreaRadius(doc: EventDoc, courseId: string, settings: PrintSettings, radius: number): EventDoc {
  return withMapArea(doc, courseId, settings, area => {
    const { radius: _old, ...rest } = area
    return radius > 0 ? { ...rest, radius } : rest
  })
}

/** Draw a line round the map area (null: none), in the layout the course uses. */
export function setMapAreaStroke(
  doc: EventDoc,
  courseId: string,
  settings: PrintSettings,
  stroke: { color: string; width: number } | null,
): EventDoc {
  return withMapArea(doc, courseId, settings, area => {
    const { stroke: _old, ...rest } = area
    return stroke ? { ...rest, stroke } : rest
  })
}

/** Set or remove (null or none) the coloured bands round the map area, outermost first. */
export function setMapAreaBands(
  doc: EventDoc,
  courseId: string,
  settings: PrintSettings,
  bands: { color: string; width: number }[] | null,
): EventDoc {
  return withMapArea(doc, courseId, settings, area => {
    const { bands: _old, ...rest } = area
    return bands?.length ? { ...rest, bands } : rest
  })
}

type MapArea = NonNullable<PrintLayout['mapArea']>
function withMapArea(doc: EventDoc, courseId: string, settings: PrintSettings, change: (area: MapArea) => MapArea): EventDoc {
  return withLayout(doc, courseById(doc, courseId), settings, l => {
    const { mapArea: old, ...rest } = l
    const next = change(old ?? {})
    return Object.keys(next).length ? { ...rest, mapArea: next } : rest
  })
}

export type ElementOverride = ElementOverrides[string]

/**
 * This course's own position, size or visibility for an element of the shared layout (null: as in the
 * shared layout again). `settings` are what the course prints with now.
 */
export function setElementOverride(
  doc: EventDoc,
  courseId: string,
  settings: PrintSettings,
  id: string,
  override: ElementOverride | null,
): EventDoc {
  if (settings.ownLayout) throw new CourseError('invalid_layout', 'A course with a layout of its own has no overrides')
  const shared = doc.printLayout ?? { elements: [] }
  if (!shared.whiteAreas?.some(a => a.id === id)) elementIn(shared, id)
  const { [id]: _old, ...rest } = settings.overrides ?? {}
  const kept = override && Object.keys(override).length ? { ...rest, [id]: override } : rest
  const { overrides: _gone, ...bare } = settings
  return setPrintSettings(doc, courseId, Object.keys(kept).length ? { ...bare, overrides: kept } : bare)
}

/** Give the course a layout of its own: a copy of the layout as it prints now (overrides applied). */
export function detachLayout(doc: EventDoc, courseId: string, settings: PrintSettings): EventDoc {
  if (settings.ownLayout) return doc
  const { overrides: _gone, ...bare } = settings
  return setPrintSettings(doc, courseId, { ...bare, ownLayout: checked(layoutFor(doc, settings)) })
}

/** Print the course with the shared layout again, without its own layout or overrides. */
export function reattachLayout(doc: EventDoc, courseId: string, settings: PrintSettings): EventDoc {
  const { overrides: _o, ownLayout: _l, ...bare } = settings
  return setPrintSettings(doc, courseId, bare)
}

/** The anchor's horizontal and vertical part. */
function sides(anchor: PageElementSpec['anchor']) {
  const h = anchor.endsWith('l') ? 'left' : anchor.endsWith('r') ? 'right' : 'middle'
  const v = anchor.startsWith('t') ? 'top' : anchor.startsWith('b') ? 'bottom' : 'middle'
  return { h, v } as const
}

/** The element moved by `delta` mm on the page (x right, y up): its offset changes, its anchor stays. */
export function moveSpec<T extends PageElementSpec>(spec: T, [dx, dy]: Point): T {
  const { h, v } = sides(spec.anchor)
  const [ox, oy] = spec.offset
  const offset: Point = [h === 'right' ? ox - dx : ox + dx, v === 'bottom' ? oy + dy : oy - dy]
  const stretch: [number, number] | undefined = spec.stretch
    ? [Math.max(0, spec.stretch[0] + dx), Math.max(0, spec.stretch[1] - dx)]
    : undefined
  return { ...spec, offset, ...(stretch ? { stretch } : {}) }
}

/**
 * The element with its box (page mm, y up) at `box` on a page of `size`, pinned to `anchor` (default:
 * its own): the inverse of elementBox. A band keeps spanning between insets; a text element's height
 * follows its lines, so only its width is taken.
 */
export function specForBox<T extends PageElementSpec>(
  spec: T,
  box: { minX: number; minY: number; maxX: number; maxY: number },
  size: Point,
  anchor = spec.anchor,
): T {
  const [pageW, pageH] = size
  const w = box.maxX - box.minX
  const h = box.maxY - box.minY
  const top = pageH - box.maxY
  const { h: hs, v: vs } = sides(anchor)
  const dx = hs === 'left' ? box.minX : hs === 'right' ? pageW - box.maxX : box.minX - (pageW - w) / 2
  const dy = vs === 'top' ? top : vs === 'bottom' ? box.minY : top - (pageH - h) / 2
  const round = (v: number) => Math.round(v * 100) / 100
  const stretch: [number, number] | undefined = spec.stretch
    ? [round(Math.max(0, box.minX)), round(Math.max(0, pageW - box.maxX))]
    : undefined
  return {
    ...spec,
    anchor,
    offset: [round(dx), round(dy)],
    size: [round(Math.max(0.5, w)), spec.kind === 'text' ? spec.size[1] : round(Math.max(0.5, h))],
    ...(stretch ? { stretch } : {}),
  }
}

/** The kinds of element the editor adds from its palette. */
export type NewElementKind = PageElementSpec['kind']

/**
 * A new element of a kind with sensible defaults, pinned to the page's top-left corner with its top-left
 * at `at` (page mm from the top-left, y down); images need their asset and natural aspect, QR codes
 * their address.
 */
export function newElement(
  kind: NewElementKind,
  id: string,
  at: Point,
  extra: { asset?: string; aspect?: number; url?: string; font?: FontId } = {},
): PageElementSpec {
  const base = { id, anchor: 'tl' as const, offset: at }
  switch (kind) {
    case 'text':
      return { ...base, kind, size: [80, 1], text: 'Text', font: extra.font ?? 'sans-bold', sizePt: 14, color: '#000000' }
    case 'image': {
      if (!extra.asset) throw new CourseError('invalid_layout', 'An image needs its asset')
      const width = 40
      return {
        ...base,
        kind,
        size: [width, Math.round((width / (extra.aspect && extra.aspect > 0 ? extra.aspect : 2)) * 100) / 100],
        asset: extra.asset,
      }
    }
    case 'shape':
      return { ...base, kind, size: [40, 20], shape: 'rect', stroke: { color: '#000000', width: 0.35 } }
    case 'northArrow':
      return { ...base, kind, size: [8, 16], style: 'arrow', color: '#000000' }
    case 'scaleBar':
      return { ...base, kind, size: [50, 8], color: '#000000', backing: { padding: 1.5 } }
    case 'qr':
      if (!extra.url) throw new CourseError('invalid_layout', 'A QR code needs its address')
      return { ...base, kind, size: [20, 20], url: extra.url, color: '#000000', backing: { padding: 1.5 } }
  }
}

function whiteAreaIn(layout: PrintLayout, id: string): WhiteArea {
  const found = layout.whiteAreas?.find(a => a.id === id)
  if (!found) throw new CourseError('invalid_layout', `No white area ${id}`)
  return found
}

/** Add a white area to the layout the course uses. */
export function addWhiteArea(doc: EventDoc, courseId: string, settings: PrintSettings, area: WhiteArea): EventDoc {
  return withLayout(doc, courseById(doc, courseId), settings, l => ({ ...l, whiteAreas: [...(l.whiteAreas ?? []), area] }))
}

/** Change a white area (its points, map or page, lock …) in the layout the course uses. */
export function updateWhiteArea(
  doc: EventDoc,
  courseId: string,
  settings: PrintSettings,
  id: string,
  change: (area: WhiteArea) => WhiteArea,
): EventDoc {
  return withLayout(doc, courseById(doc, courseId), settings, l => {
    whiteAreaIn(l, id)
    return { ...l, whiteAreas: (l.whiteAreas ?? []).map(a => (a.id === id ? change(a) : a)) }
  })
}

/** Remove a white area; from the shared layout, every course's hiding of it goes too. */
export function removeWhiteArea(doc: EventDoc, courseId: string, settings: PrintSettings, id: string): EventDoc {
  const removed = withLayout(doc, courseById(doc, courseId), settings, l => {
    whiteAreaIn(l, id)
    const rest = (l.whiteAreas ?? []).filter(a => a.id !== id)
    const { whiteAreas: _old, ...bare } = l
    return rest.length ? { ...bare, whiteAreas: rest } : bare
  })
  return settings.ownLayout ? removed : withoutOverrides(removed, id)
}

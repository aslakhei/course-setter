// The print view's Layout mode, without React: what an edit of an element does to the document (for
// every course, or only the shown one), new elements from the palette, and how elements are named.
import {
  type Bounds,
  type Course,
  courseById,
  type EventDoc,
  type Field,
  type FontId,
  fillFields,
  layoutFor,
  moveSpec,
  type NewElementKind,
  newElement,
  type PageElementSpec,
  type Point,
  type PrintSettings,
  pagePosition,
  pageSize,
  removeLayoutElement,
  removeWhiteArea,
  setElementOverride,
  specForBox,
  updateLayoutElement,
  updateWhiteArea,
  type WhiteArea,
  type WhiteAreaNode,
} from '@course-setter/core'
import type { TFunction } from 'i18next'

/** A white area being drawn with the pen: on the map or the page, and its points so far. */
export type Pen = { on: 'map' | 'page'; nodes: WhiteAreaNode[] }

/** Whom an edit is for: every course (the shared layout) or only the shown course (its overrides). */
export type AppliesTo = 'all' | 'course'

/** The element as the course sees it (its overrides applied), or undefined. */
export function shownElement(doc: EventDoc, settings: PrintSettings, id: string): PageElementSpec | undefined {
  return layoutFor(doc, settings).elements.find(e => e.id === id)
}

/** The element as the shared layout (or the course's own) has it, before the course's overrides. */
export function baseElement(doc: EventDoc, settings: PrintSettings, id: string): PageElementSpec | undefined {
  return (settings.ownLayout ?? doc.printLayout ?? { elements: [] }).elements.find(e => e.id === id)
}

/**
 * The document with an element's position and size changed to `spec` (as the course sees it). For only
 * this course it becomes the course's override; for every course the shared element changes, and this
 * course's own position and size of it go (so all courses show what was just placed).
 */
export function placeElement(
  doc: EventDoc,
  course: Course,
  settings: PrintSettings,
  appliesTo: AppliesTo,
  spec: PageElementSpec,
): EventDoc {
  const placed = { offset: spec.offset, size: spec.size }
  if (settings.ownLayout || appliesTo === 'all') {
    let next = updateLayoutElement(doc, course.id, settings, spec.id, e => ({
      ...e,
      anchor: spec.anchor,
      ...placed,
      ...(spec.stretch ? { stretch: spec.stretch } : {}),
    }))
    const override = settings.overrides?.[spec.id]
    if (!settings.ownLayout && override && (override.offset || override.size)) {
      const kept = override.hidden ? { hidden: true } : null
      next = setElementOverride(next, course.id, settings, spec.id, kept)
    }
    return next
  }
  // An override keeps the shared element's anchor (and a band's insets): only offset and size differ.
  return setElementOverride(doc, course.id, settings, spec.id, { ...(settings.overrides?.[spec.id] ?? {}), ...placed })
}

/** The element with its box moved to `box` on a page of `size` (keeping its anchor), as the course sees it. */
export const atBox = (spec: PageElementSpec, box: Bounds, size: Point): PageElementSpec => specForBox(spec, box, size)

/** The element nudged by `delta` mm (x right, y up). */
export const nudged = (spec: PageElementSpec, delta: Point): PageElementSpec => moveSpec(spec, delta)

/** Hidden for every course, or only for this one. */
export function setHidden(
  doc: EventDoc,
  course: Course,
  settings: PrintSettings,
  appliesTo: AppliesTo,
  id: string,
  hidden: boolean,
): EventDoc {
  if (settings.ownLayout || appliesTo === 'all') {
    const flip = <T extends { hidden?: boolean }>(e: T): T => {
      const { hidden: _old, ...rest } = e
      return (hidden ? { ...rest, hidden: true } : rest) as T
    }
    return whiteAreaOf(doc, settings, id)
      ? updateWhiteArea(doc, course.id, settings, id, flip)
      : updateLayoutElement(doc, course.id, settings, id, flip)
  }
  const { hidden: _old, ...rest } = settings.overrides?.[id] ?? {}
  return setElementOverride(doc, course.id, settings, id, hidden ? { ...rest, hidden: true } : rest)
}

/** Whether the element is hidden on the shown course's page, and for whom. */
export function hiddenState(doc: EventDoc, settings: PrintSettings, id: string): 'no' | 'all' | 'course' {
  if ((baseElement(doc, settings, id) ?? whiteAreaOf(doc, settings, id))?.hidden) return 'all'
  if (!settings.ownLayout && settings.overrides?.[id]?.hidden) return 'course'
  return 'no'
}

/** Text font families and their regular and bold faces. */
export const FONT_FAMILIES = [
  { family: 'display', regular: 'display', bold: 'display-bold' },
  { family: 'sans', regular: 'sans', bold: 'sans-bold' },
  { family: 'condensed', regular: 'condensed', bold: 'condensed-bold' },
  { family: 'serif', regular: 'serif', bold: 'serif-bold' },
] as const satisfies readonly { family: string; regular: FontId; bold: FontId }[]
export type FontFamily = (typeof FONT_FAMILIES)[number]['family']

export const familyOf = (font: FontId): FontFamily => (font.replace('-bold', '') as FontFamily) ?? 'sans'
export const isBold = (font: FontId): boolean => font.endsWith('-bold')
export function fontFor(family: FontFamily, bold: boolean): FontId {
  const f = FONT_FAMILIES.find(x => x.family === family) ?? FONT_FAMILIES[1]
  return bold ? f.bold : f.regular
}

/** Colours offered first: black, white, the ISOM purple, and colours clubs often use. */
export const SWATCHES = ['#000000', '#ffffff', '#7a1a6c', '#0b62a4', '#2e7d32', '#c8102e', '#f08a24', '#f2c200'] as const

/** A new element from the palette, its top-left 10 mm inside the margin's top-left corner. */
export function paletteElement(kind: NewElementKind, id: string, margin: number, extra: { url?: string } = {}): PageElementSpec {
  return newElement(kind, id, [margin + 10, margin + 10], extra)
}

/**
 * How the Layers list names an element: its text's first line (fields filled in for the shown course),
 * an image's name (from `imageNames`, by asset id), or its kind.
 */
export function layerName(spec: PageElementSpec, t: TFunction, values?: Record<Field, string>, imageNames?: Map<string, string>): string {
  if (spec.kind === 'image') return imageNames?.get(spec.asset) ?? t('layout.kinds.image')
  if (spec.kind === 'text') {
    const line = (values ? fillFields(spec.text, values) : spec.text)
      .split('\n')
      .find(l => l.trim() !== '')
      ?.trim()
    if (line) return line.length > 32 ? `${line.slice(0, 31)}…` : line
  }
  return t(`layout.kinds.${spec.kind}`)
}

/**
 * Where the element is pinned, in words: "7 mm from the left, 5 mm from the top", "centred, 12 mm from
 * the bottom", "across the page, …".
 */
export function pinnedText(spec: PageElementSpec, t: TFunction): string {
  const mm = (v: number) => t('layout.mm', { value: Math.round(v * 10) / 10 })
  const h = spec.anchor.endsWith('l') ? 'left' : spec.anchor.endsWith('r') ? 'right' : 'middle'
  const v = spec.anchor.startsWith('t') ? 'top' : spec.anchor.startsWith('b') ? 'bottom' : 'middle'
  const across = spec.stretch
    ? t('layout.pinned.across', { left: mm(spec.stretch[0]), right: mm(spec.stretch[1]) })
    : h === 'middle'
      ? spec.offset[0] === 0
        ? t('layout.pinned.centredH')
        : t('layout.pinned.fromCentreH', {
            value: mm(Math.abs(spec.offset[0])),
            side: t(spec.offset[0] > 0 ? 'layout.pinned.right' : 'layout.pinned.left'),
          })
      : t('layout.pinned.fromSide', { value: mm(spec.offset[0]), side: t(`layout.pinned.${h}`) })
  const down =
    v === 'middle'
      ? spec.offset[1] === 0
        ? t('layout.pinned.centredV')
        : t('layout.pinned.fromCentreV', {
            value: mm(Math.abs(spec.offset[1])),
            side: t(spec.offset[1] > 0 ? 'layout.pinned.below' : 'layout.pinned.above'),
          })
      : t('layout.pinned.fromSide', { value: mm(spec.offset[1]), side: t(`layout.pinned.${v}`) })
  return `${across}, ${down}`
}

/** The settings the course prints with in `doc` after an edit (a course's first override stores them). */
const settingsIn = (doc: EventDoc, course: Course, before: PrintSettings): PrintSettings => courseById(doc, course.id).print ?? before

/** Several elements placed at once (each as the course sees it), for every course or only this one. */
export function placeMany(
  doc: EventDoc,
  course: Course,
  settings: PrintSettings,
  appliesTo: AppliesTo,
  specs: PageElementSpec[],
): EventDoc {
  return specs.reduce((next, spec) => placeElement(next, course, settingsIn(next, course, settings), appliesTo, spec), doc)
}

/** Several elements removed (for every course), or hidden on this course only. */
export function removeMany(doc: EventDoc, course: Course, settings: PrintSettings, appliesTo: AppliesTo, ids: string[]): EventDoc {
  return ids.reduce((next, id) => {
    const s = settingsIn(next, course, settings)
    return !s.ownLayout && appliesTo === 'course'
      ? setHidden(next, course, s, 'course', id, true)
      : removeLayoutElement(next, course.id, s, id)
  }, doc)
}

/** The selection after a click on `id` (null: nothing), Shift adding or taking away; the map is chosen alone. */
export function nextSelection(selected: string[], id: string | null, additive: boolean, mapLayer: string): string[] {
  if (id === null) return []
  if (!additive || id === mapLayer) return [id]
  const without = selected.filter(s => s !== mapLayer)
  return without.includes(id) ? without.filter(s => s !== id) : [...without, id]
}

/** A white area of the layout the course uses (before its overrides), or undefined. */
export function whiteAreaOf(doc: EventDoc, settings: PrintSettings, id: string): WhiteArea | undefined {
  return (settings.ownLayout ?? doc.printLayout)?.whiteAreas?.find(a => a.id === id)
}

/** The white areas of the layout the course uses (before its overrides), in drawing order. */
export const whiteAreasOf = (doc: EventDoc, settings: PrintSettings): WhiteArea[] =>
  (settings.ownLayout ?? doc.printLayout)?.whiteAreas ?? []

/**
 * Between ground metres and a white area's own coordinates on the shown page: the same for an area on
 * the map; page mm from the top-left corner, y down, for one on the page.
 */
export function areaCoordinates(course: Course, settings: PrintSettings) {
  const height = pageSize(settings.paper, settings.orientation)[1]
  const mPerMm = course.printScale / 1000
  const [ox, oy] = pagePosition(course, settings, [0, 0])
  return {
    toArea: (on: WhiteArea['on'], ground: Point): Point => {
      if (on === 'map') return ground
      const [x, y] = pagePosition(course, settings, ground)
      return [x, height - y]
    },
    fromArea: (on: WhiteArea['on'], p: Point): Point => (on === 'map' ? p : [(p[0] - ox) * mPerMm, (height - p[1] - oy) * mPerMm]),
    /** A move of `delta` page mm (x right, y up) in the area's coordinates. */
    delta: (on: WhiteArea['on'], [dx, dy]: Point): Point => (on === 'map' ? [dx * mPerMm, dy * mPerMm] : [dx, -dy]),
  }
}

/** A white area removed for every course, or hidden on this course only. */
export function removeArea(doc: EventDoc, course: Course, settings: PrintSettings, appliesTo: AppliesTo, id: string): EventDoc {
  return !settings.ownLayout && appliesTo === 'course'
    ? setHidden(doc, course, settings, 'course', id, true)
    : removeWhiteArea(doc, course.id, settings, id)
}

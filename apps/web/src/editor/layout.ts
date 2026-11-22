// The print view's Layout mode, without React: what an edit of an element does to the document (for
// every course, or only the shown one), new elements from the palette, and how elements are named.
import {
  type Bounds,
  type Course,
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
  setElementOverride,
  specForBox,
  updateLayoutElement,
} from '@course-setter/core'
import type { TFunction } from 'i18next'

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
    return updateLayoutElement(doc, course.id, settings, id, e => {
      const { hidden: _old, ...rest } = e
      return hidden ? { ...rest, hidden: true } : rest
    })
  }
  const { hidden: _old, ...rest } = settings.overrides?.[id] ?? {}
  return setElementOverride(doc, course.id, settings, id, hidden ? { ...rest, hidden: true } : rest)
}

/** Whether the element is hidden on the shown course's page, and for whom. */
export function hiddenState(doc: EventDoc, settings: PrintSettings, id: string): 'no' | 'all' | 'course' {
  if (baseElement(doc, settings, id)?.hidden) return 'all'
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

/** How the Layers list names an element: its text's first line (fields filled in for the shown course), or its kind. */
export function layerName(spec: PageElementSpec, t: TFunction, values?: Record<Field, string>): string {
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

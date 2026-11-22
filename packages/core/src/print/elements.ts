// What a print layout is made of: elements placed on the printed page around (and over) the map, such
// as titles with course fields, logos, frames, a north arrow, a scale bar and a QR code. One layout is
// shared by every course of an event; a course can move, resize or hide single elements, or have a
// layout of its own (see print/compose.ts). Stored in the event document; positions in page mm.
import { z } from 'zod'
import { FONT_IDS } from '../text/fonts.ts'

/**
 * The point of the page an element is pinned to: a corner (tl, tr, bl, br), the middle of an edge (t, l,
 * r, b) or the centre (c). The element's own matching point sits there, moved by its offset, so one
 * layout fits A4 and A3 in both orientations.
 */
export const ANCHORS = ['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br'] as const
export type Anchor = (typeof ANCHORS)[number]

export const NORTH_ARROW_STYLES = ['arrow', 'needle'] as const
export const SHAPES = ['rect', 'ellipse', 'line'] as const

const point = z.tuple([z.number().finite(), z.number().finite()])
const size = z.tuple([z.number().min(0.5).max(1000), z.number().min(0.5).max(1000)])
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)

const common = {
  /** Unique within the layout; per-course overrides refer to it. */
  id: z.string().min(1).max(64),
  anchor: z.enum(ANCHORS),
  /**
   * mm from the anchor, inwards from the edges it is pinned to: [from the left or right edge, from the
   * top or bottom edge]. For an anchor in the middle (t, b, c horizontally; l, r, c vertically) it moves
   * the element right or down from there.
   */
  offset: point,
  /** Width and height, mm. A text element is as high as its lines. */
  size,
  /** Spans the page from this far in from the left edge to this far in from the right edge (a band); `size[0]` is not used then. */
  stretch: z.tuple([z.number().min(0).max(500), z.number().min(0).max(500)]).optional(),
  /** Keeps the map clear of the element: the map area ends at its edge (a header or footer band). */
  pushMap: z.boolean().optional(),
  /** A white box behind the element, reaching `padding` mm beyond it. */
  backing: z.object({ padding: z.number().min(0).max(20) }).optional(),
  /** Not moved or resized by accident in the editor. */
  locked: z.boolean().optional(),
  /** Not printed (kept in the layout, e.g. a sponsor row for some events only). */
  hidden: z.boolean().optional(),
}

const text = z.object({
  ...common,
  kind: z.literal('text'),
  /** May hold fields such as {course} or {length}, filled in per course (see FIELDS). */
  text: z.string().max(2000),
  font: z.enum(FONT_IDS),
  sizePt: z.number().min(4).max(200),
  lineHeight: z.number().min(0.8).max(3).optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  color,
})

const image = z.object({
  ...common,
  kind: z.literal('image'),
  /** The uploaded image (logo, sponsor), stretched to fill the element. */
  asset: z.string().min(1).max(200),
})

const shape = z.object({
  ...common,
  kind: z.literal('shape'),
  /** A rectangle (rounded with `radius`), an ellipse, or a line through the middle along the longer side. */
  shape: z.enum(SHAPES),
  radius: z.number().min(0).max(100).optional(),
  stroke: z.object({ color, width: z.number().min(0.05).max(10) }).optional(),
  fill: z.object({ color, opacity: z.number().min(0).max(1) }).optional(),
})

const northArrow = z.object({ ...common, kind: z.literal('northArrow'), style: z.enum(NORTH_ARROW_STYLES), color })

/** A scale bar of a round length that fits the element's width at the course's print scale. */
const scaleBar = z.object({ ...common, kind: z.literal('scaleBar'), color })

/** A QR code of a web address (results, Livelox, the club's page). */
const qr = z.object({ ...common, kind: z.literal('qr'), url: z.url({ protocol: /^https?$/ }).max(500), color })

export const layoutElementSchema = z.discriminatedUnion('kind', [text, image, shape, northArrow, scaleBar, qr])

/**
 * A point of a white area's outline: a corner (no handles) or a curve point, whose handles shape the
 * segments before (`in`) and after it (`out`). Same coordinates as the area's points.
 */
const node = z.object({ at: point, in: point.optional(), out: point.optional() })

/**
 * A white area covering part of the map (a garden, a road that must not be crossed, a part of the map
 * not to show): a closed outline of corners and curves, filled white over the map and under the course.
 */
export const whiteAreaSchema = z.object({
  id: z.string().min(1).max(64),
  /**
   * 'map': points in ground metres in the map frame, so the area stays on the terrain it covers when
   * the page moves; 'page': points in page mm from the page's top-left corner, y down.
   */
  on: z.enum(['map', 'page']),
  nodes: z.array(node).min(3).max(500),
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
})

export const printLayoutSchema = z
  .object({
    /** Bottom to top. */
    elements: z.array(layoutElementSchema).max(100),
    /** White areas, drawn over the map and under the course. */
    whiteAreas: z.array(whiteAreaSchema).max(100).optional(),
    /** The map area's corners rounded with this radius, mm. */
    mapArea: z.object({ radius: z.number().min(0).max(30) }).optional(),
  })
  .superRefine((layout, ctx) => {
    const ids = new Set<string>()
    layout.elements.forEach((e, i) => {
      if (ids.has(e.id)) ctx.addIssue({ code: 'custom', path: ['elements', i, 'id'], message: `duplicate element id ${e.id}` })
      ids.add(e.id)
    })
    layout.whiteAreas?.forEach((a, i) => {
      if (ids.has(a.id)) ctx.addIssue({ code: 'custom', path: ['whiteAreas', i, 'id'], message: `duplicate id ${a.id}` })
      ids.add(a.id)
    })
  })

/** A course's changes to single elements of the shared layout, by element id. */
export const overridesSchema = z.record(
  z.string(),
  z.object({ offset: point.optional(), size: size.optional(), hidden: z.boolean().optional() }),
)

export type PageElementSpec = z.infer<typeof layoutElementSchema>
export type WhiteArea = z.infer<typeof whiteAreaSchema>
export type WhiteAreaNode = WhiteArea['nodes'][number]
export type PrintLayout = z.infer<typeof printLayoutSchema>
export type ElementOverrides = z.infer<typeof overridesSchema>

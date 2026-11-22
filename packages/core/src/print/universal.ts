// The universal templates: built into the app, they take each club's logo and colours (tokens, see
// templates.ts), and some are made for as many colours as the club has (one to three). Every element is
// pinned to a page corner or edge, so each fits A4 and A3 in both orientations.
import type { PageElementSpec, PrintLayout } from './elements.ts'
import { type Branding, clubColours, sponsorToken, TOKENS } from './templates.ts'

export type UniversalTemplateId = 'plain' | 'header' | 'frame' | 'training' | 'competition' | 'stripes' | 'ribbon'
/** A template and its layout for a club with `colours` colours (1–3). */
export type UniversalTemplate = { id: UniversalTemplateId; layout: (colours: number) => PrintLayout }

/** The template's layout for the club: made for as many colours as it has. */
export const universalLayout = (template: UniversalTemplate, branding: Branding): PrintLayout =>
  template.layout(clubColours(branding).length)

const COLOURS = [TOKENS.colour, TOKENS.colour2, TOKENS.colour3] as const
/** Stripes in the club's colours, `widths` (mm) for one, two or three colours. */
const stripes = (colours: number, widths: Record<1 | 2 | 3, number[]>) =>
  (widths[Math.min(3, Math.max(1, colours)) as 1 | 2 | 3] ?? []).map((width, i) => ({ color: COLOURS[i] as string, width }))

const credits = (offset: [number, number]): PageElementSpec => ({
  id: 'credits',
  kind: 'text',
  anchor: 'bl',
  offset,
  size: [120, 1],
  text: 'Scale {scale} · Contour {contour} · {map} {mapYear} {mapper}',
  font: 'sans',
  sizePt: 7,
  color: '#000000',
  backing: { padding: 1 },
})
const scaleBar = (offset: [number, number], width = 40): PageElementSpec => ({
  id: 'scale-bar',
  kind: 'scaleBar',
  anchor: 'br',
  offset,
  size: [width, 7],
  color: '#000000',
  backing: { padding: 1.5 },
})
/** A band in the club colour across the top, keeping the map clear, with the event, course and logo. */
const header = (subtitle: string): PageElementSpec[] => [
  {
    id: 'band',
    kind: 'shape',
    anchor: 'tl',
    offset: [0, 0],
    stretch: [0, 0],
    size: [1, 24],
    pushMap: true,
    shape: 'rect',
    fill: { color: TOKENS.colour, opacity: 1 },
  },
  {
    id: 'title',
    kind: 'text',
    anchor: 'tl',
    offset: [8, 4],
    size: [150, 1],
    text: '{event}',
    font: 'display-bold',
    sizePt: 20,
    color: '#ffffff',
  },
  {
    id: 'subtitle',
    kind: 'text',
    anchor: 'tl',
    offset: [8, 14.5],
    size: [150, 1],
    text: subtitle,
    font: 'display',
    sizePt: 10,
    color: '#ffffff',
  },
  { id: 'logo', kind: 'image', anchor: 'tr', offset: [6, 3], size: [18, 18], asset: TOKENS.logo },
]

export const UNIVERSAL_TEMPLATES: UniversalTemplate[] = [
  {
    id: 'plain',
    layout: () => ({
      elements: [
        {
          id: 'title',
          kind: 'text',
          anchor: 'tl',
          offset: [8, 8],
          size: [110, 1],
          text: '{event}\n{course} · {length}',
          font: 'display-bold',
          sizePt: 14,
          color: '#000000',
          backing: { padding: 1.5 },
        },
        credits([8, 7]),
        scaleBar([8, 7]),
      ],
    }),
  },
  {
    id: 'header',
    layout: () => ({ elements: [...header('{course} · {length} · {date}'), credits([8, 7]), scaleBar([8, 7])] }),
  },
  {
    id: 'frame',
    layout: () => ({
      mapArea: { radius: 6, stroke: { color: TOKENS.colour, width: 1.2 } },
      elements: [
        {
          id: 'map-name',
          kind: 'text',
          anchor: 'tr',
          offset: [9, 9],
          size: [80, 1],
          text: '{map}\n{course} · {length}',
          font: 'display-bold',
          sizePt: 12,
          align: 'right',
          color: TOKENS.colour,
          backing: { padding: 1.5 },
        },
        { id: 'logo', kind: 'image', anchor: 'bl', offset: [9, 9], size: [14, 14], asset: TOKENS.logo },
        scaleBar([9, 9]),
      ],
    }),
  },
  {
    id: 'training',
    layout: () => ({
      elements: [
        {
          id: 'course',
          kind: 'text',
          anchor: 'tl',
          offset: [7, 7],
          size: [70, 1],
          text: '{course} · {length}',
          font: 'sans-bold',
          sizePt: 10,
          color: '#000000',
          backing: { padding: 1 },
        },
        {
          id: 'when',
          kind: 'text',
          anchor: 'bl',
          offset: [7, 7],
          size: [70, 1],
          text: '{date} · {setter}',
          font: 'sans',
          sizePt: 7,
          color: '#000000',
          backing: { padding: 1 },
        },
        scaleBar([7, 7], 30),
      ],
    }),
  },
  {
    id: 'competition',
    layout: () => ({
      mapArea: { stroke: { color: TOKENS.colour, width: 0.8 } },
      elements: [
        ...header('{course} · {length} · {climb}'),
        {
          id: 'footer',
          kind: 'shape',
          anchor: 'bl',
          offset: [0, 0],
          stretch: [0, 0],
          size: [1, 20],
          pushMap: true,
          shape: 'rect',
          fill: { color: '#ffffff', opacity: 1 },
        },
        {
          id: 'credits',
          kind: 'text',
          anchor: 'bl',
          offset: [8, 4],
          size: [70, 1],
          text: 'Scale {scale} · Contour {contour}\n{map} {mapYear} {mapper}',
          font: 'sans',
          sizePt: 7,
          color: '#000000',
        },
        ...[1, 2, 3].map(
          (n): PageElementSpec => ({
            id: `sponsor-${n}`,
            kind: 'image',
            anchor: 'br',
            offset: [8 + (n - 1) * 40, 3],
            size: [36, 14],
            asset: sponsorToken(n),
          }),
        ),
      ],
    }),
  },
  {
    // A frame of stripes round the map in the club's colours, the first the widest.
    id: 'stripes',
    layout: colours => ({
      mapArea: { bands: stripes(colours, { 1: [2.5], 2: [2.2, 1.2], 3: [2, 1, 1] }) },
      elements: [
        {
          id: 'title',
          kind: 'text',
          anchor: 'tl',
          offset: [11, 11],
          size: [110, 1],
          text: '{event}\n{course} · {length}',
          font: 'display-bold',
          sizePt: 14,
          color: TOKENS.colour,
          backing: { padding: 1.5 },
        },
        { id: 'logo', kind: 'image', anchor: 'tr', offset: [11, 11], size: [16, 16], asset: TOKENS.logo },
        credits([11, 11]),
        scaleBar([11, 11]),
      ],
    }),
  },
  {
    // A header band in the club colour with a stripe under it for each other colour, and the same
    // stripes along the foot of the page.
    id: 'ribbon',
    layout: colours => {
      // Stripes running from the top band down, or from the foot of the page up, each keeping the map clear.
      const run = (list: { color: string; width: number }[], anchor: 'tl' | 'bl', from: number, name: string) => {
        let y = from
        return list.map((stripe, i): PageElementSpec => {
          const at = y
          y += stripe.width
          return {
            id: `${name}-${i + 1}`,
            kind: 'shape',
            anchor,
            offset: [0, at],
            stretch: [0, 0],
            size: [1, stripe.width],
            pushMap: true,
            shape: 'rect',
            fill: { color: stripe.color, opacity: 1 },
          }
        })
      }
      const top = stripes(colours, { 1: [], 2: [0, 2], 3: [0, 2, 2] }).slice(1)
      const foot = stripes(colours, { 1: [3], 2: [3, 1.5], 3: [3, 1.5, 1.5] })
      const footHeight = foot.reduce((sum, stripe) => sum + stripe.width, 0)
      return {
        elements: [
          ...header('{course} · {length} · {date}'),
          ...run(top, 'tl', 24, 'stripe'),
          ...run(foot, 'bl', 0, 'foot'),
          credits([8, footHeight + 4]),
          scaleBar([8, footHeight + 4]),
        ],
      }
    },
  },
]

// The universal templates: built into the app, they take each club's logo and colours (tokens, see
// templates.ts). Every element is pinned to a page corner or edge, so each fits A4 and A3 in both
// orientations.
import type { PageElementSpec, PrintLayout } from './elements.ts'
import { sponsorToken, TOKENS } from './templates.ts'

export type UniversalTemplateId = 'plain' | 'header' | 'frame' | 'training' | 'competition'
export type UniversalTemplate = { id: UniversalTemplateId; layout: PrintLayout }

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
    layout: {
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
    },
  },
  {
    id: 'header',
    layout: { elements: [...header('{course} · {length} · {date}'), credits([8, 7]), scaleBar([8, 7])] },
  },
  {
    id: 'frame',
    layout: {
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
    },
  },
  {
    id: 'training',
    layout: {
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
    },
  },
  {
    id: 'competition',
    layout: {
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
    },
  },
]

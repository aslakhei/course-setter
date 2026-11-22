// Print layout templates: a layout whose colours and images may be club tokens, filled in from the
// club's branding when the template is applied, then copied into the event (so a later change of the
// template or the branding does not change prints already made).
import { setPrintSettings } from '../course/commands.ts'
import type { EventDoc, PrintSettings } from '../course/doc.ts'
import { anchorAxes, type PageElementSpec, type PrintLayout, printLayoutSchema } from './elements.ts'

/** Tokens a template may use where a colour or an image goes. */
export const TOKENS = { logo: '{club.logo}', colour: '{club.colour}', colour2: '{club.colour2}', colour3: '{club.colour3}' } as const
const COLOUR_TOKENS = [TOKENS.colour, TOKENS.colour2, TOKENS.colour3] as const
/** The club's n-th sponsor image (1, 2, …). */
export const sponsorToken = (n: number) => `{club.sponsor.${n}}`

/** What a club's templates are filled in with. */
export type Branding = {
  /** The club logo (asset id), or null. */
  logo: string | null
  colour: string | null
  colour2: string | null
  colour3: string | null
  /** Sponsor images (asset ids), in order. */
  sponsors: string[]
}

/** The colour of clubs that have not chosen theirs: a dark blue. */
export const DEFAULT_COLOUR = '#1d4e89'

export const NO_BRANDING: Branding = { logo: null, colour: null, colour2: null, colour3: null, sponsors: [] }

/**
 * The club's colours in order, the ones it has set (gaps closed up), or the default colour when none:
 * one to three. Universal templates are made for this many (`UNIVERSAL_TEMPLATES`).
 */
export function clubColours(branding: Branding): string[] {
  const set = [branding.colour, branding.colour2, branding.colour3].filter((c): c is string => c !== null)
  return set.length ? set : [DEFAULT_COLOUR]
}

/** What {club.colour}, {club.colour2} and {club.colour3} become: a colour the club lacks is its last one. */
function colourTokens(branding: Branding): Record<string, string> {
  const colours = clubColours(branding)
  return Object.fromEntries(COLOUR_TOKENS.map((token, i) => [token, colours[Math.min(i, colours.length - 1)] as string]))
}

/**
 * The template with its tokens filled in from `branding` and new ids (from `newId`), checked as a print
 * layout. An image whose token has nothing behind it (no logo, fewer sponsors) is left out; a colour the
 * club lacks is its last one (a template for three colours still prints for a club with one).
 */
export function resolveTemplate(template: PrintLayout, branding: Branding, newId: () => string): PrintLayout {
  const colours = colourTokens(branding)
  const filled = JSON.parse(JSON.stringify(template), (_key, value) =>
    typeof value === 'string' && Object.hasOwn(colours, value) ? colours[value] : value,
  ) as PrintLayout
  const asset = (a: string): string | null => {
    if (a === TOKENS.logo) return branding.logo
    const sponsor = /^\{club\.sponsor\.(\d+)\}$/.exec(a)
    return sponsor ? (branding.sponsors[Number(sponsor[1]) - 1] ?? null) : a
  }
  const elements = filled.elements.flatMap((e): PageElementSpec[] => {
    if (e.kind !== 'image') return [{ ...e, id: newId() }]
    const id = asset(e.asset)
    return id ? [{ ...e, id: newId(), asset: id }] : []
  })
  const whiteAreas = filled.whiteAreas?.map(a => ({ ...a, id: newId() }))
  return printLayoutSchema.parse({ ...filled, elements, ...(whiteAreas ? { whiteAreas } : {}) })
}

/** Print settings without the course's changes to the shared layout. */
function withoutOverrides(print: PrintSettings): PrintSettings {
  const { overrides: _gone, ...rest } = print
  return rest
}

/**
 * The event with a (resolved) layout applied: for every course, as the shared layout (courses' changes
 * to the old one go; courses with a layout of their own keep it), or as one course's own layout.
 */
export function applyLayout(doc: EventDoc, layout: PrintLayout, to: 'all' | { courseId: string; settings: PrintSettings }): EventDoc {
  if (to !== 'all') return setPrintSettings(doc, to.courseId, { ...withoutOverrides(to.settings), ownLayout: layout })
  const courses = doc.courses.map(c => (c.print?.overrides ? { ...c, print: withoutOverrides(c.print) } : c))
  const allPrint = doc.allControls?.print
  const allControls = doc.allControls && allPrint?.overrides ? { ...doc.allControls, print: withoutOverrides(allPrint) } : doc.allControls
  return { ...doc, printLayout: layout, courses, ...(allControls ? { allControls } : {}) }
}

/**
 * A layout to save as a template: the club's logo, colours and sponsors in it become tokens, so the
 * template takes the branding of the club it is used in (a personal template in another club, too).
 */
export function tokenizeLayout(layout: PrintLayout, branding: Branding): PrintLayout {
  // The first token with this colour: a club with fewer colours has its last one where the others go.
  const tokens = Object.entries(colourTokens(branding))
  const colour = (c: string) => tokens.find(([, value]) => value.toLowerCase() === c.toLowerCase())?.[0] ?? c
  const recoloured = JSON.parse(JSON.stringify(layout), (key, value) =>
    key === 'color' && typeof value === 'string' ? colour(value) : value,
  ) as PrintLayout
  const asset = (a: string) => {
    if (a === branding.logo) return TOKENS.logo
    const sponsor = branding.sponsors.indexOf(a)
    return sponsor >= 0 ? sponsorToken(sponsor + 1) : a
  }
  return { ...recoloured, elements: recoloured.elements.map(e => (e.kind === 'image' ? { ...e, asset: asset(e.asset) } : e)) }
}

/** A stored template, checked as a layout with tokens; null when it is not one. */
export function parseTemplate(raw: unknown): PrintLayout | null {
  if (!raw || typeof raw !== 'object') return null
  let n = 0
  const anything: Branding = {
    logo: 'logo',
    colour: '#000000',
    colour2: '#000000',
    colour3: '#000000',
    sponsors: Array.from({ length: 100 }, (_, i) => `sponsor-${i}`),
  }
  try {
    resolveTemplate(raw as PrintLayout, anything, () => `check-${++n}`)
    return raw as PrintLayout
  } catch {
    return null
  }
}

/**
 * The layout with each image fitted to its picture's aspect ratio (width / height, from `aspectOf`;
 * null: not known), as large as fits in the box it had and centred in it (an image stretched across
 * the page stays as it is). A template's box is a place for any logo; the logo itself keeps its shape.
 */
export function fitImages(layout: PrintLayout, aspectOf: (asset: string) => number | null): PrintLayout {
  const elements = layout.elements.map((e): PageElementSpec => {
    if (e.kind !== 'image') return e
    const aspect = aspectOf(e.asset)
    // An image stretched across the page has the page's width: it stays as it is.
    if (!aspect || !Number.isFinite(aspect) || aspect <= 0 || e.stretch) return e
    const [w, h] = e.size
    const [fw, fh] = w / h > aspect ? [Math.max(0.5, h * aspect), h] : [w, Math.max(0.5, w / aspect)]
    // Pinned to an edge, it moves in by half of what it lost; an element in the middle stays centred.
    const { h: across, v: down } = anchorAxes(e.anchor)
    const offset: [number, number] = [
      e.offset[0] + (across === 'middle' ? 0 : (w - fw) / 2),
      e.offset[1] + (down === 'middle' ? 0 : (h - fh) / 2),
    ]
    return { ...e, size: [fw, fh], offset }
  })
  return { ...layout, elements }
}

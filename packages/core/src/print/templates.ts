// Print layout templates: a layout whose colours and images may be club tokens, filled in from the
// club's branding when the template is applied, then copied into the event (so a later change of the
// template or the branding does not change prints already made).
import { setPrintSettings } from '../course/commands.ts'
import type { EventDoc, PrintSettings } from '../course/doc.ts'
import { type PageElementSpec, type PrintLayout, printLayoutSchema } from './elements.ts'

/** Tokens a template may use where a colour or an image goes. */
export const TOKENS = { logo: '{club.logo}', colour: '{club.colour}', colour2: '{club.colour2}' } as const
/** The club's n-th sponsor image (1, 2, …). */
export const sponsorToken = (n: number) => `{club.sponsor.${n}}`

/** What a club's templates are filled in with. */
export type Branding = {
  /** The club logo (asset id), or null. */
  logo: string | null
  colour: string | null
  colour2: string | null
  /** Sponsor images (asset ids), in order. */
  sponsors: string[]
}

/** Colours for clubs that have not chosen theirs: a dark blue and a yellow. */
export const DEFAULT_COLOURS = { colour: '#1d4e89', colour2: '#f2c200' } as const

export const NO_BRANDING: Branding = { logo: null, colour: null, colour2: null, sponsors: [] }

/**
 * The template with its tokens filled in from `branding` and new ids (from `newId`), checked as a print
 * layout. An image whose token has nothing behind it (no logo, fewer sponsors) is left out.
 */
export function resolveTemplate(template: PrintLayout, branding: Branding, newId: () => string): PrintLayout {
  const colours: Record<string, string> = {
    [TOKENS.colour]: branding.colour ?? DEFAULT_COLOURS.colour,
    [TOKENS.colour2]: branding.colour2 ?? DEFAULT_COLOURS.colour2,
  }
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

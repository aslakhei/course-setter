// The fixed set of fonts for text on the printed page (titles, notes, fields): free fonts (SIL Open Font
// License) kept in packages/core/fonts, so the browser and the worker use the very same files. Their
// advance widths are in metrics.data.ts, so core breaks text into lines without asking a backend.

export const FONT_IDS = ['sans', 'sans-bold', 'condensed', 'condensed-bold', 'display', 'display-bold', 'serif', 'serif-bold'] as const
export type FontId = (typeof FONT_IDS)[number]

export type FontFile = {
  /** File name in packages/core/fonts. */
  file: string
  /**
   * The family name backends register the file under (Canvas `font`, FontFace). Regular and bold share
   * a family and differ in weight, as in CSS.
   */
  family: string
  weight: 400 | 700
  /** The typeface, for people choosing a font. */
  typeface: string
}

export const FONTS: Record<FontId, FontFile> = {
  sans: { file: 'LiberationSans-Regular.ttf', family: 'CS Sans', weight: 400, typeface: 'Liberation Sans' },
  'sans-bold': { file: 'LiberationSans-Bold.ttf', family: 'CS Sans', weight: 700, typeface: 'Liberation Sans' },
  condensed: { file: 'RobotoCondensed-Regular.ttf', family: 'CS Condensed', weight: 400, typeface: 'Roboto Condensed' },
  'condensed-bold': { file: 'RobotoCondensed-Bold.ttf', family: 'CS Condensed', weight: 700, typeface: 'Roboto Condensed' },
  display: { file: 'Oswald-Regular.ttf', family: 'CS Display', weight: 400, typeface: 'Oswald' },
  'display-bold': { file: 'Oswald-Bold.ttf', family: 'CS Display', weight: 700, typeface: 'Oswald' },
  serif: { file: 'SourceSerif4-Regular.ttf', family: 'CS Serif', weight: 400, typeface: 'Source Serif 4' },
  'serif-bold': { file: 'SourceSerif4-Bold.ttf', family: 'CS Serif', weight: 700, typeface: 'Source Serif 4' },
}

/**
 * Font features turned off wherever the fonts are used (pdf-lib `embedFont(…, { features })`): no
 * kerning and no ligatures, so a line is exactly as wide as the sum of its advance widths, which is
 * what core measures.
 */
export const FONT_FEATURES = { kern: false, liga: false, clig: false, calt: false, dlig: false } as const

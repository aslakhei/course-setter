// What core knows about a font to measure text: vertical metrics and advance widths, read from the font
// files by scripts/font-metrics.ts into metrics.data.ts.

/**
 * The characters core has advance widths for, as inclusive code point ranges: Basic Latin, Latin-1 and
 * Latin Extended-A (Norwegian, Swedish, Danish, German, Finnish, Polish, Czech …) and the usual
 * typographic punctuation. Other characters are measured as the font's missing glyph.
 */
export const CHARACTER_RUNS: readonly (readonly [number, number])[] = [
  [0x20, 0x7e],
  [0xa0, 0x17f],
  [0x2010, 0x2026], // dashes, quotation marks, bullet, ellipsis
  [0x20ac, 0x20ac], // euro
  [0x2212, 0x2212], // minus
]

export type FontMetrics = {
  unitsPerEm: number
  /** Ascender and descender (negative) of the font, in font units (hhea). */
  ascent: number
  descent: number
  capHeight: number
  /** Advance width of the missing glyph, used for characters the font or the table lacks. */
  missing: number
  /** Advance widths per run of CHARACTER_RUNS, null where the font has no glyph. */
  widths: (number | null)[][]
}

/** A character's advance width in font units. */
export function advanceWidth(metrics: FontMetrics, codePoint: number): number {
  for (let i = 0; i < CHARACTER_RUNS.length; i++) {
    const [from, to] = CHARACTER_RUNS[i] as readonly [number, number]
    if (codePoint >= from && codePoint <= to) return metrics.widths[i]?.[codePoint - from] ?? metrics.missing
  }
  return metrics.missing
}

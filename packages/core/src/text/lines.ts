// Measuring text and breaking it into lines, from the fonts' advance widths. Done here, once, so the
// editor and the PDF put the same words on the same lines: the backends only draw finished lines.
import type { Primitive } from '../render/primitives.ts'
import type { Point } from '../similarity.ts'
import type { FontId } from './fonts.ts'
import { METRICS } from './metrics.data.ts'
import { advanceWidth } from './metrics.ts'

export const MM_PER_PT = 25.4 / 72
/** Distance between baselines as a multiple of the font size. */
export const DEFAULT_LINE_HEIGHT = 1.2

/** Width of a line of text in mm, at font size `size` mm (no kerning, no ligatures: see FONT_FEATURES). */
export function textWidth(text: string, font: FontId, size: number): number {
  const metrics = METRICS[font]
  let units = 0
  for (const ch of text) units += advanceWidth(metrics, ch.codePointAt(0) ?? 0)
  return (units * size) / metrics.unitsPerEm
}

/** How far the font reaches above and below the baseline, mm at font size `size` mm (both positive). */
export function fontExtent(font: FontId, size: number): { ascent: number; descent: number } {
  const m = METRICS[font]
  return { ascent: (m.ascent * size) / m.unitsPerEm, descent: (-m.descent * size) / m.unitsPerEm }
}

/** Height of capital letters above the baseline, mm at font size `size` mm. */
export function capHeight(font: FontId, size: number): number {
  const m = METRICS[font]
  return (m.capHeight * size) / m.unitsPerEm
}

/** Slack for widths that equal the line width but come out a hair larger in floating point. */
const EPSILON = 1e-9

/**
 * The lines `text` takes in a box `maxWidth` mm wide at font size `size` mm. A line break in the text
 * starts a new line (an empty line stays empty); otherwise lines break between words, and runs of spaces
 * and tabs count as one space. A word wider than the box is split between characters.
 */
export function breakLines(text: string, font: FontId, size: number, maxWidth = Number.POSITIVE_INFINITY): string[] {
  const fits = (s: string) => textWidth(s, font, size) <= maxWidth + EPSILON
  const lines: string[] = []
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    const words = paragraph.split(/[ \t]+/).filter(w => w !== '')
    let line = ''
    for (let word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (fits(candidate)) {
        line = candidate
        continue
      }
      if (line) lines.push(line)
      // As many characters per line as fit, at least one; the rest starts the next line.
      while ([...word].length > 1 && !fits(word)) {
        const chars = [...word]
        let n = 1
        while (n < chars.length && fits(chars.slice(0, n + 1).join(''))) n++
        lines.push(chars.slice(0, n).join(''))
        word = chars.slice(n).join('')
      }
      line = word
    }
    lines.push(line)
  }
  return lines
}

export type TextAlign = 'left' | 'center' | 'right'

/** A block of text in a box of a given width; its height follows from the lines it takes. */
export type TextBlock = {
  text: string
  font: FontId
  /** Font size in points (as in a word processor). */
  sizePt: number
  /** Box width, mm. */
  width: number
  align?: TextAlign
  /** Distance between baselines as a multiple of the font size; default DEFAULT_LINE_HEIGHT. */
  lineHeight?: number
}

export type TextLayout = {
  /** Each line with its start from the box's left edge and its baseline down from the box's top, mm. */
  lines: { text: string; x: number; baseline: number; width: number }[]
  /** Height of the block, mm: the number of lines times the line height. */
  height: number
}

/**
 * The lines of a text block. As in CSS, each line has the line height and the font's height is centred
 * in it, so a block's height does not depend on the font.
 */
export function layoutText(block: TextBlock): TextLayout {
  const size = block.sizePt * MM_PER_PT
  const step = (block.lineHeight ?? DEFAULT_LINE_HEIGHT) * size
  const { ascent, descent } = fontExtent(block.font, size)
  const first = (step - ascent - descent) / 2 + ascent
  const lines = breakLines(block.text, block.font, size, block.width).map((text, i) => {
    const width = textWidth(text, block.font, size)
    const x = block.align === 'center' ? (block.width - width) / 2 : block.align === 'right' ? block.width - width : 0
    return { text, x, baseline: first + i * step, width }
  })
  return { lines, height: lines.length * step }
}

/**
 * A text block as primitives, with the top-left corner of its box at `topLeft` (page mm, y up), in
 * `color` (#rrggbb; default: the backend's colour).
 */
export function textPrimitives(block: TextBlock, topLeft: Point, paint: { color?: string; opacity?: number } = {}): Primitive[] {
  const size = block.sizePt * MM_PER_PT
  return layoutText(block)
    .lines.filter(line => line.text !== '')
    .map(
      (line): Primitive => ({
        type: 'textLine',
        role: 'layout',
        at: [topLeft[0] + line.x, topLeft[1] - line.baseline],
        text: line.text,
        font: block.font,
        size,
        ...paint,
      }),
    )
}

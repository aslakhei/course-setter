import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { metricsSource } from '../../scripts/font-metrics.ts'
import { setTextLineFont, withoutLigatures } from '../render/canvas.ts'
import { PT_PER_MM } from '../render/pdf.ts'
import { FONT_FEATURES, FONT_IDS, FONTS } from './fonts.ts'
import { breakLines, DEFAULT_LINE_HEIGHT, fontExtent, layoutText, MM_PER_PT, textPrimitives, textWidth } from './lines.ts'
import { METRICS } from './metrics.data.ts'

const fontFile = (file: string) => fileURLToPath(new URL(`../../fonts/${file}`, import.meta.url))

/** Text with ligature pairs (fi, ffl), kerning pairs (AV, To, Wa) and Norwegian letters. */
const SAMPLES = ['Hamar OK – Løype A, 4.2 km', 'office affluent fifty flaws', 'AVATAR To Ty Wa Yo', 'Ærlig Østre Åsen «Ø» 1:10 000']

describe('font metrics', () => {
  it('match the font files (regenerate with node packages/core/scripts/font-metrics.ts)', () => {
    const committed = readFileSync(new URL('./metrics.data.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    expect(committed).toBe(metricsSource())
  })

  it('have the letters of the Nordic languages in every font', () => {
    for (const id of FONT_IDS) {
      for (const ch of 'æøåÆØÅäöÄÖ')
        expect(textWidth(ch, id, 10), `${ch} in ${id}`).not.toBe((METRICS[id].missing * 10) / METRICS[id].unitsPerEm)
    }
  })
})

describe('textWidth', () => {
  it('adds up advance widths at the font size', () => {
    // Liberation Sans digits are 1139 of 2048 units wide.
    expect(textWidth('11', 'sans', 2.048)).toBeCloseTo(2.278, 9)
    expect(textWidth('', 'sans', 5)).toBe(0)
  })

  it('measures characters outside the table as the missing glyph', () => {
    const m = METRICS.serif
    expect(textWidth('漢', 'serif', 1)).toBeCloseTo(m.missing / m.unitsPerEm, 9)
  })

  it('is what pdf-lib measures for fonts embedded without kerning and ligatures', async () => {
    const pdf = await PDFDocument.create()
    pdf.registerFontkit(fontkit)
    for (const id of FONT_IDS) {
      const font = await pdf.embedFont(readFileSync(fontFile(FONTS[id].file)), { subset: true, features: FONT_FEATURES })
      for (const text of SAMPLES) {
        const size = 4 // mm
        expect(font.widthOfTextAtSize(text, size * PT_PER_MM) / PT_PER_MM, `${id}: ${text}`).toBeCloseTo(textWidth(text, id, size), 6)
      }
    }
  })

  it('is what the Canvas backend draws: no kerning, no ligatures', () => {
    for (const id of FONT_IDS) GlobalFonts.registerFromPath(fontFile(FONTS[id].file), FONTS[id].family)
    const ctx = createCanvas(10, 10).getContext('2d')
    for (const id of FONT_IDS) {
      setTextLineFont(ctx, id, 100)
      for (const text of SAMPLES) {
        const core = textWidth(text, id, 100)
        expect(Math.abs(ctx.measureText(withoutLigatures(text)).width - core) / core, `${id}: ${text}`).toBeLessThan(0.001)
      }
    }
  })
})

describe('breakLines', () => {
  const size = 4
  const w = (s: string) => textWidth(s, 'sans', size)

  it('breaks between words, filling each line', () => {
    expect(breakLines('one two three four', 'sans', size, w('one two three'))).toEqual(['one two three', 'four'])
    expect(breakLines('one two three four', 'sans', size, w('one two three') - 0.01)).toEqual(['one two', 'three four'])
  })

  it('keeps everything on one line without a width', () => {
    expect(breakLines('one two three four', 'sans', size)).toEqual(['one two three four'])
  })

  it('starts a new line at each line break and keeps empty lines', () => {
    expect(breakLines('Start\r\n\nFinish\n', 'sans', size, 100)).toEqual(['Start', '', 'Finish', ''])
    expect(breakLines('', 'sans', size, 100)).toEqual([''])
  })

  it('treats runs of spaces and tabs as one space', () => {
    expect(breakLines('  Løype \t A  ', 'sans', size, 100)).toEqual(['Løype A'])
  })

  it('splits a word wider than the box between characters', () => {
    const word = 'Orienteringsløpskarusell'
    const width = w('Orientering')
    const lines = breakLines(`Hei ${word}`, 'sans', size, width)
    expect(lines[0]).toBe('Hei')
    expect(lines.slice(1).join('')).toBe(word)
    for (const line of lines) expect(w(line)).toBeLessThanOrEqual(width + 1e-9)
    // Each split line is as long as fits.
    for (const line of lines.slice(1, -1)) expect(w(line + word[line.length])).toBeGreaterThan(width)
  })

  it('puts at least one character on a line, however narrow the box', () => {
    expect(breakLines('ab', 'sans', size, 0.1)).toEqual(['a', 'b'])
  })
})

describe('layoutText', () => {
  const block = { text: 'Hamar OK\nNattløp', font: 'display-bold' as const, sizePt: 18, width: 60 }
  const size = 18 * MM_PER_PT

  it('aligns each line in the box', () => {
    const width = (s: string) => textWidth(s, 'display-bold', size)
    expect(layoutText(block).lines.map(l => l.x)).toEqual([0, 0])
    const centred = layoutText({ ...block, align: 'center' }).lines
    expect(centred[1]?.x).toBeCloseTo((60 - width('Nattløp')) / 2, 9)
    const right = layoutText({ ...block, align: 'right' }).lines
    expect(right[0]?.x).toBeCloseTo(60 - width('Hamar OK'), 9)
  })

  it('spaces baselines by the line height, the font centred in each line', () => {
    const { lines, height } = layoutText(block)
    const step = DEFAULT_LINE_HEIGHT * size
    const { ascent, descent } = fontExtent('display-bold', size)
    expect(height).toBeCloseTo(2 * step, 9)
    expect(lines[0]?.baseline).toBeCloseTo((step - ascent - descent) / 2 + ascent, 9)
    expect((lines[1]?.baseline ?? 0) - (lines[0]?.baseline ?? 0)).toBeCloseTo(step, 9)
    expect(layoutText({ ...block, lineHeight: 1.5 }).height).toBeCloseTo(3 * size, 9)
  })

  it('gives text line primitives below the top-left corner, page y up, without empty lines', () => {
    const primitives = textPrimitives({ ...block, text: 'A\n\nB' }, [10, 100], { color: '#0b62a4' })
    const { lines } = layoutText({ ...block, text: 'A\n\nB' })
    expect(primitives).toHaveLength(2)
    expect(primitives[1]).toMatchObject({
      type: 'textLine',
      text: 'B',
      font: 'display-bold',
      color: '#0b62a4',
      at: [10, 100 - (lines[2]?.baseline ?? 0)],
    })
    expect(primitives[0]).toMatchObject({ size })
  })
})

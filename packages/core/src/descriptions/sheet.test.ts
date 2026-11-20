import { describe, expect, it } from 'vitest'
import { addControl, insertCourseControl, setDescription, updateCourse } from '../course/commands.ts'
import { CourseError, courseById, eventDocSchema } from '../course/doc.ts'
import { testEvent } from '../course/test-doc.ts'
import type { Primitive } from '../render/primitives.ts'
import { descriptionSheet, drawDescriptionSheet, type SheetLine } from './sheet.ts'

// Course A: start (0, 0) -> a (300, 400) -> b (300, 1000) -> c (900, 1000) -> finish (900, 0): 2.7 km,
// the last leg 1000 m. Course B: start -> b -> finish.
const sheetOf = (doc = testEvent(), course = 'A') => descriptionSheet(doc, courseById(doc, course), 'Club night')

describe('descriptionSheet', () => {
  it('has the title, the header, the start, a row per control and the way to the finish', () => {
    expect(sheetOf()).toEqual([
      { kind: 'title', text: 'Club night' },
      { kind: 'header', name: 'Long', length: '2.7 km', climb: null },
      { kind: 'control', controlId: 's', start: true, number: '', code: '', cells: {} },
      { kind: 'control', controlId: 'a', start: false, number: '1', code: '31', cells: {} },
      { kind: 'control', controlId: 'b', start: false, number: '2', code: '32', cells: {} },
      { kind: 'control', controlId: 'c', start: false, number: '3', code: '33', cells: {} },
      { kind: 'directive', controlId: 'f', symbol: '14.3', text: '1000 m' },
    ] satisfies SheetLine[])
  })

  it('shows the climb rounded to 5 m, as Purple Pen', () => {
    const header = (climb: number | null) => sheetOf(updateCourse(testEvent(), 'A', { climb }))[1]
    expect(header(47)).toMatchObject({ climb: '45 m' })
    expect(header(48)).toMatchObject({ climb: '50 m' })
    expect(header(null)).toMatchObject({ climb: null })
  })

  it('rounds the distance to the finish to 10 m', () => {
    let doc = testEvent()
    doc = { ...doc, controls: doc.controls.map(c => (c.id === 'f' ? { ...c, position: [900, 3] as [number, number] } : c)) }
    expect(sheetOf(doc).at(-1)).toMatchObject({ text: '1000 m' })
    doc = { ...doc, controls: doc.controls.map(c => (c.id === 'f' ? { ...c, position: [900, -6] as [number, number] } : c)) }
    expect(sheetOf(doc).at(-1)).toMatchObject({ text: '1010 m' })
  })

  it('gives a crossing point a "mandatory crossing point" line and no number', () => {
    let doc = addControl(testEvent(), { id: 'x', kind: 'crossingPoint', position: [600, 1000] })
    doc = insertCourseControl(doc, 'A', 'x', 3)
    const lines = sheetOf(doc)
    expect(lines[5]).toEqual({ kind: 'directive', controlId: 'x', symbol: '13.3', text: '' })
    expect(lines[6]).toMatchObject({ controlId: 'c', number: '3' })
  })

  it('shows a control description in every course that uses the control', () => {
    const doc = setDescription(setDescription(testEvent(), 'b', 'd', '2.4'), 'b', 'f', '1.5')
    expect(sheetOf(doc, 'A')[4]).toMatchObject({ controlId: 'b', cells: { d: '2.4', f: '1.5' } })
    expect(sheetOf(doc, 'B')[3]).toMatchObject({ controlId: 'b', number: '1', cells: { d: '2.4', f: '1.5' } })
  })
})

describe('setDescription', () => {
  const error = (fn: () => unknown) => {
    try {
      fn()
    } catch (e) {
      return e instanceof CourseError ? e.code : e
    }
    return null
  }

  it('takes symbols of the right column; column E may hold a second feature', () => {
    let doc = setDescription(testEvent(), 'a', 'c', '0.1N')
    doc = setDescription(doc, 'a', 'd', '2.4')
    doc = setDescription(doc, 'a', 'e', '2.4')
    doc = setDescription(doc, 'a', 'g', '11.1SE')
    doc = setDescription(doc, 'a', 'h', '12.2')
    expect(doc.controls.find(c => c.id === 'a')?.description).toEqual({ c: '0.1N', d: '2.4', e: '2.4', g: '11.1SE', h: '12.2' })
    expect(error(() => setDescription(testEvent(), 'a', 'd', '8.1'))).toBe('invalid_description') // "low" is column E
    expect(error(() => setDescription(testEvent(), 'a', 'g', '2.4'))).toBe('invalid_description')
    expect(error(() => setDescription(testEvent(), 'a', 'd', 'course_length'))).toBe('invalid_description') // header item
    expect(error(() => setDescription(testEvent(), 'a', 'd', 'nonsense'))).toBe('invalid_description')
  })

  it('takes sizes and the crossing, junction and bend symbols in column F', () => {
    const f = (value: string) => setDescription(testEvent(), 'a', 'f', value).controls.find(c => c.id === 'a')?.description?.f
    expect(f('1.5')).toBe('1.5')
    expect(f('3x4')).toBe('3x4')
    expect(f('3×4')).toBe('3x4')
    expect(f('2,5')).toBe('2.5')
    expect(f('0.5/2')).toBe('0.5/2')
    expect(f('2|3')).toBe('2|3')
    expect(f('10.2')).toBe('10.2')
    expect(error(() => f('big'))).toBe('invalid_description')
    expect(error(() => f('9.1high'))).toBe('invalid_description') // a text template, not a symbol
  })

  it('describes the start, but not the finish or a crossing point', () => {
    expect(setDescription(testEvent(), 's', 'd', '5.2').controls[0]?.description).toEqual({ d: '5.2' })
    expect(error(() => setDescription(testEvent(), 'f', 'd', '5.2'))).toBe('invalid_description')
  })

  it('clears a cell with null, and drops an empty description', () => {
    let doc = setDescription(testEvent(), 'a', 'd', '2.4')
    doc = setDescription(doc, 'a', 'f', '1.5')
    doc = setDescription(doc, 'a', 'd', null)
    expect(doc.controls.find(c => c.id === 'a')?.description).toEqual({ f: '1.5' })
    doc = setDescription(doc, 'a', 'f', null)
    expect(doc.controls.find(c => c.id === 'a')).not.toHaveProperty('description')
  })

  it('keeps documents without descriptions valid, and stores descriptions, climb and cell size', () => {
    expect(eventDocSchema.parse(testEvent())).toEqual(testEvent())
    let doc = setDescription(testEvent(), 'a', 'd', '2.4')
    doc = updateCourse(doc, 'A', { climb: 45, descriptionCellSize: 7 })
    expect(eventDocSchema.parse(JSON.parse(JSON.stringify(doc)))).toEqual(doc)
    expect(error(() => updateCourse(testEvent(), 'A', { descriptionCellSize: 8 }))).toBe('invalid_description')
    expect(error(() => updateCourse(testEvent(), 'A', { climb: -5 }))).toBe('invalid_description')
  })
})

describe('drawDescriptionSheet', () => {
  const cell = 6
  const mm = (v: number) => Math.round(v * 1000) / 1000
  const lines = (primitives: Primitive[]) =>
    primitives.filter((p): p is Extract<Primitive, { type: 'polyline' }> => p.type === 'polyline' && p.owner === undefined)
  const horizontal = (primitives: Primitive[]) =>
    lines(primitives)
      .filter(p => p.points[0]?.[1] === p.points[1]?.[1])
      .map(p => [mm(-(p.points[0]?.[1] ?? 0) / cell), mm(p.lineWidth)])

  it('draws thick lines round the sheet, above every row that is not a control and after the start and every third control', () => {
    let doc = testEvent()
    for (const [id, x] of [
      ['d', 1200],
      ['e', 1500],
    ] as const) {
      doc = addControl(doc, { id, kind: 'control', position: [x, 1000] })
      doc = insertCourseControl(doc, 'A', id, doc.courses[0]?.controls.length ? doc.courses[0].controls.length - 1 : 0)
    }
    // Rows: title 0, header 1, start 2, controls 1–5 in rows 3–7, finish 8.
    const drawn = drawDescriptionSheet(sheetOf(doc), cell)
    expect(horizontal(drawn)).toEqual([
      [0, 0.3],
      [1, 0.3],
      [2, 0.3],
      [3, 0.3],
      [4, 0.15],
      [5, 0.15],
      [6, 0.3],
      [7, 0.15],
      [8, 0.3],
      [9, 0.3],
    ])
  })

  it('splits control rows into 8 cells with thick lines after columns C and F, the header into name, length and climb', () => {
    const drawn = drawDescriptionSheet(sheetOf(updateCourse(testEvent(), 'A', { climb: 45 })), cell)
    const vertical = lines(drawn).filter(p => p.points[0]?.[0] === p.points[1]?.[0])
    const inRow = (row: number) =>
      vertical
        .filter(p => (p.points[0]?.[1] ?? 0) > -row * cell - 1 && (p.points[0]?.[1] ?? 0) < -row * cell + 1)
        .map(p => [mm((p.points[0]?.[0] ?? 0) / cell), mm(p.lineWidth)])
        .sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0))
    expect(inRow(1)).toEqual([
      [0, 0.3],
      [3, 0.3],
      [6, 0.3],
      [8, 0.3],
    ])
    expect(inRow(3)).toEqual([
      [0, 0.3],
      [1, 0.15],
      [2, 0.15],
      [3, 0.3],
      [4, 0.15],
      [5, 0.15],
      [6, 0.3],
      [7, 0.15],
      [8, 0.3],
    ])
    const texts = drawn.filter((p): p is Extract<Primitive, { type: 'text' }> => p.type === 'text').map(t => t.text)
    expect(texts).toEqual(['Club night', 'Long', '2.7 km', '45 m', '1', '31', '2', '32', '3', '33', '1000 m'])
  })

  it('draws description symbols in their cells, tagged with their control', () => {
    const doc = setDescription(setDescription(testEvent(), 'a', 'd', '2.4'), 'a', 'g', '11.1SE')
    const drawn = drawDescriptionSheet(sheetOf(doc), cell).filter(p => p.owner === 'a' && p.type !== 'text')
    expect(drawn.length).toBeGreaterThan(0)
    // Row 3 (control 1): every part lies inside column D (x 18–24 mm) or G (36–42 mm).
    for (const p of drawn) {
      const xs =
        p.type === 'circle'
          ? [p.center[0]]
          : p.type === 'path'
            ? p.commands.flatMap(c => (c[0] === 'Z' ? [] : [c[c.length - 2] as number]))
            : []
      for (const x of xs) expect((x >= 18 && x <= 24) || (x >= 36 && x <= 42)).toBe(true)
    }
  })

  it('sizes the text by the cell: numbers bold at 45 % of the cell, codes 40 %, sizes 36 %', () => {
    const doc = setDescription(testEvent(), 'a', 'f', '3x4')
    const texts = drawDescriptionSheet(sheetOf(doc), cell).filter((p): p is Extract<Primitive, { type: 'text' }> => p.type === 'text')
    expect(texts.find(t => t.text === '1')).toMatchObject({ height: 2.7, bold: true })
    expect(texts.find(t => t.text === '31')?.height).toBeCloseTo(2.4, 9)
    expect(texts.find(t => t.text === '3×4')?.height).toBeCloseTo(2.16, 9)
  })

  it('draws a size in column F as text, even when it looks like a symbol id ("1.5" is also the quarry)', () => {
    const doc = setDescription(testEvent(), 'a', 'f', '1.5')
    const parts = drawDescriptionSheet(sheetOf(doc), cell).filter(p => p.owner === 'a')
    expect(parts.map(p => p.type)).toEqual(['text', 'text', 'text']) // number, code, size
    expect(parts.at(-1)).toMatchObject({ text: '1.5', at: [33, -21] })
  })

  it('splits two sizes in column F with a diagonal line', () => {
    const doc = setDescription(testEvent(), 'a', 'f', '0.5/2')
    const parts = drawDescriptionSheet(sheetOf(doc), cell).filter(p => p.owner === 'a')
    const diagonal = parts.find(p => p.type === 'polyline')
    // Column F of row 3: x 30–36 mm, y -18 to -24 mm; from the top right to the bottom left.
    expect(diagonal).toMatchObject({
      points: [
        [36, -18],
        [30, -24],
      ],
    })
    const texts = parts.filter((p): p is Extract<Primitive, { type: 'text' }> => p.type === 'text').slice(2) // after number and code
    expect(texts.map(t => t.text)).toEqual(['0.5', '2'])
    expect(texts[0]?.at[0]).toBeLessThan(texts[1]?.at[0] ?? 0)
    expect(texts[0]?.at[1]).toBeGreaterThan(texts[1]?.at[1] ?? 0)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { addPoint, fitPairs } from './AlignPage.tsx'

vi.mock('../lib/supabase.ts', () => ({ supabase: {} }))

describe('matching points', () => {
  it('pairs clicks on the two maps in order, whichever side is clicked first', () => {
    let pairs = addPoint([], 'from', [0, 0])
    pairs = addPoint(pairs, 'from', [100, 0])
    pairs = addPoint(pairs, 'to', [10, 5])
    expect(pairs).toEqual([
      { id: 1, from: [0, 0], to: [10, 5] },
      { id: 2, from: [100, 0] },
    ])
    pairs = addPoint(pairs, 'to', [110, 5])
    pairs = addPoint(pairs, 'to', [10, 105])
    expect(pairs.map(p => p.id)).toEqual([1, 2, 3])
    expect(pairs[2]).toEqual({ id: 3, to: [10, 105] })
  })

  it('fits once two pairs are complete', () => {
    expect(
      fitPairs([
        { id: 1, from: [0, 0], to: [10, 5] },
        { id: 2, from: [100, 0] },
      ]),
    ).toBeNull()
    const fit = fitPairs([
      { id: 1, from: [0, 0], to: [10, 5] },
      { id: 2, from: [100, 0], to: [110, 5] },
      { id: 3, to: [1, 1] },
    ])
    expect(fit?.transform).toMatchObject({ tx: 10, ty: 5 })
    expect(fit?.rms).toBeCloseTo(0, 9)
  })

  it('gives no fit while both points on the first map are in the same place', () => {
    expect(
      fitPairs([
        { id: 1, from: [5, 5], to: [0, 0] },
        { id: 2, from: [5, 5], to: [9, 9] },
      ]),
    ).toBeNull()
  })
})

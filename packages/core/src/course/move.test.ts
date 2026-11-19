import { describe, expect, it } from 'vitest'
import { apply, inverse, type Similarity } from '../similarity.ts'
import { setLegBends } from './commands.ts'
import { courseById } from './doc.ts'
import { courseLength } from './length.ts'
import { chainTransforms, moveDocToVersion } from './move.ts'
import { testEvent } from './test-doc.ts'

const rotate = (deg: number, s: number, tx: number, ty: number): Similarity => {
  const r = (deg * Math.PI) / 180
  return { a: s * Math.cos(r), b: s * Math.sin(r), tx, ty }
}

describe('moving an event to a newer map version', () => {
  // The new version is shifted 120 m east and 40 m south and rotated 2.5° (e.g. a corrected magnetic north).
  const toNew = rotate(2.5, 1, 120, -40)
  const extent = { minX: -1000, minY: -1000, maxX: 5000, maxY: 5000 }

  it('puts every control and bend point where the same terrain is on the new map', () => {
    const doc = setLegBends(testEvent(), 'A', 'a', 'b', [[100, 700]])
    const { doc: moved, outside } = moveDocToVersion(doc, toNew, extent)
    for (const c of doc.controls) {
      const now = moved.controls.find(m => m.id === c.id)?.position
      const expected = apply(toNew, c.position)
      expect(now?.[0]).toBeCloseTo(expected[0], 9)
      expect(now?.[1]).toBeCloseTo(expected[1], 9)
    }
    expect(courseById(moved, 'A').bends['a>b']?.[0]?.[0]).toBeCloseTo(apply(toNew, [100, 700])[0], 9)
    expect(outside).toEqual([])
    // A shift and rotation keeps the course lengths.
    expect(courseLength(moved, courseById(moved, 'A'))).toBeCloseTo(courseLength(doc, courseById(doc, 'A')), 6)
    // And moving back restores the event.
    const back = moveDocToVersion(moved, inverse(toNew), extent).doc
    expect(back.controls[1]?.position[0]).toBeCloseTo(300, 9)
  })

  it('lists controls that land outside the new map', () => {
    const { outside } = moveDocToVersion(testEvent(), toNew, { minX: 0, minY: -100, maxX: 1100, maxY: 800 })
    expect(outside).toEqual(['b', 'c'])
  })

  it('chains the steps from version to version', () => {
    const step1 = rotate(1, 1, 50, 0)
    const step2 = rotate(-3, 1.0001, 0, 25)
    const p: [number, number] = [812, 4410]
    const chained = apply(chainTransforms([step1, step2]), p)
    const stepwise = apply(step2, apply(step1, p))
    expect(chained[0]).toBeCloseTo(stepwise[0], 9)
    expect(chained[1]).toBeCloseTo(stepwise[1], 9)
    expect(chainTransforms([])).toEqual({ a: 1, b: 0, tx: 0, ty: 0 })
  })
})

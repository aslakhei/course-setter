import { describe, expect, it } from 'vitest'
import {
  apply,
  automaticAlignment,
  compose,
  fitSimilarity,
  frameToProjected,
  type Georef,
  IDENTITY,
  inverse,
  type Point,
  rotationDegOf,
  type Similarity,
  scaleOf,
} from './similarity.ts'

const close = (p: Point, q: Point, digits = 6) => {
  expect(p[0]).toBeCloseTo(q[0], digits)
  expect(p[1]).toBeCloseTo(q[1], digits)
}

/** Rotate by `deg` around the origin, scale by `s`, then shift. */
function make(deg: number, s: number, tx: number, ty: number): Similarity {
  const r = (deg * Math.PI) / 180
  return { a: s * Math.cos(r), b: s * Math.sin(r), tx, ty }
}

describe('similarity transforms', () => {
  const t = make(3.5, 1.02, 120, -45)

  it('apply, compose and inverse agree', () => {
    const p: Point = [812.5, 4410]
    close(apply(inverse(t), apply(t, p)), p)
    close(apply(compose(t, inverse(t)), p), p)
    const u = make(-10, 0.5, 3, 4)
    close(apply(compose(u, t), p), apply(u, apply(t, p)))
    close(apply(IDENTITY, p), p)
  })

  it('reports scale and rotation', () => {
    expect(scaleOf(t)).toBeCloseTo(1.02, 12)
    expect(rotationDegOf(t)).toBeCloseTo(3.5, 12)
  })
})

describe('fitSimilarity', () => {
  const truth = make(-2.2, 1.0004, 35.5, -18.25)
  const spread: Point[] = [
    [100, 200],
    [5200, 300],
    [4800, 6100],
    [250, 5900],
    [2600, 3100],
  ]

  it('recovers a shift, rotation and scale exactly from two pairs', () => {
    const fit = fitSimilarity(spread.slice(0, 2).map(from => ({ from, to: apply(truth, from) })))
    for (const k of ['a', 'b', 'tx', 'ty'] as const) expect(fit.transform[k]).toBeCloseTo(truth[k], 8)
    expect(fit.rms).toBeLessThan(1e-6)
  })

  it('averages out clicking errors over more pairs and reports them', () => {
    const errors: Point[] = [
      [1.5, -0.8],
      [-1.2, 0.9],
      [0.4, 1.4],
      [-0.9, -1.1],
      [0.2, -0.4],
    ]
    const pairs = spread.map((from, i) => {
      const [x, y] = apply(truth, from)
      const [ex, ey] = errors[i] ?? [0, 0]
      return { from, to: [x + ex, y + ey] as Point }
    })
    const fit = fitSimilarity(pairs)
    expect(fit.residuals).toHaveLength(5)
    expect(fit.rms).toBeGreaterThan(0.3)
    expect(fit.rms).toBeLessThan(2)
    // A point in the middle of the map lands within a metre of where it should.
    const [x, y] = apply(fit.transform, [2500, 3000])
    const [ex, ey] = apply(truth, [2500, 3000])
    expect(Math.hypot(x - ex, y - ey)).toBeLessThan(1)
  })

  it('needs two different points', () => {
    expect(() => fitSimilarity([{ from: [0, 0], to: [1, 1] }])).toThrow(RangeError)
    expect(() =>
      fitSimilarity([
        { from: [5, 5], to: [1, 1] },
        { from: [5, 5], to: [2, 2] },
      ]),
    ).toThrow(RangeError)
  })
})

describe('automaticAlignment', () => {
  const georef = (extra: Partial<Georef> = {}): Georef => ({
    epsg: 32632,
    easting: 600_000,
    northing: 6_640_000,
    grivationDeg: 1.76,
    ocadGridId: 2032,
    ...extra,
  })

  it('is the identity when the georeferencing is unchanged', () => {
    const v = { kind: 'ocad' as const, scale: 15000, georef: georef() }
    expect(automaticAlignment(v, v)).toEqual({ transform: IDENTITY, method: 'identity' })
  })

  it('follows a moved paper origin and a changed scale through the projected coordinates', () => {
    const previous = { kind: 'ocad' as const, scale: 15000, georef: georef() }
    // The mapper moved the origin 250 m east and changed grivation a little; scale 1:10 000 now.
    const next = { kind: 'ocad' as const, scale: 10000, georef: georef({ easting: 600_250, grivationDeg: 1.9 }) }
    const result = automaticAlignment(previous, next)
    expect(result?.method).toBe('georef')
    // Any ground point keeps its projected coordinates through the transform.
    const p: Point = [1234, 5678]
    const projected = apply(frameToProjected(previous.georef), p)
    close(apply(frameToProjected(next.georef), apply(result?.transform ?? IDENTITY, p)), projected, 6)
  })

  it('assumes nothing moved for the same OCAD map without georeferencing', () => {
    const v = { kind: 'ocad' as const, scale: 15000, georef: null }
    expect(automaticAlignment(v, v)?.method).toBe('identity')
    expect(automaticAlignment(v, { ...v, scale: 10000 })).toBeNull()
  })

  it('leaves PDF maps and different grids to the admin', () => {
    const ocad = { kind: 'ocad' as const, scale: 15000, georef: georef() }
    expect(automaticAlignment(ocad, { kind: 'pdf', scale: 15000, georef: null })).toBeNull()
    expect(automaticAlignment(ocad, { ...ocad, georef: georef({ epsg: 25833 }) })).toBeNull()
  })
})

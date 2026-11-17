import { describe, expect, it } from 'vitest'
import { groundMToPaperMm, paperMmToGroundM } from './scale.ts'

describe('scale conversion', () => {
  it('1 km is 100 mm at 1:10 000 and 66.67 mm at 1:15 000', () => {
    expect(groundMToPaperMm(1000, 10000)).toBe(100)
    expect(groundMToPaperMm(1000, 15000)).toBeCloseTo(66.667, 3)
  })

  it('1 mm on paper is 15 m at 1:15 000 and 4 m at 1:4 000', () => {
    expect(paperMmToGroundM(1, 15000)).toBe(15)
    expect(paperMmToGroundM(1, 4000)).toBe(4)
  })

  it('round-trips', () => {
    expect(paperMmToGroundM(groundMToPaperMm(1234.5, 7500), 7500)).toBeCloseTo(1234.5, 9)
  })

  it.each([0, -10000, Number.NaN, Number.POSITIVE_INFINITY])('rejects scale %s', scale => {
    expect(() => groundMToPaperMm(1, scale)).toThrow(RangeError)
    expect(() => paperMmToGroundM(1, scale)).toThrow(RangeError)
  })
})

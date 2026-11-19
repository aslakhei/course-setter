import { describe, expect, it, vi } from 'vitest'
import { formatBytes, formatDate, formatLength, formatScale } from './format.ts'
import { kindOf, nameFromFile } from './maps.ts'

vi.mock('./supabase.ts', () => ({ supabase: {} }))

describe('format', () => {
  it('formats dates, scales, lengths and sizes', () => {
    expect(formatDate('2026-11-18T10:00:00Z')).toBe('18 Nov 2026')
    expect(formatScale(15000)).toBe('1:15 000')
    expect(formatScale(4000)).toBe('1:4 000')
    expect(formatLength(1250, 15000)).toBe('1 250 m · 83.3 mm at 1:15 000')
    expect(formatLength(42.25, 10000)).toBe('42.3 m · 4.2 mm at 1:10 000')
    expect(formatBytes(5_432_100)).toBe('5.4 MB')
  })
})

describe('map files', () => {
  it('tells OCAD from PDF by the file name', () => {
    expect(kindOf('Skogen.OCD')).toBe('ocad')
    expect(kindOf('old map.pdf')).toBe('pdf')
    expect(kindOf('map.omap')).toBeNull()
    expect(nameFromFile('Skogen 2026.ocd')).toBe('Skogen 2026')
  })
})

import { describe, expect, it } from 'vitest'
import { safeFileName } from './files.ts'

describe('safeFileName', () => {
  it('keeps names readable and safe as file names', () => {
    expect(safeFileName('H21: long/short')).toBe('H21- long-short')
    expect(safeFileName('  ')).toBe('course')
  })
})

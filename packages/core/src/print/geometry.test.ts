import { describe, expect, it } from 'vitest'
import type { Bounds } from '../render/primitives.ts'
import type { PlacedElement } from './compose.ts'
import { alignBoxes, elementAt, handleAt, resizeBox, snapMove, snapResize, snapTargets } from './geometry.ts'

const placed = (id: string, box: Bounds, locked = false): PlacedElement => ({ id, kind: 'shape', box, primitives: [], locked })
const B = (minX: number, minY: number, maxX: number, maxY: number): Bounds => ({ minX, minY, maxX, maxY })

describe('elementAt', () => {
  const elements = [placed('under', B(0, 0, 50, 50)), placed('over', B(20, 20, 40, 40)), placed('locked', B(30, 30, 60, 60), true)]

  it('finds the topmost element under the pointer, skipping locked ones', () => {
    expect(elementAt(elements, [25, 25])?.id).toBe('over')
    expect(elementAt(elements, [10, 10])?.id).toBe('under')
    expect(elementAt(elements, [35, 35])?.id).toBe('over')
    expect(elementAt(elements, [55, 55])).toBeNull()
  })

  it('takes a tolerance round each box', () => {
    expect(elementAt(elements, [51, 10])).toBeNull()
    expect(elementAt(elements, [51, 10], 1.5)?.id).toBe('under')
  })
})

describe('handles', () => {
  it('finds the handle under the pointer', () => {
    const box = B(10, 10, 50, 30)
    expect(handleAt(box, [50.5, 30.4], 1)).toBe('ne')
    expect(handleAt(box, [30, 10], 1)).toBe('s')
    expect(handleAt(box, [30, 20], 1)).toBeNull()
    expect(handleAt(box, [50, 20], 1, ['n', 's'])).toBeNull()
  })

  it('resizes from a handle, the opposite side staying, never below the minimum', () => {
    const box = B(10, 10, 50, 30)
    expect(resizeBox(box, 'e', [5, 99])).toEqual(B(10, 10, 55, 30))
    expect(resizeBox(box, 'nw', [-5, 5])).toEqual(B(5, 10, 50, 35))
    expect(resizeBox(box, 'w', [100, 0], { min: 2 })).toEqual(B(48, 10, 50, 30))
  })

  it('keeps an image’s proportions when a corner is dragged', () => {
    const box = B(10, 10, 50, 30) // 2:1
    expect(resizeBox(box, 'se', [10, 0], { aspect: 2 })).toEqual(B(10, 5, 60, 30))
    expect(resizeBox(box, 'ne', [-20, 0], { aspect: 2 })).toEqual(B(10, 10, 30, 20))
    // An edge handle stretches it.
    expect(resizeBox(box, 'e', [10, 0], { aspect: 2 })).toEqual(B(10, 10, 60, 30))
  })
})

describe('snapping', () => {
  // A4 portrait, 5 mm margin, map area inside the margin less a 30 mm header; one other element.
  const targets = snapTargets([210, 297], 5, B(5, 5, 205, 262), [B(100, 100, 140, 120)])

  it('snaps a moved box’s edge or centre to the nearest line within the threshold', () => {
    const near = snapMove(B(6.2, 50, 46.2, 70), targets, 1.5)
    expect(near.box.minX).toBeCloseTo(5, 9)
    expect(near.guides.x).toBe(5)
    // Its centre (105) is 0.4 from the page's centre line, closer than its left edge to anything.
    const centred = snapMove(B(85.4, 200, 125.4, 210), targets, 1.5)
    expect(centred.box.minX).toBeCloseTo(85, 9)
    expect(centred.guides.x).toBe(105)
    // Lined up with the other element's top.
    expect(snapMove(B(10, 99, 30, 119.4), targets, 1).box.maxY).toBeCloseTo(120, 9)
  })

  it('leaves a box alone when nothing is near', () => {
    const away = snapMove(B(20, 40, 50, 60), targets, 1)
    expect(away.box).toEqual(B(20, 40, 50, 60))
    expect(away.guides).toEqual({ x: null, y: null })
  })

  it('snaps only the edges a handle moves', () => {
    const r = snapResize(B(6, 50, 99.2, 70), 'e', targets, 1.5)
    expect(r.box).toEqual(B(6, 50, 100, 70))
    expect(r.guides).toEqual({ x: 100, y: null })
  })
})

describe('alignBoxes', () => {
  const boxes = [B(10, 10, 30, 20), B(50, 40, 60, 80)]

  it('lines boxes up on the outermost edge or the common centre', () => {
    expect(alignBoxes(boxes, 'left').map(b => b.minX)).toEqual([10, 10])
    expect(alignBoxes(boxes, 'right').map(b => b.maxX)).toEqual([60, 60])
    expect(alignBoxes(boxes, 'center').map(b => (b.minX + b.maxX) / 2)).toEqual([35, 35])
    expect(alignBoxes(boxes, 'top').map(b => b.maxY)).toEqual([80, 80])
    expect(alignBoxes(boxes, 'bottom').map(b => b.minY)).toEqual([10, 10])
    expect(alignBoxes(boxes, 'middle').map(b => (b.minY + b.maxY) / 2)).toEqual([45, 45])
    // Sizes stay.
    expect(alignBoxes(boxes, 'left').map(b => b.maxX - b.minX)).toEqual([20, 10])
  })
})

import { describe, expect, it } from 'vitest'
import type { WhiteAreaNode } from './elements.ts'
import { insertNode, mapNodes, moveHandle, moveNode, moveNodes, penNode, removeNode, toggleCorner } from './nodes.ts'

const square: WhiteAreaNode[] = [{ at: [0, 0] }, { at: [10, 0], in: [8, -2], out: [12, 2] }, { at: [10, 10] }, { at: [0, 10] }]

describe('editing an outline', () => {
  it('moves a point with its handles, or every point', () => {
    expect(moveNode(square, 1, [20, 5])[1]).toEqual({ at: [20, 5], in: [18, 3], out: [22, 7] })
    expect(moveNodes(square, [1, 2])[0]).toEqual({ at: [1, 2] })
    expect(moveNodes(square, [1, 2])[1]).toEqual({ at: [11, 2], in: [9, 0], out: [13, 4] })
  })

  it('keeps a curve smooth when a handle moves, unless it is moved alone', () => {
    const smooth = moveHandle(square, 1, 'out', [10, 5])[1]
    expect(smooth?.out).toEqual([10, 5])
    // The other handle points the other way, keeping its length (√8).
    expect(smooth?.in?.[0]).toBeCloseTo(10, 9)
    expect(smooth?.in?.[1]).toBeCloseTo(-Math.sqrt(8), 9)
    expect(moveHandle(square, 1, 'out', [10, 5], true)[1]).toEqual({ at: [10, 0], in: [8, -2], out: [10, 5] })
  })

  it('switches a point between corner and curve', () => {
    expect(toggleCorner(square, 1)[1]).toEqual({ at: [10, 0] })
    // Point (10, 10) between neighbours (10, 0) and (0, 10): handles along that line, a sixth of it each way.
    const curve = toggleCorner(square, 2)[2]
    expect(curve?.in?.[0]).toBeCloseTo(10 + 10 / 6, 9)
    expect(curve?.in?.[1]).toBeCloseTo(10 - 10 / 6, 9)
    expect(curve?.out?.[0]).toBeCloseTo(10 - 10 / 6, 9)
    expect(curve?.out?.[1]).toBeCloseTo(10 + 10 / 6, 9)
  })

  it('removes points down to three, and inserts corners', () => {
    expect(removeNode(square, 0)).toHaveLength(3)
    expect(removeNode(removeNode(square, 0), 0)).toHaveLength(3)
    expect(insertNode(square, 1, [10, 5]).map(n => n.at)).toEqual([
      [0, 0],
      [10, 0],
      [10, 5],
      [10, 10],
      [0, 10],
    ])
  })

  it('converts every point and handle', () => {
    expect(mapNodes(square, ([x, y]) => [x * 2, 10 - y])[1]).toEqual({ at: [20, 10], in: [16, 12], out: [24, 8] })
  })
})

describe('the pen', () => {
  it('makes a corner on a click and a curve point on a drag, its handles mirrored', () => {
    expect(penNode([5, 5], null)).toEqual({ at: [5, 5] })
    expect(penNode([5, 5], [5, 5])).toEqual({ at: [5, 5] })
    expect(penNode([5, 5], [8, 6])).toEqual({ at: [5, 5], out: [8, 6], in: [2, 4] })
  })
})

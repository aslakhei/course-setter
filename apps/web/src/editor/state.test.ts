import {
  addCourse,
  allControlsDrawing,
  courseById,
  courseDrawing,
  courseLength,
  type EventDoc,
  emptyDoc,
  moveControl,
} from '@course-setter/core'
import { describe, expect, it } from 'vitest'
import {
  type Action,
  ALL_CONTROLS,
  addBend,
  clickAction,
  type EditorState,
  editPoints,
  initialState,
  legAt,
  movedPoints,
  numberAt,
  reducer,
  specialAt,
  type Tool,
  vertexAt,
} from './state.ts'

let counter = 0
const newId = () => `n${++counter}`

/** Click with `tool` at `point` (on control `hit`, if given) and apply the result. */
function click(state: EditorState, tool: Tool, point: [number, number], hit: string | null = null): EditorState {
  const withTool = reducer(state, { type: 'tool', tool })
  const action = clickAction(withTool, point, hit, newId)
  return action ? reducer(withTool, action) : withTool
}

const present = (s: EditorState) => s.history.present
const stops = (s: EditorState, courseId = s.courseId) =>
  courseById(present(s), courseId).controls.map(id => present(s).controls.find(c => c.id === id)?.kind)

function withCourse(): EditorState {
  counter = 0
  const doc = addCourse(emptyDoc(15000), { id: 'A', name: 'A', printScale: 15000 })
  return initialState(doc)
}

describe('setting a course by clicking on the map', () => {
  it('builds start, controls and finish in running order, a control placed before the finish', () => {
    let s = withCourse()
    s = click(s, 'start', [0, 0])
    s = click(s, 'control', [100, 0])
    s = click(s, 'finish', [300, 0])
    s = click(s, 'control', [200, 0]) // after the selected (the finish just placed?) -> before the finish
    expect(stops(s)).toEqual(['start', 'control', 'control', 'finish'])
    expect(
      present(s)
        .controls.filter(c => c.kind === 'control')
        .map(c => c.code),
    ).toEqual([31, 32])
    expect(courseLength(present(s), courseById(present(s), 'A'))).toBe(300)
  })

  it('puts a new control after the selected one', () => {
    let s = withCourse()
    s = click(s, 'start', [0, 0])
    s = click(s, 'control', [100, 0]) // n2
    s = click(s, 'control', [300, 0]) // n3
    s = reducer(s, { type: 'select', controlId: 'n2' })
    s = click(s, 'control', [200, 0]) // n4 between n2 and n3
    expect(courseById(present(s), 'A').controls).toEqual(['n1', 'n2', 'n4', 'n3'])
    expect(s.selected).toBe('n4')
  })

  it('has one start and one finish per course: a new one replaces the old', () => {
    let s = withCourse()
    s = click(s, 'start', [0, 0])
    s = click(s, 'finish', [500, 0])
    s = click(s, 'start', [10, 10])
    s = click(s, 'finish', [510, 10])
    expect(courseById(present(s), 'A').controls).toEqual(['n3', 'n4'])
    // The old start and finish stay in the pool for other courses.
    expect(present(s).controls).toHaveLength(4)
  })

  it('reuses an existing control when it is clicked, so courses can share it', () => {
    let s = withCourse()
    s = click(s, 'start', [0, 0])
    s = click(s, 'control', [100, 0]) // n2
    s = click(s, 'finish', [300, 0])
    s = reducer(s, { type: 'edit', doc: addCourse(present(s), { id: 'B', name: 'B', printScale: 10000 }) })
    s = reducer(s, { type: 'course', courseId: 'B' })
    s = click(s, 'start', [0, 0], 'n1')
    s = click(s, 'control', [100, 0], 'n2')
    expect(courseById(present(s), 'B').controls).toEqual(['n1', 'n2'])
    expect(present(s).controls).toHaveLength(3)
    // Moving the shared control moves it in both courses.
    s = reducer(s, { type: 'edit', doc: moveControl(present(s), 'n2', [100, 100]) })
    expect(courseLength(present(s), courseById(present(s), 'A'))).toBeCloseTo(Math.hypot(100, 100) + Math.hypot(200, 100), 9)
    expect(courseLength(present(s), courseById(present(s), 'B'))).toBeCloseTo(Math.hypot(100, 100), 9)
  })

  it('only selects when the clicked control is of another kind than the tool', () => {
    let s = withCourse()
    s = click(s, 'start', [0, 0])
    s = click(s, 'control', [0, 0], 'n1')
    expect(courseById(present(s), 'A').controls).toEqual(['n1'])
    expect(s.selected).toBe('n1')
  })

  it('adds controls to the pool only, in the all-controls view', () => {
    let s = reducer(withCourse(), { type: 'course', courseId: ALL_CONTROLS })
    s = click(s, 'control', [50, 50])
    expect(present(s).controls).toHaveLength(1)
    expect(courseById(present(s), 'A').controls).toEqual([])
  })

  it('selects with the select tool and deselects on empty map', () => {
    let s = withCourse()
    s = click(s, 'control', [50, 50])
    s = click(s, 'select', [0, 0], 'n1')
    expect(s.selected).toBe('n1')
    s = click(s, 'select', [900, 900])
    expect(s.selected).toBeNull()
  })
})

describe('undo and redo', () => {
  it('walk back and forth through edits and keep the selection valid', () => {
    let s = withCourse()
    s = click(s, 'control', [10, 10])
    s = click(s, 'control', [20, 20])
    expect(s.selected).toBe('n2')
    s = reducer(s, { type: 'undo' })
    expect(present(s).controls).toHaveLength(1)
    expect(s.selected).toBeNull()
    s = reducer(s, { type: 'redo' })
    expect(present(s).controls).toHaveLength(2)
  })

  it('falls back to another course when the edited one is undone away', () => {
    let s = initialState(emptyDoc(15000))
    expect(s.courseId).toBe(ALL_CONTROLS)
    s = reducer(s, { type: 'edit', doc: addCourse(present(s), { id: 'X', name: 'X', printScale: 15000 }) })
    s = reducer(s, { type: 'course', courseId: 'X' })
    s = reducer(s, { type: 'undo' })
    expect(s.courseId).toBe(ALL_CONTROLS)
  })

  it('starts a fresh history when a document is loaded', () => {
    let s = withCourse()
    s = click(s, 'control', [10, 10])
    const loaded: EventDoc = emptyDoc(15000)
    s = reducer(s, { type: 'load', doc: loaded } satisfies Action)
    expect(s.history.past).toEqual([])
    expect(present(s)).toBe(loaded)
  })
})

describe('bends', () => {
  it('finds the leg under the pointer and bends it there', () => {
    let s = withCourse()
    s = click(s, 'start', [0, 0])
    s = click(s, 'finish', [1000, 0])
    const course = courseById(present(s), 'A')
    expect(legAt(present(s), course, [500, 30], 50)).toEqual({ leg: 0, segment: 0 })
    expect(legAt(present(s), course, [500, 300], 50)).toBeNull()
    const bent = addBend(present(s), course, 0, 0, [500, 300])
    expect(courseLength(bent, courseById(bent, 'A'))).toBeCloseTo(2 * Math.hypot(500, 300), 9)
  })
})

describe('special symbols', () => {
  /** Several clicks with one tool (choosing the tool again would drop an unfinished drawing). */
  function clicks(state: EditorState, tool: Tool, points: [number, number][]): EditorState {
    let s = reducer(state, { type: 'tool', tool })
    for (const p of points) {
      const action = clickAction(s, p, null, newId)
      if (action) s = reducer(s, action)
    }
    return s
  }

  it('places a point symbol with one click and selects it', () => {
    const s = clicks(withCourse(), 'firstAid', [[50, 50]])
    expect(present(s).specials).toEqual([{ id: 'n1', kind: 'firstAid', points: [[50, 50]] }])
    expect(s.selected).toBe('n1')
  })

  it('draws a line point by point; clicking the last point again (a double-click) finishes it', () => {
    const s = clicks(withCourse(), 'oobBoundary', [
      [0, 0],
      [100, 0],
      [100, 50],
    ])
    expect(present(s).specials).toEqual([])
    expect(s.draft).toEqual([
      [0, 0],
      [100, 0],
      [100, 50],
    ])
  })

  it('finishes a line on the repeated point or with Enter, and adds it selected', () => {
    let s = reducer(withCourse(), { type: 'tool', tool: 'oobBoundary' })
    for (const point of [
      [0, 0],
      [100, 0],
      [100, 50],
      [100, 52], // within the 5 m tolerance of the last point
    ] as [number, number][]) {
      s = reducer(s, clickAction(s, point, null, newId, 5) as Action)
    }
    expect(s.draft).toEqual([])
    expect(present(s).specials[0]).toMatchObject({
      kind: 'oobBoundary',
      points: [
        [0, 0],
        [100, 0],
        [100, 50],
      ],
    })
    expect(s.selected).toBe(present(s).specials[0]?.id)
    // Two quick clicks at different places do not finish it; Enter does.
    s = reducer(s, { type: 'tool', tool: 'markedRoute' })
    s = reducer(s, clickAction(s, [0, 0], null, newId, 5) as Action)
    s = reducer(s, clickAction(s, [50, 0], null, newId, 5) as Action)
    expect(s.draft).toHaveLength(2)
    s = reducer(s, { type: 'finishDraft', id: newId() })
    expect(present(s).specials.map(x => x.kind)).toEqual(['oobBoundary', 'markedRoute'])
  })

  it('drops an area with too few points, and a drawing when the tool changes', () => {
    let s = clicks(withCourse(), 'oobArea', [
      [0, 0],
      [100, 0],
    ])
    s = reducer(s, { type: 'finishDraft', id: newId() })
    expect(present(s).specials).toEqual([])
    expect(s.draft).toEqual([])
    s = clicks(s, 'oobArea', [[0, 0]])
    s = reducer(s, { type: 'tool', tool: 'select' })
    expect(s.draft).toEqual([])
  })

  it('finds a special under the pointer: a point near it, a line near it, an area inside or near its edge', () => {
    let s = clicks(withCourse(), 'refreshment', [[0, 0]])
    s = clicks(s, 'oobBoundary', [
      [100, 0],
      [200, 0],
    ])
    s = reducer(s, { type: 'finishDraft', id: newId() })
    s = clicks(s, 'oobArea', [
      [300, 0],
      [400, 0],
      [400, 100],
      [300, 100],
    ])
    s = reducer(s, { type: 'finishDraft', id: newId() })
    const [cup, line, area] = present(s).specials.map(x => x.id)
    const at = (p: [number, number]) => specialAt(present(s).specials, p, 5, 20)
    expect(at([10, 10])).toBe(cup)
    expect(at([150, 4])).toBe(line)
    expect(at([150, 10])).toBeNull()
    expect(at([350, 50])).toBe(area)
    expect(at([403, 50])).toBe(area)
    expect(at([450, 50])).toBeNull()
    const area0 = present(s).specials[2] as EventDoc['specials'][number]
    expect(vertexAt(area0, [401, 99], 5)).toBe(2)
    expect(movedPoints(area0, [10, 0], 2)[2]).toEqual([410, 100])
    expect(movedPoints(area0, [10, 0], null)[0]).toEqual([310, 0])
  })

  it('keeps a selected special across edits, and drops the selection when it is deleted by undo', () => {
    let s = clicks(withCourse(), 'firstAid', [[0, 0]])
    s = reducer(s, { type: 'edit', doc: addCourse(present(s), { id: 'B', name: 'B', printScale: 15000 }) })
    expect(s.selected).toBe('n1')
    s = reducer(s, { type: 'undo' })
    s = reducer(s, { type: 'undo' })
    expect(present(s).specials).toEqual([])
    expect(s.selected).toBeNull()
  })
})

describe('editing the points of a line or area (Shift+click)', () => {
  const area = {
    id: 'a',
    kind: 'oobArea' as const,
    points: [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ] as [number, number][],
  }
  const line = {
    id: 'l',
    kind: 'oobBoundary' as const,
    points: [
      [0, 0],
      [100, 0],
    ] as [number, number][],
  }

  it('adds a point on the nearest edge, also on the edge closing an area', () => {
    expect(editPoints(area, [50, 2], 5)).toEqual([
      [0, 0],
      [50, 2],
      [100, 0],
      [100, 100],
      [0, 100],
    ])
    expect(editPoints(area, [1, 50], 5)).toEqual([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
      [1, 50],
    ])
    expect(editPoints(line, [50, -3], 5)).toEqual([
      [0, 0],
      [50, -3],
      [100, 0],
    ])
    expect(editPoints(area, [50, 50], 5)).toBeNull() // inside, on no edge
  })

  it('removes the point clicked, keeping at least what the shape needs', () => {
    expect(editPoints(area, [99, 99], 5)).toEqual([
      [0, 0],
      [100, 0],
      [0, 100],
    ])
    const triangle = { ...area, points: area.points.slice(0, 3) }
    expect(editPoints(triangle, [100, 100], 5)).toBeNull()
    expect(editPoints(line, [0, 1], 5)).toBeNull()
    expect(editPoints({ id: 'p', kind: 'firstAid', points: [[0, 0]] }, [0, 0], 5)).toBeNull()
  })
})

describe('clicking a control number', () => {
  it('finds the control whose number is under the pointer, in a course and in the all-controls view', () => {
    let s = withCourse()
    s = click(s, 'start', [0, 0])
    s = click(s, 'control', [300, 0])
    const doc = present(s)
    const drawing = courseDrawing(doc, courseById(doc, 'A'))
    const number = drawing.find(p => p.type === 'text')
    if (number?.type !== 'text') throw new Error('no number')
    const control = doc.controls.find(c => c.kind === 'control')?.id
    expect(numberAt(drawing, number.at, 0)?.id).toBe(control)
    expect(numberAt(drawing, [number.at[0], number.at[1] + 3], 0)).toBeNull() // above the digits
    expect(numberAt(drawing, [number.at[0], number.at[1] + 3], 1.5)?.id).toBe(control) // with leeway
    const codes = allControlsDrawing(doc, 15000)
    const code = codes.find(p => p.type === 'text')
    if (code?.type !== 'text') throw new Error('no code')
    expect(numberAt(codes, code.at, 0)?.id).toBe(control)
  })
})

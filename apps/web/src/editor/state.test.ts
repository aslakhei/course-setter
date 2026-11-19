import { addCourse, courseById, courseLength, type EventDoc, emptyDoc, moveControl } from '@course-setter/core'
import { describe, expect, it } from 'vitest'
import { type Action, ALL_CONTROLS, addBend, clickAction, type EditorState, initialState, legAt, reducer, type Tool } from './state.ts'

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

import { addControl, type EventDoc, emptyDoc } from '@course-setter/core'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SaveConflict, savesFinished } from '../lib/events.ts'
import { AUTOSAVE_DELAY_MS, useAutosave } from './useAutosave.ts'

vi.mock('../lib/supabase.ts', () => ({ supabase: {} }))

const base = emptyDoc(15000)
const edit = (doc: EventDoc, n: number) => addControl(doc, { id: `c${n}`, kind: 'control', position: [n, n] })

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function setup(save: (id: string, doc: EventDoc, rev: number) => Promise<number>) {
  return renderHook(({ doc }) => useAutosave('e1', doc, 1, save), { initialProps: { doc: base } })
}

describe('autosave', () => {
  it('saves once, 1.5 s after the last of several quick edits, against the current revision', async () => {
    const save = vi.fn(async (_id: string, _doc: EventDoc, rev: number) => rev + 1)
    const { result, rerender } = setup(save)
    const one = edit(base, 1)
    const two = edit(one, 2)
    rerender({ doc: one })
    await act(() => vi.advanceTimersByTimeAsync(500))
    rerender({ doc: two })
    expect(result.current.status).toBe('unsaved')
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS))
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenLastCalledWith('e1', two, 1)
    expect(result.current.status).toBe('saved')

    rerender({ doc: edit(two, 3) })
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS))
    expect(save).toHaveBeenLastCalledWith('e1', expect.anything(), 2)
  })

  it('is saved again, without saving, when an edit is undone before it was saved', async () => {
    const save = vi.fn(async (_id: string, _doc: EventDoc, rev: number) => rev + 1)
    const { result, rerender } = setup(save)
    rerender({ doc: edit(base, 1) })
    expect(result.current.status).toBe('unsaved')
    rerender({ doc: base })
    expect(result.current.status).toBe('saved')
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2))
    expect(save).not.toHaveBeenCalled()
    expect(result.current.status).toBe('saved')
  })

  it('stops on a conflict until the user keeps their version, then saves over the other revision', async () => {
    const save = vi
      .fn<(id: string, doc: EventDoc, rev: number) => Promise<number>>()
      .mockRejectedValueOnce(new SaveConflict({ revision: 5, savedBy: 'Ivan', savedAt: '2026-11-19T14:32:00Z' }))
      .mockResolvedValue(6)
    const { result, rerender } = setup(save)
    rerender({ doc: edit(base, 1) })
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS))
    expect(result.current.status).toBe('conflict')
    expect(result.current.conflict?.savedBy).toBe('Ivan')

    // More edits do not save while the conflict is open.
    rerender({ doc: edit(edit(base, 1), 2) })
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 3))
    expect(save).toHaveBeenCalledTimes(1)

    await act(async () => result.current.keepMine())
    expect(save).toHaveBeenLastCalledWith('e1', expect.anything(), 5)
    expect(result.current.status).toBe('saved')
  })

  it('retries when saving fails, and says so meanwhile', async () => {
    const save = vi
      .fn<(id: string, doc: EventDoc, rev: number) => Promise<number>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(2)
    const { result, rerender } = setup(save)
    rerender({ doc: edit(base, 1) })
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS))
    expect(result.current.status).toBe('failed')
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(save).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('saved')
  })

  it('saves at once when the editor closes with unsaved changes, and opening the event waits for it', async () => {
    let finish = () => {}
    const save = vi.fn((_id: string, _doc: EventDoc, rev: number) => new Promise<number>(r => (finish = () => r(rev + 1))))
    const { rerender, unmount } = setup(save)
    const one = edit(base, 1)
    rerender({ doc: one })
    unmount()
    expect(save).toHaveBeenCalledWith('e1', one, 1)
    let opened = false
    void savesFinished('e1').then(() => (opened = true))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(opened).toBe(false)
    finish()
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(opened).toBe(true)
  })

  it('saves changes made during a save right after it once the editor has closed', async () => {
    const finish: (() => void)[] = []
    const save = vi.fn((_id: string, _doc: EventDoc, rev: number) => new Promise<number>(r => finish.push(() => r(rev + 1))))
    const { rerender, unmount } = setup(save)
    const one = edit(base, 1)
    rerender({ doc: one })
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS))
    expect(save).toHaveBeenCalledTimes(1)
    const two = edit(one, 2)
    rerender({ doc: two })
    unmount()
    finish[0]?.()
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith('e1', two, 2)
    let opened = false
    void savesFinished('e1').then(() => (opened = true))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(opened).toBe(false)
    finish[1]?.()
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(opened).toBe(true)
  })

  it('does not save when the editor closes with everything saved', async () => {
    const save = vi.fn(async (_id: string, _doc: EventDoc, rev: number) => rev + 1)
    const { unmount } = setup(save)
    unmount()
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS))
    expect(save).not.toHaveBeenCalled()
  })
})

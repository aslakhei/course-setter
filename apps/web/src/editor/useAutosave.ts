// Autosave: the document is saved 1.5 s after the last change, against the revision it was based on.
// Edits made while a save is on its way are saved after it. When someone else saved in between,
// saving stops and the conflict is handed to the editor; failures (offline) are retried.
import type { EventDoc } from '@course-setter/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { finishSaving, SaveConflict, saveEvent } from '../lib/events.ts'

export const AUTOSAVE_DELAY_MS = 1500
const RETRY_MS = 10_000

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'failed' | 'conflict'

export type Autosave = {
  status: SaveStatus
  savedAt: Date | null
  conflict: SaveConflict | null
  /** Save my version over theirs (theirs stays in the history). */
  keepMine: () => void
  /** Start over from a document and revision (after taking someone else's version). */
  reset: (doc: EventDoc, revision: number) => void
  /** The revision the last save produced (what the next save is based on). */
  revision: () => number
}

export function useAutosave(eventId: string, doc: EventDoc, initialRevision: number, save = saveEvent): Autosave {
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [conflict, setConflict] = useState<SaveConflict | null>(null)
  const revision = useRef(initialRevision)
  const savedDoc = useRef(doc)
  const latest = useRef(doc)
  const blocked = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const active = useRef<Promise<void> | null>(null)
  const closed = useRef(false)
  latest.current = doc

  /** Save the latest document once; false when it could not be saved. */
  const saveLatest = useCallback(async (): Promise<boolean> => {
    setStatus('saving')
    const toSave = latest.current
    try {
      revision.current = await save(eventId, toSave, revision.current)
      savedDoc.current = toSave
      setSavedAt(new Date())
      setStatus(latest.current === toSave ? 'saved' : 'unsaved')
      return true
    } catch (err) {
      if (err instanceof SaveConflict) {
        blocked.current = true
        setConflict(err)
        setStatus('conflict')
      } else {
        setStatus('failed')
      }
      return false
    }
  }, [eventId, save])

  /** Save now; while a save is on its way, the one already running (which saves these changes after it). */
  const run = useCallback(
    function run(): Promise<void> {
      clearTimeout(timer.current)
      if (blocked.current) return Promise.resolve()
      const saveAll = async () => {
        if (latest.current === savedDoc.current) {
          setStatus('saved') // e.g. an edit was undone before it was saved
          return
        }
        let ok = await saveLatest()
        // After the editor has closed, changes made during the save are saved straight away.
        while (ok && closed.current && !blocked.current && latest.current !== savedDoc.current) ok = await saveLatest()
        if (closed.current || blocked.current) return
        if (!ok) timer.current = setTimeout(() => void run(), RETRY_MS)
        // Changes made during the save.
        else if (latest.current !== savedDoc.current) timer.current = setTimeout(() => void run(), AUTOSAVE_DELAY_MS)
      }
      active.current ??= saveAll().finally(() => {
        active.current = null
      })
      return active.current
    },
    [saveLatest],
  )

  useEffect(() => {
    if (blocked.current) return
    if (doc === savedDoc.current) {
      // Back to what is saved (an edit undone before it was saved): nothing to save.
      clearTimeout(timer.current)
      setStatus(s => (s === 'saving' ? s : 'saved'))
      return
    }
    setStatus(s => (s === 'saving' ? s : 'unsaved'))
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void run(), AUTOSAVE_DELAY_MS)
  }, [doc, run])

  // Closing the editor (going elsewhere in the app) saves what is not saved yet, and opening the event
  // again waits for it. Leaving the page with unsaved changes: the browser asks first.
  useEffect(() => {
    closed.current = false
    const warn = (e: BeforeUnloadEvent) => {
      if (latest.current !== savedDoc.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => {
      window.removeEventListener('beforeunload', warn)
      closed.current = true
      clearTimeout(timer.current)
      if (!blocked.current && (active.current || latest.current !== savedDoc.current)) finishSaving(eventId, run())
    }
  }, [eventId, run])

  const keepMine = useCallback(() => {
    if (!conflict) return
    revision.current = conflict.revision
    blocked.current = false
    setConflict(null)
    void run()
  }, [conflict, run])

  const reset = useCallback((next: EventDoc, nextRevision: number) => {
    clearTimeout(timer.current)
    revision.current = nextRevision
    savedDoc.current = next
    latest.current = next
    blocked.current = false
    setConflict(null)
    setStatus('saved')
  }, [])

  const currentRevision = useCallback(() => revision.current, [])
  return { status, savedAt, conflict, keepMine, reset, revision: currentRevision }
}

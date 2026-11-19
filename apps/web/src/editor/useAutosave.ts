// Autosave: the document is saved 1.5 s after the last change, against the revision it was based on.
// Edits made while a save is on its way are saved right after it. When someone else saved in between,
// saving stops and the conflict is handed to the editor; failures (offline) are retried.
import type { EventDoc } from '@course-setter/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { SaveConflict, saveEvent } from '../lib/events.ts'

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
}

export function useAutosave(eventId: string, doc: EventDoc, initialRevision: number, save = saveEvent): Autosave {
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [conflict, setConflict] = useState<SaveConflict | null>(null)
  const revision = useRef(initialRevision)
  const savedDoc = useRef(doc)
  const latest = useRef(doc)
  const saving = useRef(false)
  const blocked = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  latest.current = doc

  const run = useCallback(async () => {
    clearTimeout(timer.current)
    if (saving.current || blocked.current || latest.current === savedDoc.current) return
    saving.current = true
    setStatus('saving')
    const toSave = latest.current
    try {
      revision.current = await save(eventId, toSave, revision.current)
      savedDoc.current = toSave
      setSavedAt(new Date())
      setStatus(latest.current === toSave ? 'saved' : 'unsaved')
    } catch (err) {
      if (err instanceof SaveConflict) {
        blocked.current = true
        setConflict(err)
        setStatus('conflict')
      } else {
        setStatus('failed')
        timer.current = setTimeout(() => void run(), RETRY_MS)
      }
    } finally {
      saving.current = false
    }
    // Changes made during the save.
    if (!blocked.current && latest.current !== savedDoc.current) timer.current = setTimeout(() => void run(), AUTOSAVE_DELAY_MS)
  }, [eventId, save])

  useEffect(() => {
    if (doc === savedDoc.current || blocked.current) return
    setStatus(s => (s === 'saving' ? s : 'unsaved'))
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void run(), AUTOSAVE_DELAY_MS)
  }, [doc, run])

  // Leaving with unsaved changes: the browser asks first.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (latest.current !== savedDoc.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => {
      window.removeEventListener('beforeunload', warn)
      clearTimeout(timer.current)
    }
  }, [])

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

  return { status, savedAt, conflict, keepMine, reset }
}

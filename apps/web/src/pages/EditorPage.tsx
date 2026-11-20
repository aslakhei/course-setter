import {
  addCourse,
  deleteControl,
  deleteSpecial,
  type EventDoc,
  moveControl,
  moveDocToVersion,
  type Point,
  parseDoc,
  removeCourseControl,
  setNumberPosition,
  setRoute,
  setSpecialPoints,
  transformBetween,
} from '@course-setter/core'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { Button, ErrorMessage, Loading } from '../components/ui.tsx'
import { CoursePanel, stopName } from '../editor/CoursePanel.tsx'
import { onMap } from '../editor/courseLayer.ts'
import { AccessDialog, ConflictDialog, MoveDialog } from '../editor/Dialogs.tsx'
import { EditorMap, type Hover } from '../editor/EditorMap.tsx'
import {
  addBend,
  clickAction,
  currentCourse,
  initialState,
  isDrawingTool,
  isSpecialTool,
  moveBend,
  reducer,
  removeBend,
  shapeOf,
  type Tool,
} from '../editor/state.ts'
import { Toolbar } from '../editor/Toolbar.tsx'
import { type SaveStatus, useAutosave } from '../editor/useAutosave.ts'
import { type Member, useMembers } from '../lib/api.ts'
import { type EventDetail, eventKeys, fetchEvent, moveEvent, SaveConflict, saveAsCopy, useEvent } from '../lib/events.ts'
import { formatScale } from '../lib/format.ts'
import { type MapVersionDetail, useMaps, useMapVersion, useTilesUrl, useVersionLinks } from '../lib/maps.ts'

/** /clubs/:clubId/events/:eventId: the course editor (full window, below the app's top bar). */
export function EditorPage() {
  const { t } = useTranslation()
  const { clubId = '', eventId = '' } = useParams()
  const event = useEvent(eventId)
  const version = useMapVersion(event.data?.mapVersionId)
  const tilesUrl = useTilesUrl(version.data?.tilesPath)
  const members = useMembers(clubId)

  if (event.isError || version.isError || tilesUrl.isError || members.isError) {
    return (
      <main className="mx-auto max-w-[1200px] px-5 py-6">
        <ErrorMessage>{t('common.error')}</ErrorMessage>
      </main>
    )
  }
  if (event.data === null) {
    return (
      <main className="mx-auto flex max-w-[1200px] flex-col items-start gap-2 px-5 py-6">
        <p className="m-0">{t('events.notFound')}</p>
        <Link to={`/clubs/${clubId}/events`}>{t('events.backToEvents')}</Link>
      </main>
    )
  }
  if (!event.data || !version.data?.tiles || !tilesUrl.data || !members.data) return <Loading label={t('common.loading')} />
  // A move to another map version starts the editor afresh on that version.
  return (
    <Editor
      key={`${event.data.id}:${event.data.mapVersionId}`}
      event={event.data}
      version={version.data}
      tilesUrl={tilesUrl.data}
      members={members.data}
    />
  )
}

function Editor({
  event,
  version,
  tilesUrl,
  members,
}: {
  event: EventDetail
  version: MapVersionDetail
  tilesUrl: string
  members: Member[]
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const mapScale = version.scale ?? 15000
  const initialDoc = useMemo(() => parseDoc(event.doc, mapScale), [event.doc, mapScale])
  const [state, dispatch] = useReducer(reducer, initialDoc, initialState)
  const doc = state.history.present
  const course = currentCourse(state)
  const autosave = useAutosave(event.id, doc, event.revision)
  const [accessOpen, setAccessOpen] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const maps = useMaps(event.clubId)
  const mapName = maps.data?.find(m => m.id === version.mapId)?.name ?? ''
  const queryClient = useQueryClient()

  // A newer ready version of the map, and whether the courses can be moved to it.
  const links = useVersionLinks(version.mapId)
  const newer = (links.data ?? []).filter(v => v.status === 'ready' && v.version > version.version).sort((a, b) => b.version - a.version)[0]
  const toNewer = newer && links.data ? transformBetween(links.data, version.id, newer.id) : null
  const [moveOpen, setMoveOpen] = useState(false)
  const [moving, setMoving] = useState(false)
  const [moveError, setMoveError] = useState<string | null>(null)
  const moved = useMemo(() => (toNewer && newer?.tiles ? moveDocToVersion(doc, toNewer, newer.tiles.extent) : null), [doc, toNewer, newer])

  const moveToNewer = async () => {
    if (!moved || !newer) return
    setMoving(true)
    setMoveError(null)
    try {
      await moveEvent(event.id, newer.id, moved.doc, autosave.revision())
      // The editor reopens on the new version (its key includes the map version).
      await queryClient.invalidateQueries({ queryKey: eventKeys.detail(event.id) })
    } catch (err) {
      setMoveError(err instanceof SaveConflict ? t('editor.newVersion.conflict') : t('common.error'))
      setMoving(false)
    }
  }

  const edit = useCallback((next: EventDoc, select?: string | null) => dispatch({ type: 'edit', doc: next, select }), [])

  const onClick = (point: Point, hit: string | null, leg: { leg: number; segment: number } | null, tolerance: number) => {
    setNotice(null)
    if (state.tool === 'bend') {
      if (course && leg) edit(addBend(doc, course, leg.leg, leg.segment, point))
      return
    }
    if (state.tool !== 'select' && !hit && !onMap(version.tiles as NonNullable<typeof version.tiles>, point)) {
      setNotice(t('editor.outsideMap'))
      return
    }
    const action = clickAction(state, point, hit, () => crypto.randomUUID(), tolerance)
    if (action) dispatch(action)
  }

  // Keyboard: undo/redo, delete the selection, Escape back to selecting.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Leave keys alone only while typing (a text field) or in a dialog; a focused button, drop-down or
      // the map still gets the shortcuts.
      const target = e.target as HTMLElement
      const typing =
        target.closest('textarea, [contenteditable="true"]') ||
        (target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit'].includes(target.type))
      if (typing || target.closest('[role="dialog"]')) return
      const mod = e.ctrlKey || e.metaKey
      // Drawing a line or area: Enter finishes it, Backspace takes back the last point, Escape drops it.
      if (state.draft.length > 0) {
        if (e.key === 'Enter') {
          e.preventDefault()
          dispatch({ type: 'finishDraft', id: crypto.randomUUID() })
          return
        }
        if (e.key === 'Backspace') {
          e.preventDefault()
          dispatch({ type: 'draft', points: state.draft.slice(0, -1) })
          return
        }
        if (e.key === 'Escape') {
          dispatch({ type: 'draft', points: [] })
          return
        }
      }
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' })
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        dispatch({ type: 'redo' })
      } else if (e.key === 'Escape') {
        dispatch({ type: 'tool', tool: 'select' })
        dispatch({ type: 'select', controlId: null })
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected) {
        e.preventDefault()
        if (doc.specials.some(s => s.id === state.selected)) {
          edit(deleteSpecial(doc, state.selected), null)
        } else if (course) {
          const index = course.controls.lastIndexOf(state.selected)
          if (index >= 0) edit(removeCourseControl(doc, course.id, index))
        } else {
          const control = doc.controls.find(c => c.id === state.selected)
          if (control && window.confirm(t('editor.deleteControlConfirm', { name: stopName(control, t) })))
            edit(deleteControl(doc, control.id), null)
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [state, course, doc, edit, t])

  const takeTheirs = async () => {
    setResolving(true)
    try {
      await saveAsCopy(event, t('editor.conflict.copyName', { name: event.name }), doc)
      const theirs = await fetchEvent(event.id)
      if (!theirs) return navigate(`/clubs/${event.clubId}/events`)
      if (theirs.mapVersionId !== event.mapVersionId) {
        // They moved the event to another map version: reopen the editor there.
        queryClient.setQueryData(eventKeys.detail(event.id), theirs)
        return
      }
      const theirDoc = parseDoc(theirs.doc, mapScale)
      dispatch({ type: 'load', doc: theirDoc })
      autosave.reset(theirDoc, theirs.revision)
    } finally {
      setResolving(false)
    }
  }

  const inCourse = course ? t('editor.hint.inCourse', { course: course.name }) : ''
  const snapped = hover?.snapTo ? doc.controls.find(c => c.id === hover.snapTo) : undefined
  // A selected special symbol or marked route: moved and reshaped by its points.
  const selectedShape = shapeOf(doc, state.selected)
  const toolHint = (tool: Tool): string => {
    if (tool === 'select') {
      if (selectedShape && selectedShape.geometry !== 'point') return t('editor.hint.selectSpecial')
      return course ? t('editor.hint.select', { course: course.name }) : t('editor.hint.selectAll')
    }
    if (tool === 'optionalCrossing') return t('editor.hint.optionalCrossing')
    if (isSpecialTool(tool)) {
      const name = t(`editor.tools.${tool}`).toLowerCase()
      return isDrawingTool(tool) ? t('editor.hint.drawSpecial', { name }) : t('editor.hint.placeSpecial', { name })
    }
    return t(`editor.hint.${tool}`, { inCourse })
  }
  const hint =
    notice ?? (snapped && course ? t('editor.hint.reuse', { name: stopName(snapped, t), course: course.name }) : toolHint(state.tool))

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      <header className="flex flex-col bg-white">
        <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft px-4 py-1.5">
          <Link to={`/clubs/${event.clubId}/events`} className="text-[13px]">
            {t('events.heading')}
          </Link>
          <h1 className="m-0 text-base font-semibold">{event.name}</h1>
          <span className="text-[13px] text-muted">
            {mapName} · {t('maps.version', { number: version.version })} · {formatScale(mapScale)}
          </span>
          {newer &&
            (toNewer ? (
              <span className="flex items-center gap-2 rounded bg-brand-50 px-2 py-1 text-[13px]">
                {t('editor.newVersion.available', { number: newer.version })}
                <Button size="sm" variant="primary" onClick={() => setMoveOpen(true)}>
                  {t('editor.newVersion.move', { number: newer.version })}
                </Button>
              </span>
            ) : (
              <span className="text-[13px] text-muted">{t('editor.newVersion.notLinedUp', { number: newer.version })}</span>
            ))}
          <span className="grow" />
          <SaveState status={autosave.status} savedAt={autosave.savedAt} />
          <Button onClick={() => setAccessOpen(true)}>{t('editor.invite')}</Button>
        </div>
        <Toolbar
          standard={doc.standard}
          tool={state.tool}
          onTool={tool => dispatch({ type: 'tool', tool })}
          canUndo={state.history.past.length > 0}
          canRedo={state.history.future.length > 0}
          onUndo={() => dispatch({ type: 'undo' })}
          onRedo={() => dispatch({ type: 'redo' })}
          hint={hint}
        />
      </header>
      <div className="flex min-h-0 grow flex-wrap border-t border-line">
        <main className="relative min-h-[360px] min-w-0 flex-[999_1_560px]">
          <EditorMap
            versionId={version.id}
            grid={version.tiles as NonNullable<typeof version.tiles>}
            tilesUrl={tilesUrl}
            mapScale={mapScale}
            doc={doc}
            course={course}
            selected={state.selected}
            tool={state.tool}
            draft={state.draft}
            onClick={onClick}
            onMoveShape={(id, points) =>
              edit(doc.specials.some(s => s.id === id) ? setSpecialPoints(doc, id, points) : setRoute(doc, id, points))
            }
            onMoveControl={(id, point) => edit(moveControl(doc, id, point))}
            onMoveBend={(key, index, point) => course && edit(moveBend(doc, course, key, index, point))}
            onRemoveBend={(key, index) => course && edit(removeBend(doc, course, key, index))}
            onMoveNumber={(id, offset) => course && edit(setNumberPosition(doc, course.id, id, offset))}
            onHover={setHover}
          />
        </main>
        <CoursePanel
          state={state}
          eventName={event.name}
          onCourse={courseId => dispatch({ type: 'course', courseId })}
          onSelect={controlId => dispatch({ type: 'select', controlId })}
          onEdit={edit}
          onNewCourse={name => {
            const id = crypto.randomUUID()
            edit(addCourse(doc, { id, name, printScale: mapScale }))
            dispatch({ type: 'course', courseId: id })
          }}
        />
      </div>
      {autosave.conflict && (
        <ConflictDialog
          conflict={autosave.conflict}
          canKeepMine={!autosave.conflict.mapVersionId || autosave.conflict.mapVersionId === event.mapVersionId}
          eventName={event.name}
          busy={resolving}
          onKeepMine={autosave.keepMine}
          onUseTheirs={() => void takeTheirs()}
        />
      )}
      {moveOpen && newer && moved && (
        <MoveDialog
          number={newer.version}
          outside={moved.outside.map(id => {
            const control = doc.controls.find(c => c.id === id)
            return control ? stopName(control, t) : id
          })}
          waitingForSave={autosave.status !== 'saved'}
          busy={moving}
          error={moveError}
          onMove={() => void moveToNewer()}
          onCancel={() => setMoveOpen(false)}
        />
      )}
      {accessOpen && <AccessDialog event={event} clubMembers={members} onClose={() => setAccessOpen(false)} />}
    </div>
  )
}

const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

function SaveState({ status, savedAt }: { status: SaveStatus; savedAt: Date | null }) {
  const { t } = useTranslation()
  const text =
    status === 'saved' && savedAt ? t('editor.status.savedAt', { time: timeFormat.format(savedAt) }) : t(`editor.status.${status}`)
  return (
    <span
      role="status"
      data-testid="save-status"
      className={`text-[13px] ${status === 'failed' || status === 'conflict' ? 'text-danger' : 'text-muted'}`}
    >
      {text}
    </span>
  )
}

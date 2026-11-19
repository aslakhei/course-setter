import { addCourse, deleteControl, type EventDoc, moveControl, type Point, parseDoc, removeCourseControl } from '@course-setter/core'
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { Button, ErrorMessage, Loading } from '../components/ui.tsx'
import { CoursePanel, stopName } from '../editor/CoursePanel.tsx'
import { onMap } from '../editor/courseLayer.ts'
import { AccessDialog, ConflictDialog } from '../editor/Dialogs.tsx'
import { EditorMap } from '../editor/EditorMap.tsx'
import { addBend, clickAction, currentCourse, initialState, moveBend, reducer, removeBend } from '../editor/state.ts'
import { Toolbar } from '../editor/Toolbar.tsx'
import { type SaveStatus, useAutosave } from '../editor/useAutosave.ts'
import { type Member, useMembers } from '../lib/api.ts'
import { type EventDetail, fetchEvent, saveAsCopy, useEvent } from '../lib/events.ts'
import { formatScale } from '../lib/format.ts'
import { type MapVersionDetail, useMaps, useMapVersion, useTilesUrl } from '../lib/maps.ts'

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
  return <Editor key={event.data.id} event={event.data} version={version.data} tilesUrl={tilesUrl.data} members={members.data} />
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
  const maps = useMaps(event.clubId)
  const mapName = maps.data?.find(m => m.id === version.mapId)?.name ?? ''

  const edit = useCallback((next: EventDoc, select?: string | null) => dispatch({ type: 'edit', doc: next, select }), [])

  const onClick = (point: Point, hit: string | null, leg: { leg: number; segment: number } | null) => {
    setNotice(null)
    if (state.tool === 'bend') {
      if (course && leg) edit(addBend(doc, course, leg.leg, leg.segment, point))
      return
    }
    if (state.tool !== 'select' && !hit && !onMap(version.tiles as NonNullable<typeof version.tiles>, point)) {
      setNotice(t('editor.outsideMap'))
      return
    }
    const action = clickAction(state, point, hit, () => crypto.randomUUID())
    if (action) dispatch(action)
  }

  // Keyboard: undo/redo, delete the selection, Escape back to selecting.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, select, textarea, [role="dialog"]')) return
      const mod = e.ctrlKey || e.metaKey
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
        if (course) {
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
  }, [state.selected, course, doc, edit, t])

  const takeTheirs = async () => {
    setResolving(true)
    try {
      await saveAsCopy(event, t('editor.conflict.copyName', { name: event.name }), doc)
      const theirs = await fetchEvent(event.id)
      if (!theirs) return navigate(`/clubs/${event.clubId}/events`)
      const theirDoc = parseDoc(theirs.doc, mapScale)
      dispatch({ type: 'load', doc: theirDoc })
      autosave.reset(theirDoc, theirs.revision)
    } finally {
      setResolving(false)
    }
  }

  const inCourse = course ? t('editor.hint.inCourse', { course: course.name }) : ''
  const hint = notice ?? t(`editor.hint.${state.tool}`, { inCourse })

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
          <span className="grow" />
          <SaveState status={autosave.status} savedAt={autosave.savedAt} />
          <Button onClick={() => setAccessOpen(true)}>{t('editor.invite')}</Button>
        </div>
        <Toolbar
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
            onClick={onClick}
            onMoveControl={(id, point) => edit(moveControl(doc, id, point))}
            onMoveBend={(key, index, point) => course && edit(moveBend(doc, course, key, index, point))}
            onRemoveBend={(key, index) => course && edit(removeBend(doc, course, key, index))}
          />
        </main>
        <CoursePanel
          state={state}
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
          eventName={event.name}
          busy={resolving}
          onKeepMine={autosave.keepMine}
          onUseTheirs={() => void takeTheirs()}
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

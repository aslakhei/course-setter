import {
  ALL_CONTROLS,
  addCourse,
  addWhiteArea,
  allControlsCourse,
  type Course,
  changePaper,
  changePrintSize,
  defaultPrintSettings,
  deleteControl,
  deleteSpecial,
  type EventDoc,
  fieldValues,
  moveControl,
  moveDocToVersion,
  moveNodes,
  type PageContext,
  type Point,
  type PrintSettings,
  pageSize,
  parseDoc,
  printPage,
  printSettingsOf,
  removeCourseControl,
  removeNode,
  setNumberPosition,
  setPrintSettings,
  setRoute,
  setSpecialPoints,
  showDescriptions,
  specForBox,
  transformBetween,
  updateWhiteArea,
} from '@course-setter/core'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { Button, ErrorMessage, Loading } from '../components/ui.tsx'
import { CoursePanel, stopName } from '../editor/CoursePanel.tsx'
import { onMap } from '../editor/courseLayer.ts'
import { AccessDialog, ConflictDialog, MoveDialog } from '../editor/Dialogs.tsx'
import { EditorMap, type Hover } from '../editor/EditorMap.tsx'
import { LayoutPanel, MAP_LAYER } from '../editor/LayoutPanel.tsx'
import { LayoutProperties } from '../editor/LayoutProperties.tsx'
import {
  type AppliesTo,
  areaCoordinates,
  nextSelection,
  nudged,
  type Pen,
  placeElement,
  placeMany,
  removeArea,
  removeMany,
  shownElement,
  whiteAreaOf,
} from '../editor/layout.ts'
import { type LayoutEditing, PrintMap } from '../editor/PrintMap.tsx'
import { PrintPanel, PrintToolbar } from '../editor/PrintView.tsx'
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
import { type Member, useClub, useMembers } from '../lib/api.ts'
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
  const club = useClub(event.clubId)
  // What the print layout's fields need besides the document: the event's date, the club, the setter
  // (whoever created the event) and the map's details.
  const pageContext = useMemo<PageContext>(
    () => ({
      eventDate: event.date,
      clubName: club.data?.name ?? null,
      setter: members.find(m => m.userId === event.createdBy)?.name ?? null,
      map: { name: mapName, contour: version.contourInterval, mapper: version.mapper, year: version.year },
    }),
    [event.date, event.createdBy, club.data?.name, members, mapName, version.contourInterval, version.mapper, version.year],
  )
  const queryClient = useQueryClient()

  // The print view (?view=print): a course's page on the map, and making PDFs. It shows the course being
  // edited, or the first one.
  const [params, setParams] = useSearchParams()
  // In the all-controls view, the page of every control (for setting them out).
  const allPage = useMemo(() => allControlsCourse(doc), [doc])
  const hasControls = doc.controls.length > 0
  const printCourse = course ?? (hasControls ? allPage : (doc.courses[0] ?? null))
  const printPages = useMemo(() => [...doc.courses, ...(hasControls ? [allPage] : [])], [doc.courses, hasControls, allPage])
  const grid = version.tiles as NonNullable<typeof version.tiles>
  // An empty course's page is centred on the map, as the worker does.
  const settingsOf = useCallback(
    (c: Course) => {
      const centre: Point = [(grid.extent.minX + grid.extent.maxX) / 2, (grid.extent.minY + grid.extent.maxY) / 2]
      return printSettingsOf(doc, c, event.name, centre)
    },
    [doc, event.name, grid],
  )
  // Worked out once per change: the defaults of a course without its own settings are a new object each time.
  const printSettings = useMemo(() => (printCourse ? settingsOf(printCourse) : null), [printCourse, settingsOf])
  // The IOF XML file: positions in mm on the map, at the map's scale.
  const courseData = useMemo(
    () => ({ eventName: event.name, date: event.date, mapScale, extent: grid.extent }),
    [event.name, event.date, mapScale, grid],
  )
  const printing = params.get('view') === 'print' && printCourse !== null && printSettings !== null
  const setPrint = (c: Course, settings: PrintSettings | null) => edit(setPrintSettings(doc, c.id, settings))
  // Layout mode (?view=print&mode=layout): the page's elements, edited on the page.
  const layoutMode = printing && params.get('mode') === 'layout'
  const [layoutSelected, setLayoutSelected] = useState<string[]>([])
  // Drawing a white area with the pen, and the selected point of a selected white area.
  const [pen, setPen] = useState<Pen | null>(null)
  const [layoutNode, setLayoutNode] = useState<number | null>(null)
  // Selecting anything lets go of a white area's selected point.
  const selectLayout = useCallback((id: string | null, additive = false) => {
    setLayoutSelected(old => nextSelection(old, id, additive, MAP_LAYER))
    setLayoutNode(null)
  }, [])
  const [appliesTo, setAppliesTo] = useState<AppliesTo>('all')
  useEffect(() => {
    if (!layoutMode) setPen(null)
  }, [layoutMode])
  const finishPen = useCallback(() => {
    if (!pen || pen.nodes.length < 3 || !printCourse || !printSettings) return
    const id = crypto.randomUUID()
    dispatch({ type: 'edit', doc: addWhiteArea(doc, printCourse.id, printSettings, { id, on: pen.on, nodes: pen.nodes }) })
    setPen(null)
    setLayoutSelected([id])
    setLayoutNode(null)
  }, [pen, printCourse, printSettings, doc])
  const shownPage = useMemo(
    () => (printCourse && printSettings ? printPage(doc, printCourse, event.name, printSettings, pageContext) : null),
    [doc, printCourse, printSettings, event.name, pageContext],
  )
  const layoutEditing = useMemo((): LayoutEditing | null => {
    if (!layoutMode || !printCourse || !printSettings) return null
    const size = pageSize(printSettings.paper, printSettings.orientation)
    return {
      selected: layoutSelected,
      onSelect: selectLayout,
      place: (id, box) => {
        const spec = shownElement(doc, printSettings, id)
        return spec ? placeElement(doc, printCourse, printSettings, appliesTo, specForBox(spec, box, size)) : doc
      },
      onEdit: next => dispatch({ type: 'edit', doc: next }),
      pen,
      onPen: setPen,
      onPenDone: finishPen,
      setAreaNodes: (id, nodes) => updateWhiteArea(doc, printCourse.id, printSettings, id, a => ({ ...a, nodes })),
      selectedNode: layoutNode,
      onSelectNode: setLayoutNode,
      aspectOf: id => {
        const placed = shownPage?.elements.find(e => e.id === id)
        if (placed?.kind !== 'image') return undefined
        const b = placed.box
        return (b.maxX - b.minX) / (b.maxY - b.minY)
      },
    }
  }, [layoutMode, printCourse, printSettings, layoutSelected, selectLayout, doc, appliesTo, shownPage, pen, finishPen, layoutNode])
  const openPrint = () => {
    dispatch({ type: 'tool', tool: 'select' })
    if (!course && printCourse && printCourse.id !== ALL_CONTROLS) dispatch({ type: 'course', courseId: printCourse.id })
    setParams({ view: 'print' })
  }

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
      // Layout mode: arrow keys move the selected elements (Shift: 5 mm), Delete removes them (only this
      // course: hides them there), Escape lets go of them.
      // Drawing a white area: Enter closes it, Backspace takes back the last point, Escape stops.
      if (layoutMode && pen && !mod) {
        if (e.key === 'Enter') {
          e.preventDefault()
          finishPen()
          return
        }
        if (e.key === 'Backspace') {
          e.preventDefault()
          setPen({ ...pen, nodes: pen.nodes.slice(0, -1) })
          return
        }
        if (e.key === 'Escape') {
          setPen(null)
          return
        }
      }
      const chosen = layoutSelected.filter(id => id !== MAP_LAYER)
      // A selected white area: arrow keys move it, Delete removes its selected point (or the area), Escape lets go.
      const area =
        layoutMode && printCourse && printSettings && chosen.length === 1 ? whiteAreaOf(doc, printSettings, chosen[0] ?? '') : undefined
      if (area && printCourse && printSettings && !mod) {
        const step = e.shiftKey ? 5 : 1
        const arrows: Record<string, [number, number]> = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, step],
          ArrowDown: [0, -step],
        }
        const delta = arrows[e.key]
        if (delta && !area.locked) {
          e.preventDefault()
          const d = areaCoordinates(printCourse, printSettings).delta(area.on, delta)
          edit(updateWhiteArea(doc, printCourse.id, printSettings, area.id, a => ({ ...a, nodes: moveNodes(a.nodes, d) })))
          return
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault()
          if (layoutNode !== null && area.nodes.length > 3 && !area.locked) {
            edit(updateWhiteArea(doc, printCourse.id, printSettings, area.id, a => ({ ...a, nodes: removeNode(a.nodes, layoutNode) })))
            setLayoutNode(null)
          } else if (layoutNode === null) {
            edit(removeArea(doc, printCourse, printSettings, appliesTo, area.id))
            if (printSettings.ownLayout || appliesTo === 'all') setLayoutSelected([])
          }
          return
        }
        if (e.key === 'Escape') {
          if (layoutNode !== null) setLayoutNode(null)
          else setLayoutSelected([])
          return
        }
      }
      if (layoutMode && !mod && printCourse && printSettings && chosen.length > 0) {
        const specs = chosen.flatMap(id => shownElement(doc, printSettings, id) ?? [])
        const step = e.shiftKey ? 5 : 1
        const arrows: Record<string, [number, number]> = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, step],
          ArrowDown: [0, -step],
        }
        const delta = arrows[e.key]
        const movable = specs.filter(spec => !spec.locked)
        if (delta && movable.length > 0) {
          e.preventDefault()
          edit(
            placeMany(
              doc,
              printCourse,
              printSettings,
              appliesTo,
              movable.map(spec => nudged(spec, delta)),
            ),
          )
          return
        }
        if (specs.length > 0 && (e.key === 'Delete' || e.key === 'Backspace')) {
          e.preventDefault()
          edit(
            removeMany(
              doc,
              printCourse,
              printSettings,
              appliesTo,
              specs.map(spec => spec.id),
            ),
          )
          if (printSettings.ownLayout || appliesTo === 'all') setLayoutSelected([])
          return
        }
        if (e.key === 'Escape') {
          setLayoutSelected([])
          return
        }
      }
      // The print view has nothing else to delete or draw: only undo and redo.
      if (printing && !mod) return
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
  }, [state, course, doc, edit, t, printing, layoutMode, printCourse, printSettings, layoutSelected, appliesTo, pen, finishPen, layoutNode])

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
          {!printing && (
            <Button onClick={openPrint} disabled={printCourse === null}>
              {t('print.open')}
            </Button>
          )}
          <Button onClick={() => setAccessOpen(true)}>{t('editor.invite')}</Button>
        </div>
        {printing ? (
          <PrintToolbar
            pages={printPages}
            course={printCourse}
            settings={printSettings}
            onCourse={courseId => dispatch({ type: 'course', courseId })}
            onPaper={(paper, orientation) =>
              setPrint(printCourse, changePaper(doc, printCourse, event.name, printSettings, paper, orientation))
            }
            onScale={printScale => edit(changePrintSize(doc, printCourse.id, event.name, { printScale }))}
            onCellSize={descriptionCellSize => edit(changePrintSize(doc, printCourse.id, event.name, { descriptionCellSize }))}
            onDescriptions={show => setPrint(printCourse, showDescriptions(doc, printCourse, event.name, printSettings, show))}
            onReset={() => {
              // The page's placement goes back to the defaults; the course's layout changes stay.
              const { overrides, ownLayout } = printSettings
              if (!overrides && !ownLayout) return setPrint(printCourse, null)
              const centre: Point = [(grid.extent.minX + grid.extent.maxX) / 2, (grid.extent.minY + grid.extent.maxY) / 2]
              const defaults = defaultPrintSettings(doc, printCourse, event.name, centre)
              setPrint(printCourse, { ...defaults, ...(overrides ? { overrides } : {}), ...(ownLayout ? { ownLayout } : {}) })
            }}
            onBack={() => setParams({})}
            mode={layoutMode ? 'layout' : 'page'}
            onMode={m => setParams(m === 'layout' ? { view: 'print', mode: 'layout' } : { view: 'print' })}
          />
        ) : (
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
        )}
      </header>
      <div className="flex min-h-0 grow flex-wrap border-t border-line">
        {layoutMode && (
          <LayoutPanel
            doc={doc}
            course={printCourse}
            settings={printSettings}
            appliesTo={appliesTo}
            selected={layoutSelected}
            onSelect={selectLayout}
            clubId={event.clubId}
            eventId={event.id}
            onEdit={next => edit(next)}
            penActive={pen !== null}
            onStartPen={() => {
              setPen({ on: 'map', nodes: [] })
              setLayoutSelected([])
            }}
            descriptionsShown={printSettings.layout.some(e => e.kind === 'descriptions')}
            values={fieldValues(doc, printCourse, event.name, pageContext)}
            onDescriptions={show => setPrint(printCourse, showDescriptions(doc, printCourse, event.name, printSettings, show))}
          />
        )}
        <main className="relative min-h-[360px] min-w-0 flex-[999_1_560px]">
          {printing ? (
            <PrintMap
              versionId={version.id}
              grid={grid}
              tilesUrl={tilesUrl}
              doc={doc}
              course={printCourse}
              title={event.name}
              context={pageContext}
              settings={printSettings}
              onChange={settings => setPrint(printCourse, settings)}
              layout={layoutEditing}
            />
          ) : (
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
          )}
        </main>
        {layoutMode && shownPage ? (
          <LayoutProperties
            doc={doc}
            course={printCourse}
            settings={printSettings}
            size={shownPage.size}
            placed={shownPage.elements}
            appliesTo={appliesTo}
            onAppliesTo={setAppliesTo}
            pen={pen}
            onPen={setPen}
            onPenDone={finishPen}
            selected={layoutSelected}
            onSelect={selectLayout}
            clubId={event.clubId}
            eventId={event.id}
            onEdit={next => edit(next)}
          />
        ) : printing ? (
          <PrintPanel
            eventId={event.id}
            doc={doc}
            pages={printPages}
            shown={printCourse}
            saveStatus={autosave.status}
            settingsOf={settingsOf}
            courseData={courseData}
            onShow={courseId => dispatch({ type: 'course', courseId })}
          />
        ) : (
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
        )}
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

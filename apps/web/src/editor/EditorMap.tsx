// The editor's map: the map version's tiles, the course being edited (or all controls), the rest of
// the control pool faintly (to reuse), the selection, a preview of what a click will place, and pointer
// handling for the tools.
import 'ol/ol.css'
import {
  allControlsDrawing,
  type ControlKind,
  type Course,
  courseDrawing,
  type EventDoc,
  legKey,
  moveControl,
  nextFreeCode,
  type Point,
  type Primitive,
  setNumberPosition,
  symbolSizes,
  type TileGrid,
  toPaperMm,
} from '@course-setter/core'
import { defaults as defaultControls, ScaleLine } from 'ol/control.js'
import Feature from 'ol/Feature.js'
import { Point as OlPoint } from 'ol/geom.js'
import { defaults as defaultInteractions } from 'ol/interaction/defaults.js'
import PointerInteraction from 'ol/interaction/Pointer.js'
import TileLayer from 'ol/layer/Tile.js'
import VectorLayer from 'ol/layer/Vector.js'
import OlMap from 'ol/Map.js'
import type MapBrowserEvent from 'ol/MapBrowserEvent.js'
import VectorSource from 'ol/source/Vector.js'
import { Fill, RegularShape, Stroke, Style } from 'ol/style.js'
import View from 'ol/View.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { extentOf, projectionFor, tileSource } from '../components/MapViewer.tsx'
import { COURSE_PURPLE, primitiveFeatures, replaceFeatures } from './courseLayer.ts'
import { legAt, type Tool } from './state.ts'

/** The selected control (and a control a click would reuse) is drawn in this colour instead of purple. */
export const HIGHLIGHT = '#0b62a4'
/** Extra pick radius around a symbol, in screen pixels. */
const PICK_PX = 6

const placing = (tool: Tool): tool is ControlKind => tool !== 'select' && tool !== 'bend'

type Drag =
  | { kind: 'control'; id: string; point: Point; from: Point }
  | { kind: 'bend'; key: string; index: number; point: Point; from: Point }
  /** `startMm`: where the number was, in paper mm, when the drag began. */
  | { kind: 'number'; id: string; point: Point; from: Point; startMm: Point }

/** Where the pointer is while placing: `snapTo` is an existing control the click would reuse. */
export type Hover = { point: Point; snapTo: string | null }

type Props = {
  versionId: string
  grid: TileGrid
  tilesUrl: string
  mapScale: number
  doc: EventDoc
  course: Course | null
  selected: string | null
  tool: Tool
  onClick: (point: Point, hit: string | null, leg: { leg: number; segment: number } | null) => void
  onMoveControl: (id: string, point: Point) => void
  onMoveNumber: (id: string, offsetMm: Point) => void
  onMoveBend: (key: string, index: number, point: Point) => void
  /** A bend point clicked (not dragged) with the bend tool. */
  onRemoveBend: (key: string, index: number) => void
  onHover: (hover: Hover | null) => void
}

const crosshairStyles = [
  new Style({ image: new RegularShape({ points: 4, radius: 9, radius2: 0, angle: 0, stroke: new Stroke({ color: '#fff', width: 4 }) }) }),
  new Style({
    image: new RegularShape({ points: 4, radius: 8, radius2: 0, angle: 0, stroke: new Stroke({ color: HIGHLIGHT, width: 2 }) }),
  }),
]

export function EditorMap(props: Props) {
  const { versionId, grid, tilesUrl, mapScale, doc, course, selected, tool } = props
  const { t } = useTranslation()
  const target = useRef<HTMLDivElement>(null)
  const sources = useRef({ pool: new VectorSource(), course: new VectorSource(), overlay: new VectorSource() })
  const [drag, setDrag] = useState<Drag | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const latest = useRef(props)
  latest.current = props

  const printScale = course?.printScale ?? mapScale
  const sizes = symbolSizes(doc.standard, printScale)
  /** Pick radius of a control symbol in metres (outer finish radius at the print scale). */
  const symbolRadius = (sizes.finishOuter / 2) * (printScale / 1000)
  const latestRadius = useRef(symbolRadius)
  latestRadius.current = symbolRadius

  // While dragging, draw the moved state without recording it.
  const shown = useMemo(() => {
    if (!drag) return doc
    const delta: Point = [drag.point[0] - drag.from[0], drag.point[1] - drag.from[1]]
    if (drag.kind === 'control') {
      const original = doc.controls.find(c => c.id === drag.id)?.position
      return original ? moveControl(doc, drag.id, [original[0] + delta[0], original[1] + delta[1]]) : doc
    }
    if (!course) return doc
    if (drag.kind === 'number') return setNumberPosition(doc, course.id, drag.id, numberOffset(doc, course, drag))
    const bends = (course.bends[drag.key] ?? []).map((p, i) => (i === drag.index ? drag.point : p))
    return { ...doc, courses: doc.courses.map(c => (c.id === course.id ? { ...c, bends: { ...c.bends, [drag.key]: bends } } : c)) }
  }, [doc, drag, course])
  const shownCourse = course ? (shown.courses.find(c => c.id === course.id) ?? null) : null

  // The map itself, once per version.
  useEffect(() => {
    if (!target.current) return
    const extent = extentOf(grid)
    const projection = projectionFor(versionId, grid)
    const finest = grid.levels.at(-1)?.resolution ?? 1
    const map = new OlMap({
      target: target.current,
      layers: [
        new TileLayer({ source: tileSource(grid, tilesUrl, projection) }),
        new VectorLayer({ source: sources.current.pool, className: 'course-layer', opacity: 0.4, updateWhileInteracting: true }),
        new VectorLayer({ source: sources.current.course, className: 'course-layer', updateWhileInteracting: true }),
        new VectorLayer({ source: sources.current.overlay, updateWhileInteracting: true }),
      ],
      view: new View({
        projection,
        resolutions: [...grid.levels.map(l => l.resolution), finest / 2, finest / 4],
        extent,
        constrainOnlyCenter: true,
      }),
      controls: defaultControls({ rotate: false, attribution: false }).extend([
        new ScaleLine({ units: 'metric', bar: true, text: false, minWidth: 120 }),
      ]),
      interactions: defaultInteractions({ doubleClickZoom: false }),
    })
    map.getView().fit(extent, { padding: [24, 24, 24, 24] })
    const resolution = () => map.getView().getResolution() ?? 1

    /** The control under the pointer; while placing, only controls of the kind being placed count. */
    const hitControl = (coordinate: Point, kind?: ControlKind): string | null => {
      const { doc: d, course: c } = latest.current
      const r = latestRadius.current + PICK_PX * resolution()
      const near = d.controls
        .filter(control => !kind || control.kind === kind)
        .map(control => ({
          id: control.id,
          distance: Math.hypot(control.position[0] - coordinate[0], control.position[1] - coordinate[1]),
        }))
        .filter(x => x.distance <= r)
        .sort((a, b) => a.distance - b.distance)
      // In a course, its own stops win over pool controls at the same place.
      return (c && near.find(x => c.controls.includes(x.id))?.id) || near[0]?.id || null
    }
    /** A control number of the course under the pointer. */
    const hitNumber = (coordinate: Point): { id: string; atMm: Point } | null => {
      const { doc: d, course: c } = latest.current
      if (!c) return null
      const pointer = toPaperMm(coordinate, c.printScale)
      const slack = (PICK_PX * resolution() * 1000) / c.printScale
      for (const p of courseDrawing(d, c)) {
        if (p.type !== 'text' || !p.owner) continue
        if (
          Math.abs(pointer[0] - p.at[0]) <= p.height * 0.45 * p.text.length + slack &&
          Math.abs(pointer[1] - p.at[1]) <= p.height / 2 + slack
        ) {
          return { id: p.owner, atMm: p.at }
        }
      }
      return null
    }
    const hitBend = (coordinate: Point) => {
      const c = latest.current.course
      if (!c) return null
      for (const [key, points] of Object.entries(c.bends)) {
        const index = points.findIndex(p => Math.hypot(p[0] - coordinate[0], p[1] - coordinate[1]) <= PICK_PX * 1.5 * resolution())
        if (index >= 0) return { key, index }
      }
      return null
    }

    let dragging: Drag | null = null
    const pointer = new PointerInteraction({
      handleDownEvent: (e: MapBrowserEvent) => {
        const coordinate = e.coordinate as Point
        const { tool: t } = latest.current
        if (t === 'select') {
          // Only the selected control (or its number) can be dragged; anything else pans the map, and a
          // click selects it first. No accidental moves while panning.
          const selectedId = latest.current.selected
          if (!selectedId) return false
          const number = hitNumber(coordinate)
          if (number && number.id === selectedId) {
            dragging = { kind: 'number', id: number.id, point: coordinate, from: coordinate, startMm: number.atMm }
            return true
          }
          if (hitControl(coordinate) !== selectedId) return false
          dragging = { kind: 'control', id: selectedId, point: coordinate, from: coordinate }
          return true
        }
        if (t === 'bend') {
          const bend = hitBend(coordinate)
          if (!bend) return false
          dragging = { kind: 'bend', ...bend, point: coordinate, from: coordinate }
          return true
        }
        return false
      },
      handleDragEvent: (e: MapBrowserEvent) => {
        if (!dragging) return
        dragging = { ...dragging, point: e.coordinate as Point }
        setDrag(dragging)
      },
      handleUpEvent: () => {
        const done = dragging
        dragging = null
        setDrag(null)
        if (!done) return false
        const moved = done.point[0] !== done.from[0] || done.point[1] !== done.from[1]
        const { doc: d, course: c } = latest.current
        if (done.kind === 'control') {
          // A drag moves the control by how far the pointer moved (it need not have grabbed the centre).
          const original = d.controls.find(x => x.id === done.id)?.position
          if (original && moved)
            latest.current.onMoveControl(done.id, [original[0] + done.point[0] - done.from[0], original[1] + done.point[1] - done.from[1]])
          else latest.current.onClick(done.point, done.id, null)
        } else if (done.kind === 'number') {
          if (moved && c) latest.current.onMoveNumber(done.id, numberOffset(d, c, done))
          else latest.current.onClick(done.point, done.id, null)
        } else if (moved) {
          latest.current.onMoveBend(done.key, done.index, done.point)
        } else {
          latest.current.onRemoveBend(done.key, done.index)
        }
        return false
      },
    })
    map.addInteraction(pointer)

    // Every click counts at once: setters place controls in quick succession, so no waiting to rule out
    // a double click (and no double-click zoom in the editor).
    map.on('click', e => {
      const coordinate = e.coordinate as Point
      const { doc: d, course: c, tool: t } = latest.current
      const leg = t === 'bend' && c ? legAt(d, c, coordinate, PICK_PX * resolution()) : null
      latest.current.onClick(coordinate, hitControl(coordinate, placing(t) ? t : undefined), leg)
    })

    // While placing: preview the symbol at the pointer, or snapped onto a control the click would reuse.
    map.on('pointermove', e => {
      const t = latest.current.tool
      if (!placing(t) || e.dragging) return
      const point = e.coordinate as Point
      const next = { point, snapTo: hitControl(point, t) }
      setHover(next)
      latest.current.onHover(next)
    })
    const leave = () => {
      setHover(null)
      latest.current.onHover(null)
    }
    const element = target.current
    element.addEventListener('pointerleave', leave)
    return () => {
      element.removeEventListener('pointerleave', leave)
      map.setTarget(undefined)
    }
  }, [versionId, grid, tilesUrl])

  // No preview once the tool is not placing anything.
  useEffect(() => {
    if (!placing(tool)) setHover(null)
  }, [tool])

  // Course symbols, the faint pool, the highlighted control, the preview and bend handles.
  useEffect(() => {
    const { pool, course: courseSource, overlay } = sources.current
    const highlighted = new Set([selected, hover?.snapTo].filter((id): id is string => Boolean(id)))
    const isHighlighted = (p: Primitive) => p.owner !== undefined && highlighted.has(p.owner)
    const scale = shownCourse?.printScale ?? mapScale
    const drawing = shownCourse ? courseDrawing(shown, shownCourse) : allControlsDrawing(shown, mapScale)
    const poolDrawing = shownCourse
      ? allControlsDrawing({ ...shown, controls: shown.controls.filter(c => !shownCourse.controls.includes(c.id)) }, scale)
      : []
    replaceFeatures(
      courseSource,
      primitiveFeatures(
        drawing.filter(p => !isHighlighted(p)),
        scale,
      ),
    )
    replaceFeatures(
      pool,
      primitiveFeatures(
        poolDrawing.filter(p => !isHighlighted(p)),
        scale,
      ),
    )

    // The selected control and its number (and a control a click would reuse) in the highlight colour,
    // with a crosshair on the exact centre.
    const marks: Feature[] = primitiveFeatures([...drawing, ...poolDrawing].filter(isHighlighted), scale, { color: HIGHLIGHT })
    for (const id of highlighted) {
      const control = shown.controls.find(c => c.id === id)
      if (!control) continue
      const centre = new Feature(new OlPoint(control.position))
      centre.setStyle(crosshairStyles)
      marks.push(centre)
    }

    // A preview of the new symbol at the pointer, when the click would not reuse a control.
    if (hover && !hover.snapTo && placing(tool)) {
      const ghost = { id: 'preview', kind: tool, code: tool === 'control' ? nextFreeCode(shown) : null, position: hover.point }
      const preview = allControlsDrawing({ ...shown, controls: [ghost] }, scale)
      marks.push(...primitiveFeatures(preview, scale, { color: COURSE_PURPLE, lineDash: [4, 3] }))
    }

    if (tool === 'bend' && shownCourse) {
      for (const [key, points] of Object.entries(shownCourse.bends)) {
        if (!shownCourse.controls.some((id, i) => legKey(id, shownCourse.controls[i + 1] ?? '') === key)) continue
        for (const p of points) {
          const handle = new Feature(new OlPoint(p))
          handle.setStyle(
            new Style({
              image: new RegularShape({
                points: 4,
                radius: 6,
                angle: Math.PI / 4,
                fill: new Fill({ color: '#fff' }),
                stroke: new Stroke({ color: HIGHLIGHT, width: 2 }),
              }),
            }),
          )
          marks.push(handle)
        }
      }
    }
    replaceFeatures(overlay, marks)
  }, [shown, shownCourse, selected, hover, tool, mapScale])

  return (
    <div
      ref={target}
      data-testid="editor-map"
      // A press on the map takes keyboard focus away from any form field, so shortcuts (Delete,
      // Ctrl+Z) reach the editor instead of a drop-down or input that still had focus.
      role="application"
      aria-label={t('editor.mapLabel')}
      onPointerDown={() => (document.activeElement as HTMLElement | null)?.blur()}
      className={`absolute inset-0 bg-white focus:outline-none ${placing(tool) || tool === 'bend' ? 'cursor-crosshair' : ''}`}
    />
  )
}

/** A dragged number's new offset from its control, in paper mm at the course's print scale. */
function numberOffset(doc: EventDoc, course: Course, drag: { id: string; point: Point; from: Point; startMm: Point }): Point {
  const control = doc.controls.find(c => c.id === drag.id)
  const centre = toPaperMm(control?.position ?? [0, 0], course.printScale)
  const dx = ((drag.point[0] - drag.from[0]) * 1000) / course.printScale
  const dy = ((drag.point[1] - drag.from[1]) * 1000) / course.printScale
  return [drag.startMm[0] + dx - centre[0], drag.startMm[1] + dy - centre[1]]
}

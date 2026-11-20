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
  MIN_POINTS,
  moveControl,
  nextFreeCode,
  type Point,
  type Primitive,
  SPECIAL_GEOMETRY,
  setNumberPosition,
  specialDrawing,
  specialShownOn,
  specialsDrawing,
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
import { COURSE_PURPLE, type Drawing, primitiveLayer } from './courseLayer.ts'
import { editPoints, isControlTool, isSpecialTool, legAt, movedPoints, numberAt, specialAt, type Tool, vertexAt } from './state.ts'

/** The selected control (and a control a click would reuse) is drawn in this colour instead of purple. */
export const HIGHLIGHT = '#0b62a4'
/** Extra pick radius around a symbol, in screen pixels. */
const PICK_PX = 6

/** Tools that place something where the pointer is (a preview follows the pointer). */
const placing = (tool: Tool) => isControlTool(tool) || isSpecialTool(tool)

type Drag =
  | { kind: 'control'; id: string; point: Point; from: Point }
  | { kind: 'bend'; key: string; index: number; point: Point; from: Point }
  /** `startMm`: where the number was, in paper mm, when the drag began. */
  | { kind: 'number'; id: string; point: Point; from: Point; startMm: Point }
  /** A whole special symbol, or (`index`) one of its points. */
  | { kind: 'special'; id: string; index: number | null; point: Point; from: Point }

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
  /** Points of a line or area being drawn. */
  draft: Point[]
  /** `tolerance`: a few screen pixels, in metres. */
  onClick: (point: Point, hit: string | null, leg: { leg: number; segment: number } | null, tolerance: number) => void
  onMoveSpecial: (id: string, points: Point[]) => void
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
  const { versionId, grid, tilesUrl, mapScale, doc, course, selected, tool, draft } = props
  const { t } = useTranslation()
  const target = useRef<HTMLDivElement>(null)
  // Course symbols are drawn by primitive layers (the faint pool, the course, the highlighted control and
  // the preview); the crosshair and bend handles are ordinary OpenLayers features on top.
  const [layers] = useState(() => ({
    pool: primitiveLayer('course-layer', 0.4),
    course: primitiveLayer('course-layer'),
    marks: primitiveLayer(),
    overlay: new VectorSource(),
  }))
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
    if (drag.kind === 'special') {
      return { ...doc, specials: doc.specials.map(s => (s.id === drag.id ? { ...s, points: movedPoints(s, delta, drag.index) } : s)) }
    }
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
        layers.pool.layer,
        layers.course.layer,
        layers.marks.layer,
        new VectorLayer({ source: layers.overlay, updateWhileInteracting: true }),
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
    /** A control number (in the all-controls view: a code) under the pointer. */
    const hitNumber = (coordinate: Point): { id: string; atMm: Point } | null => {
      const { doc: d, course: c, mapScale: m } = latest.current
      const scale = c?.printScale ?? m
      const slack = (PICK_PX * resolution() * 1000) / scale
      return numberAt(c ? courseDrawing(d, c) : allControlsDrawing(d, m), toPaperMm(coordinate, scale), slack)
    }
    /** A special symbol shown on the course (or any, in the all-controls view) under the pointer. */
    const hitSpecial = (coordinate: Point): string | null => {
      const { doc: d, course: c, mapScale: m } = latest.current
      const metresPerMm = (c?.printScale ?? m) / 1000
      const shownHere = d.specials.filter(s => specialShownOn(s, c?.id ?? null))
      return specialAt(shownHere, coordinate, PICK_PX * resolution() + 0.5 * metresPerMm, 2.5 * metresPerMm + PICK_PX * resolution())
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
    // A press this interaction handled also ends in a map click; that click must not act again (a bend
    // removed by clicking it would otherwise be added back by the same click).
    let handledUpAt = 0
    const pointer = new PointerInteraction({
      handleDownEvent: (e: MapBrowserEvent) => {
        const coordinate = e.coordinate as Point
        const { tool: t } = latest.current
        // Shift+click edits points (see the click handler): no dragging.
        if ((e.originalEvent as PointerEvent).shiftKey) return false
        if (t === 'select') {
          // Only the selected control (or its number) can be dragged; anything else pans the map, and a
          // click selects it first. No accidental moves while panning.
          const selectedId = latest.current.selected
          if (!selectedId) return false
          const special = latest.current.doc.specials.find(s => s.id === selectedId)
          if (special) {
            // One of its points, or the whole symbol.
            const index = vertexAt(special, coordinate, PICK_PX * 1.5 * resolution())
            if (index === null && hitSpecial(coordinate) !== selectedId) return false
            dragging = { kind: 'special', id: selectedId, index, point: coordinate, from: coordinate }
            return true
          }
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
        handledUpAt = Date.now()
        const moved = done.point[0] !== done.from[0] || done.point[1] !== done.from[1]
        const { doc: d, course: c } = latest.current
        if (done.kind === 'special') {
          const special = d.specials.find(s => s.id === done.id)
          if (special && moved) {
            latest.current.onMoveSpecial(
              done.id,
              movedPoints(special, [done.point[0] - done.from[0], done.point[1] - done.from[1]], done.index),
            )
          }
        } else if (done.kind === 'control') {
          // A drag moves the control by how far the pointer moved (it need not have grabbed the centre).
          const original = d.controls.find(x => x.id === done.id)?.position
          if (original && moved)
            latest.current.onMoveControl(done.id, [original[0] + done.point[0] - done.from[0], original[1] + done.point[1] - done.from[1]])
          else latest.current.onClick(done.point, done.id, null, 0)
        } else if (done.kind === 'number') {
          if (moved && c) latest.current.onMoveNumber(done.id, numberOffset(d, c, done))
          else latest.current.onClick(done.point, done.id, null, 0)
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
      if (Date.now() - handledUpAt < 300) return
      const coordinate = e.coordinate as Point
      const { doc: d, course: c, tool: t, selected: s } = latest.current
      // Shift+click on the selected line or area: removes the point clicked, or adds one on an edge.
      const selectedSpecial = d.specials.find(x => x.id === s)
      if ((e.originalEvent as PointerEvent).shiftKey && t === 'select' && selectedSpecial) {
        const points = editPoints(selectedSpecial, coordinate, PICK_PX * 1.5 * resolution())
        if (points) latest.current.onMoveSpecial(selectedSpecial.id, points)
        return
      }
      const leg = t === 'bend' && c ? legAt(d, c, coordinate, PICK_PX * resolution()) : null
      // Selecting: a control or its number, else a special symbol. Placing a control: one of that kind
      // to reuse. Special symbols are always new.
      const hit =
        t === 'select'
          ? (hitControl(coordinate) ?? hitNumber(coordinate)?.id ?? hitSpecial(coordinate))
          : isControlTool(t)
            ? hitControl(coordinate, t)
            : isSpecialTool(t)
              ? null
              : hitControl(coordinate)
      // While drawing a line or area, a click this close to the last point (a double-click) finishes it.
      latest.current.onClick(coordinate, hit, leg, PICK_PX * resolution())
    })

    // While placing: preview the symbol at the pointer, or snapped onto a control the click would reuse.
    map.on('pointermove', e => {
      const t = latest.current.tool
      if (!placing(t) || e.dragging) return
      const point = e.coordinate as Point
      const next = { point, snapTo: isControlTool(t) ? hitControl(point, t) : null }
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
  }, [layers, versionId, grid, tilesUrl])

  // No preview once the tool is not placing anything.
  useEffect(() => {
    if (!placing(tool)) setHover(null)
  }, [tool])

  // Course symbols, the faint pool, the highlighted control, the preview and bend handles.
  useEffect(() => {
    const highlighted = new Set([selected, hover?.snapTo].filter((id): id is string => Boolean(id)))
    const isHighlighted = (p: Primitive) => p.owner !== undefined && highlighted.has(p.owner)
    const scale = shownCourse?.printScale ?? mapScale
    const drawing = [
      ...specialsDrawing(shown, shownCourse?.id ?? null, scale),
      ...(shownCourse ? courseDrawing(shown, shownCourse) : allControlsDrawing(shown, mapScale)),
    ]
    const poolDrawing = shownCourse
      ? allControlsDrawing({ ...shown, controls: shown.controls.filter(c => !shownCourse.controls.includes(c.id)) }, scale)
      : []
    const purple = { color: COURSE_PURPLE }
    layers.course.setDrawings([{ primitives: drawing.filter(p => !isHighlighted(p)), printScale: scale, paint: purple }])
    layers.pool.setDrawings([{ primitives: poolDrawing.filter(p => !isHighlighted(p)), printScale: scale, paint: purple }])

    // The selected control and its number (and a control a click would reuse) in the highlight colour,
    // with a crosshair on the exact centre.
    const marks: Drawing[] = [
      { primitives: [...drawing, ...poolDrawing].filter(isHighlighted), printScale: scale, paint: { color: HIGHLIGHT } },
    ]
    const handles: Feature[] = []
    for (const id of highlighted) {
      const control = shown.controls.find(c => c.id === id)
      const special = shown.specials.find(s => s.id === id)
      // A special point symbol gets the crosshair too; a line or area gets a handle on each point.
      const centres = control ? [control.position] : special && SPECIAL_GEOMETRY[special.kind] === 'point' ? special.points : []
      for (const p of centres) {
        const centre = new Feature(new OlPoint(p))
        centre.setStyle(crosshairStyles)
        handles.push(centre)
      }
      if (special && SPECIAL_GEOMETRY[special.kind] !== 'point') handles.push(...special.points.map(vertexHandle))
    }

    if (isSpecialTool(tool)) {
      // The special being placed or drawn, with the pointer as its next point. Until a line or area has
      // enough points to be drawn, a dashed guide shows its outline.
      const points = [...draft, ...(hover ? [hover.point] : [])]
      const needed = MIN_POINTS[SPECIAL_GEOMETRY[tool]]
      if (points.length >= needed) {
        const ghost = { id: 'preview', kind: tool, points: needed === 1 ? points.slice(-1) : points }
        marks.push({ primitives: specialDrawing(shown, ghost, scale), printScale: scale, paint: { color: COURSE_PURPLE } })
      } else if (points.length > 1) {
        const guide = points.map(p => toPaperMm(p, scale))
        marks.push({
          primitives: [{ type: 'polyline', points: guide, lineWidth: 0.2, closed: false, role: 'special' }],
          printScale: scale,
          paint: { color: COURSE_PURPLE, lineDash: [4, 3] },
        })
      }
      handles.push(...draft.map(vertexHandle))
    } else if (hover && !hover.snapTo && isControlTool(tool)) {
      // A preview of the new symbol at the pointer, when the click would not reuse a control.
      const ghost = { id: 'preview', kind: tool, code: tool === 'control' ? nextFreeCode(shown) : null, position: hover.point }
      const preview = allControlsDrawing({ ...shown, controls: [ghost] }, scale)
      marks.push({ primitives: preview, printScale: scale, paint: { color: COURSE_PURPLE, lineDash: [4, 3] } })
    }

    if (tool === 'bend' && shownCourse) {
      for (const [key, points] of Object.entries(shownCourse.bends)) {
        if (!shownCourse.controls.some((id, i) => legKey(id, shownCourse.controls[i + 1] ?? '') === key)) continue
        handles.push(...points.map(vertexHandle))
      }
    }
    layers.marks.setDrawings(marks)
    layers.overlay.clear(true)
    layers.overlay.addFeatures(handles)
  }, [layers, shown, shownCourse, selected, hover, tool, draft, mapScale])

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

const vertexStyle = new Style({
  image: new RegularShape({
    points: 4,
    radius: 6,
    angle: Math.PI / 4,
    fill: new Fill({ color: '#fff' }),
    stroke: new Stroke({ color: HIGHLIGHT, width: 2 }),
  }),
})

/** A square handle on a point that can be dragged (a bend, a point of a line or area). */
function vertexHandle(p: Point): Feature {
  const handle = new Feature(new OlPoint(p))
  handle.setStyle(vertexStyle)
  return handle
}

/** A dragged number's new offset from its control, in paper mm at the course's print scale. */
function numberOffset(doc: EventDoc, course: Course, drag: { id: string; point: Point; from: Point; startMm: Point }): Point {
  const control = doc.controls.find(c => c.id === drag.id)
  const centre = toPaperMm(control?.position ?? [0, 0], course.printScale)
  const dx = ((drag.point[0] - drag.from[0]) * 1000) / course.printScale
  const dy = ((drag.point[1] - drag.from[1]) * 1000) / course.printScale
  return [drag.startMm[0] + dx - centre[0], drag.startMm[1] + dy - centre[1]]
}

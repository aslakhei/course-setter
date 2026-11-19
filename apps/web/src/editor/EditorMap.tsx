// The editor's map: the map version's tiles, the course being edited (or all controls), the rest of
// the control pool faintly (to reuse), the selection, and pointer handling for the tools.
import 'ol/ol.css'
import {
  allControlsDrawing,
  type Course,
  courseDrawing,
  type EventDoc,
  legKey,
  moveControl,
  type Point,
  symbolSizes,
  type TileGrid,
} from '@course-setter/core'
import { defaults as defaultControls, ScaleLine } from 'ol/control.js'
import Feature from 'ol/Feature.js'
import { Circle as CircleGeometry, Point as OlPoint } from 'ol/geom.js'
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
import { extentOf, projectionFor, tileSource } from '../components/MapViewer.tsx'
import { primitiveFeatures, replaceFeatures } from './courseLayer.ts'
import { legAt, type Tool } from './state.ts'

const SELECTION_BLUE = '#0b62a4'
/** Extra pick radius around a symbol, in screen pixels. */
const PICK_PX = 6

type Drag =
  | { kind: 'control'; id: string; point: Point; from: Point }
  | { kind: 'bend'; key: string; index: number; point: Point; from: Point }

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
  onMoveBend: (key: string, index: number, point: Point) => void
  /** A bend point clicked (not dragged) with the bend tool. */
  onRemoveBend: (key: string, index: number) => void
}

export function EditorMap(props: Props) {
  const { versionId, grid, tilesUrl, mapScale, doc, course, selected, tool } = props
  const target = useRef<HTMLDivElement>(null)
  const mapRef = useRef<OlMap | null>(null)
  const sources = useRef({ pool: new VectorSource(), course: new VectorSource(), overlay: new VectorSource() })
  const [drag, setDrag] = useState<Drag | null>(null)
  const latest = useRef(props)
  latest.current = props

  const printScale = course?.printScale ?? mapScale
  const sizes = symbolSizes(doc.standard, printScale)
  /** Pick radius of a control symbol in metres (circle radius at the print scale). */
  const symbolRadius = (sizes.finishOuter / 2) * (printScale / 1000)

  // While dragging, draw the moved state without recording it.
  const shown = useMemo(() => {
    if (!drag) return doc
    if (drag.kind === 'control') {
      const original = doc.controls.find(c => c.id === drag.id)?.position
      if (!original) return doc
      return moveControl(doc, drag.id, [original[0] + drag.point[0] - drag.from[0], original[1] + drag.point[1] - drag.from[1]])
    }
    if (!course) return doc
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

    const hitControl = (coordinate: Point, resolution: number): string | null => {
      const { doc: d, course: c } = latest.current
      const candidates = d.controls
      let best: { id: string; distance: number } | null = null
      const r = latestRadius.current + PICK_PX * resolution
      for (const control of candidates) {
        const distance = Math.hypot(control.position[0] - coordinate[0], control.position[1] - coordinate[1])
        if (distance <= r && (!best || distance < best.distance)) best = { id: control.id, distance }
      }
      // In a course, its own stops win over pool controls at the same place.
      if (best && c && !c.controls.includes(best.id)) {
        const own = c.controls.find(id => {
          const p = d.controls.find(x => x.id === id)?.position
          return p && Math.hypot(p[0] - coordinate[0], p[1] - coordinate[1]) <= r
        })
        if (own) return own
      }
      return best?.id ?? null
    }
    const hitBend = (coordinate: Point, resolution: number) => {
      const c = latest.current.course
      if (!c) return null
      for (const [key, points] of Object.entries(c.bends)) {
        const index = points.findIndex(p => Math.hypot(p[0] - coordinate[0], p[1] - coordinate[1]) <= PICK_PX * 1.5 * resolution)
        if (index >= 0) return { key, index }
      }
      return null
    }

    let dragging: Drag | null = null
    const pointer = new PointerInteraction({
      handleDownEvent: (e: MapBrowserEvent) => {
        const coordinate = e.coordinate as Point
        const resolution = map.getView().getResolution() ?? 1
        const { tool: t } = latest.current
        if (t === 'select') {
          const id = hitControl(coordinate, resolution)
          if (!id) return false
          dragging = { kind: 'control', id, point: coordinate, from: coordinate }
          return true
        }
        if (t === 'bend') {
          const bend = hitBend(coordinate, resolution)
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
        const moved = done && (done.point[0] !== done.from[0] || done.point[1] !== done.from[1])
        if (done?.kind === 'control') {
          // A drag moves the control by how far the pointer moved (it need not have grabbed the centre).
          const original = latest.current.doc.controls.find(c => c.id === done.id)?.position
          if (original && moved)
            latest.current.onMoveControl(done.id, [original[0] + done.point[0] - done.from[0], original[1] + done.point[1] - done.from[1]])
          else latest.current.onClick(done.point, done.id, null)
        } else if (done?.kind === 'bend') {
          if (moved) latest.current.onMoveBend(done.key, done.index, done.point)
          else latest.current.onRemoveBend(done.key, done.index)
        }
        return false
      },
    })
    map.addInteraction(pointer)

    // Every click counts at once: setters place controls in quick succession, so no waiting to rule out
    // a double click (and no double-click zoom in the editor).
    map.on('click', e => {
      const coordinate = e.coordinate as Point
      const resolution = map.getView().getResolution() ?? 1
      const { doc: d, course: c, tool: t } = latest.current
      const leg = t === 'bend' && c ? legAt(d, c, coordinate, PICK_PX * resolution) : null
      latest.current.onClick(coordinate, hitControl(coordinate, resolution), leg)
    })
    mapRef.current = map
    return () => {
      map.setTarget(undefined)
      mapRef.current = null
    }
  }, [versionId, grid, tilesUrl])

  const latestRadius = useRef(symbolRadius)
  latestRadius.current = symbolRadius

  // Course symbols, the faint pool, the selection and bend handles.
  useEffect(() => {
    const { pool, course: courseSource, overlay } = sources.current
    if (shownCourse) {
      replaceFeatures(courseSource, primitiveFeatures(courseDrawing(shown, shownCourse), shownCourse.printScale))
      const others = { ...shown, controls: shown.controls.filter(c => !shownCourse.controls.includes(c.id)) }
      replaceFeatures(pool, primitiveFeatures(allControlsDrawing(others, shownCourse.printScale), shownCourse.printScale))
    } else {
      replaceFeatures(courseSource, primitiveFeatures(allControlsDrawing(shown, mapScale), mapScale))
      pool.clear(true)
    }
    const marks: Feature[] = []
    const control = selected ? shown.controls.find(c => c.id === selected) : undefined
    if (control) {
      const ring = new Feature(new CircleGeometry(control.position, symbolRadius * 1.35))
      ring.setStyle(new Style({ stroke: new Stroke({ color: SELECTION_BLUE, width: 2, lineDash: [6, 4] }) }))
      marks.push(ring)
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
                stroke: new Stroke({ color: SELECTION_BLUE, width: 2 }),
              }),
            }),
          )
          marks.push(handle)
        }
      }
    }
    replaceFeatures(overlay, marks)
  }, [shown, shownCourse, selected, tool, mapScale, symbolRadius])

  return (
    <div ref={target} data-testid="editor-map" className={`absolute inset-0 bg-white ${tool === 'select' ? '' : 'cursor-crosshair'}`} />
  )
}

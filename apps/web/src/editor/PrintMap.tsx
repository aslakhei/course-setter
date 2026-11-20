// The print view's map: the course as in the editor, the printed page as a frame to drag over the map
// (outside it dimmed, its white margin as printed) and the description sheet on its white box, to drag
// within the page. What is inside the frame is what the PDF shows: both are laid out by printPage().
import 'ol/ol.css'
import {
  type Course,
  courseDrawing,
  type EventDoc,
  type Point,
  type PrintSettings,
  pageGroundArea,
  pageToPaperOffset,
  printPage,
  specialsDrawing,
  type TileGrid,
  transformPrimitives,
} from '@course-setter/core'
import { defaults as defaultControls, ScaleLine } from 'ol/control.js'
import Feature from 'ol/Feature.js'
import { LineString, Polygon } from 'ol/geom.js'
import PointerInteraction from 'ol/interaction/Pointer.js'
import TileLayer from 'ol/layer/Tile.js'
import VectorLayer from 'ol/layer/Vector.js'
import OlMap from 'ol/Map.js'
import type MapBrowserEvent from 'ol/MapBrowserEvent.js'
import OlOverlay from 'ol/Overlay.js'
import VectorSource from 'ol/source/Vector.js'
import { Fill, Stroke, Style } from 'ol/style.js'
import View from 'ol/View.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { extentOf, projectionFor, tileSource } from '../components/MapViewer.tsx'
import { formatScale } from '../lib/format.ts'
import { COURSE_PURPLE, primitiveLayer } from './courseLayer.ts'
import { HIGHLIGHT } from './EditorMap.tsx'
import { dragged, formatPaper, type Grab, grabAt, groundRing } from './print.ts'

type Props = {
  versionId: string
  grid: TileGrid
  tilesUrl: string
  doc: EventDoc
  course: Course
  /** The event's name, the title of the description sheet. */
  title: string
  settings: PrintSettings
  onChange: (settings: PrintSettings) => void
}

type Drag = { grab: Grab; from: Point; point: Point }

const styles = {
  dim: new Style({ fill: new Fill({ color: 'rgba(42, 36, 48, 0.38)' }) }),
  paper: new Style({ fill: new Fill({ color: '#ffffff' }) }),
  frame: new Style({ stroke: new Stroke({ color: HIGHLIGHT, width: 2 }) }),
}

export function PrintMap(props: Props) {
  const { versionId, grid, tilesUrl, doc, course, title, settings } = props
  const { t } = useTranslation()
  const target = useRef<HTMLDivElement>(null)
  // Bottom to top: the map, the course (Multiply), the dimmed surroundings and white paper, the
  // description sheet, the frame lines.
  const [layers] = useState(() => {
    // Above the frame: course, paper, orientation and scale (OpenLayers places it, so not React).
    const label = document.createElement('div')
    label.className = 'rounded-t bg-[#0b62a4] px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-white'
    label.setAttribute('data-testid', 'print-page-label')
    return { course: primitiveLayer('course-layer'), under: new VectorSource(), sheet: primitiveLayer(), over: new VectorSource(), label }
  })
  const map = useRef<OlMap | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)

  // While dragging, the page as it would be after the drop.
  const shown = useMemo(
    () =>
      drag ? dragged(doc, course, title, settings, drag.grab, [drag.point[0] - drag.from[0], drag.point[1] - drag.from[1]]) : settings,
    [doc, course, title, settings, drag],
  )
  const page = useMemo(() => printPage(doc, course, title, shown), [doc, course, title, shown])
  const latest = useRef({ props, page, shown })
  latest.current = { props, page, shown }

  // The map, once per version.
  useEffect(() => {
    if (!target.current) return
    const projection = projectionFor(versionId, grid)
    const finest = grid.levels.at(-1)?.resolution ?? 1
    const coarsest = grid.levels[0]?.resolution ?? 1
    const label = new OlOverlay({ element: layers.label, positioning: 'bottom-left', stopEvent: false })
    const olMap = new OlMap({
      target: target.current,
      layers: [
        new TileLayer({ source: tileSource(grid, tilesUrl, projection) }),
        layers.course.layer,
        new VectorLayer({ source: layers.under, updateWhileInteracting: true, updateWhileAnimating: true }),
        layers.sheet.layer,
        new VectorLayer({ source: layers.over, updateWhileInteracting: true, updateWhileAnimating: true }),
      ],
      overlays: [label],
      view: new View({
        projection,
        // Further out than the whole map: a page can be larger than the map.
        resolutions: [coarsest * 4, coarsest * 2, ...grid.levels.map(l => l.resolution), finest / 2, finest / 4],
        extent: extentOf(grid),
        constrainOnlyCenter: true,
      }),
      controls: defaultControls({ rotate: false, attribution: false }).extend([
        new ScaleLine({ units: 'metric', bar: true, text: false, minWidth: 120 }),
      ]),
    })
    map.current = olMap

    const grabbed = (point: Point) => {
      const { props: p, page: pg } = latest.current
      return grabAt(pg, p.course, p.settings, point)
    }
    let dragging: Drag | null = null
    olMap.addInteraction(
      new PointerInteraction({
        handleDownEvent: (e: MapBrowserEvent) => {
          const point = e.coordinate as Point
          const grab = grabbed(point)
          if (!grab) return false // off the page: the map pans
          dragging = { grab, from: point, point }
          return true
        },
        handleDragEvent: (e: MapBrowserEvent) => {
          if (!dragging) return
          dragging = { ...dragging, point: e.coordinate as Point }
          setDrag(dragging)
        },
        handleUpEvent: () => {
          const done = dragging
          dragging = null
          if (done && (done.point[0] !== done.from[0] || done.point[1] !== done.from[1]))
            latest.current.props.onChange(latest.current.shown)
          setDrag(null)
          return false
        },
      }),
    )
    // The pointer shows what can be moved.
    const element = target.current
    olMap.on('pointermove', e => {
      if (e.dragging || dragging) return
      element.style.cursor = grabbed(e.coordinate as Point) ? 'move' : ''
    })
    return () => {
      olMap.setTarget(undefined)
      map.current = null
    }
  }, [layers, versionId, grid, tilesUrl])

  // Show the whole page when the view opens, when another course's page is shown and when the paper
  // changes size.
  // biome-ignore lint/correctness/useExhaustiveDependencies: not on every move of the page
  useEffect(() => {
    const { props: p, shown: s } = latest.current
    const e = pageGroundArea(p.course, s)
    const m = map.current
    if (!m) return
    // The map may not have measured its element yet.
    m.updateSize()
    m.getView().fit([e.minX, e.minY, e.maxX, e.maxY], { size: m.getSize(), padding: [56, 40, 40, 40] })
  }, [course.id, versionId, settings.paper, settings.orientation])

  // The course, as in the editor.
  useEffect(() => {
    const scale = course.printScale
    const primitives = [...specialsDrawing(doc, course.id, scale), ...courseDrawing(doc, course)]
    layers.course.setDrawings([{ primitives, printScale: scale, paint: { color: COURSE_PURPLE } }])
  }, [layers, doc, course])

  // The page: dimmed surroundings, white margin, the sheet on its white box, and the frame.
  useEffect(() => {
    const whole = groundRing(course, shown, { minX: 0, minY: 0, maxX: page.size[0], maxY: page.size[1] })
    const inner = groundRing(course, shown, page.mapArea)
    const far = 1e5
    const e = grid.extent
    const world: Point[] = [
      [e.minX - far, e.minY - far],
      [e.maxX + far, e.minY - far],
      [e.maxX + far, e.maxY + far],
      [e.minX - far, e.maxY + far],
      [e.minX - far, e.minY - far],
    ]
    const feature = (geometry: Polygon | LineString, style: Style) => {
      const f = new Feature(geometry)
      f.setStyle(style)
      return f
    }
    const under = [feature(new Polygon([world, whole]), styles.dim), feature(new Polygon([whole, inner]), styles.paper)]
    const over = [feature(new LineString(whole), styles.frame)]
    if (page.descriptions) {
      const box = groundRing(course, shown, page.descriptions.box)
      under.push(feature(new Polygon([box]), styles.paper))
      over.push(feature(new LineString(box), styles.frame))
      const offset = pageToPaperOffset(course, shown)
      layers.sheet.setDrawings([
        {
          primitives: transformPrimitives(page.descriptions.primitives, 1, offset),
          printScale: course.printScale,
          paint: { color: '#000' },
        },
      ])
    } else {
      layers.sheet.setDrawings([])
    }
    layers.under.clear(true)
    layers.under.addFeatures(under)
    layers.over.clear(true)
    layers.over.addFeatures(over)

    const area = pageGroundArea(course, shown)
    layers.label.textContent = [course.name, formatPaper(shown.paper, shown.orientation, t), formatScale(course.printScale)].join(' · ')
    map.current?.getOverlays().item(0)?.setPosition([area.minX, area.maxY])
  }, [layers, course, shown, page, grid, t])

  return (
    <div
      ref={target}
      data-testid="print-map"
      role="application"
      aria-label={t('print.mapLabel')}
      className="absolute inset-0 bg-white focus:outline-none"
    />
  )
}

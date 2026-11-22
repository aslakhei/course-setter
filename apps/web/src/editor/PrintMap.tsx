// The print view's map: the course as in the editor, the printed page as a frame to drag over the map
// (outside it dimmed, its white margin as printed), the print layout's elements (titles, logos, frames)
// and the description sheet on its white box, to drag within the page. What is inside the frame is what
// the PDF shows: both are laid out by printPage().
//
// In Layout mode the page stays where it is: pressing on an element selects it and drags it, its
// handles resize it, both snapping to page edges, margin, centre lines, the map area and other elements
// (Alt: no snapping), with guide lines; the drop is one edit (one step of undo).
import 'ol/ol.css'
import {
  type Bounds,
  type Course,
  courseDrawing,
  type EventDoc,
  elementAt,
  flattenPath,
  fontsOnPage,
  type Guides,
  type Handle,
  handleAt,
  handlePoints,
  type PageContext,
  type Point,
  type PrintSettings,
  pageGroundArea,
  pagePosition,
  pageToPaperOffset,
  printPage,
  resizeBox,
  snapMove,
  snapResize,
  snapTargets,
  specialsDrawing,
  type TileGrid,
  transformPrimitives,
} from '@course-setter/core'
import { defaults as defaultControls, ScaleLine } from 'ol/control.js'
import Feature from 'ol/Feature.js'
import { LineString, Point as OlPoint, Polygon } from 'ol/geom.js'
import PointerInteraction from 'ol/interaction/Pointer.js'
import TileLayer from 'ol/layer/Tile.js'
import VectorLayer from 'ol/layer/Vector.js'
import OlMap from 'ol/Map.js'
import type MapBrowserEvent from 'ol/MapBrowserEvent.js'
import OlOverlay from 'ol/Overlay.js'
import VectorSource from 'ol/source/Vector.js'
import { Fill, RegularShape, Stroke, Style } from 'ol/style.js'
import View from 'ol/View.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { extentOf, projectionFor, tileSource } from '../components/MapViewer.tsx'
import { useAssetImages } from '../lib/assets.ts'
import { loadFonts } from '../lib/fonts.ts'
import { formatScale } from '../lib/format.ts'
import { COURSE_PURPLE, primitiveLayer } from './courseLayer.ts'
import { HIGHLIGHT } from './EditorMap.tsx'
import { dragged, formatPaper, type Grab, grabAt, groundPoints, groundRing } from './print.ts'

/** What the Layout mode needs from the print view. */
export type LayoutEditing = {
  /** The selected elements' ids (handles show when there is one). */
  selected: string[]
  /** A click on an element (null: on nothing); `additive` (Shift) adds it to the selection or takes it away. */
  onSelect: (id: string | null, additive?: boolean) => void
  /** The document with an element placed at a box (page mm, y up): for the preview while dragging and the drop. */
  place: (id: string, box: Bounds) => EventDoc
  onEdit: (doc: EventDoc) => void
  /** An image's width / height, to keep its proportions when a corner is dragged. */
  aspectOf: (id: string) => number | undefined
}

type Props = {
  versionId: string
  grid: TileGrid
  tilesUrl: string
  doc: EventDoc
  course: Course
  /** The event's name, the title of the description sheet. */
  title: string
  /** The print layout's fields that are not in the document. */
  context: PageContext
  settings: PrintSettings
  onChange: (settings: PrintSettings) => void
  /** Layout mode (null: the page is placed on the map). */
  layout?: LayoutEditing | null
}

type Drag = { grab: Grab; from: Point; point: Point }
/** Dragging an element (moving it, or resizing it by a handle): its box as it would be dropped. */
type ElementDrag = { id: string; handle: Handle | null; start: Bounds; from: Point; box: Bounds; guides: Guides }

/** Snapping and handle reach in screen pixels. */
const SNAP_PX = 6
const HANDLE_PX = 6
const CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
}

const styles = {
  dim: new Style({ fill: new Fill({ color: 'rgba(42, 36, 48, 0.38)' }) }),
  paper: new Style({ fill: new Fill({ color: '#ffffff' }) }),
  frame: new Style({ stroke: new Stroke({ color: HIGHLIGHT, width: 2 }) }),
  // Dashed blue on a white halo, so it shows on dark and light alike.
  selection: [
    new Style({ stroke: new Stroke({ color: '#ffffff', width: 3.5 }) }),
    new Style({ stroke: new Stroke({ color: '#0b62a4', width: 1.5, lineDash: [5, 3] }) }),
  ],
  handle: new Style({
    image: new RegularShape({
      points: 4,
      radius: 5,
      angle: Math.PI / 4,
      fill: new Fill({ color: '#ffffff' }),
      stroke: new Stroke({ color: '#0b62a4', width: 1.5 }),
    }),
  }),
  guide: new Style({ stroke: new Stroke({ color: '#d0368a', width: 1 }) }),
}

export function PrintMap(props: Props) {
  const { versionId, grid, tilesUrl, doc, course, title, context, settings } = props
  const { t } = useTranslation()
  const target = useRef<HTMLDivElement>(null)
  // Bottom to top: the map, white areas, the course (Multiply), the dimmed surroundings and white paper,
  // the print layout, the description sheet, the frame lines.
  const [layers] = useState(() => {
    // Above the frame: course, paper, orientation and scale (OpenLayers places it, so not React).
    const label = document.createElement('div')
    label.className = 'rounded-t bg-[#0b62a4] px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-white'
    label.setAttribute('data-testid', 'print-page-label')
    return {
      white: primitiveLayer(),
      course: primitiveLayer('course-layer'),
      under: new VectorSource(),
      elements: primitiveLayer(),
      sheet: primitiveLayer(),
      over: new VectorSource(),
      label,
    }
  })
  const map = useRef<OlMap | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [elementDrag, setElementDrag] = useState<ElementDrag | null>(null)
  const layout = props.layout ?? null

  // While dragging, the page as it would be after the drop.
  const shown = useMemo(
    () =>
      drag ? dragged(doc, course, title, settings, drag.grab, [drag.point[0] - drag.from[0], drag.point[1] - drag.from[1]]) : settings,
    [doc, course, title, settings, drag],
  )
  // While dragging an element, the document as it would be after the drop.
  const shownDoc = useMemo(() => {
    if (!elementDrag || !layout) return doc
    try {
      return layout.place(elementDrag.id, elementDrag.box)
    } catch {
      return doc
    }
  }, [doc, elementDrag, layout])
  const page = useMemo(() => printPage(shownDoc, course, title, shown, context), [shownDoc, course, title, shown, context])
  // The layout's fonts, loaded once each; the layout is drawn again when they are in.
  const [fontsReady, setFontsReady] = useState(0)
  // The layout's images (ones this person may not see, or not loaded yet, show as placeholders).
  const assetIds = useMemo(
    () => [...new Set(page.elements.flatMap(e => e.primitives.flatMap(p => (p.type === 'image' ? [p.asset] : []))))].sort(),
    [page],
  )
  const assetIdsKey = assetIds.join(',')
  // biome-ignore lint/correctness/useExhaustiveDependencies: the same ids, not a new array, keep the images
  const stableIds = useMemo(() => assetIds, [assetIdsKey])
  const { images, loaded } = useAssetImages(stableIds)
  const latest = useRef({ props, page, shown })
  latest.current = { props, page, shown }
  const elementDragRef = useRef<ElementDrag | null>(null)

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
        layers.white.layer,
        layers.course.layer,
        new VectorLayer({ source: layers.under, updateWhileInteracting: true, updateWhileAnimating: true }),
        layers.elements.layer,
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
      const grab = grabAt(pg, p.course, p.settings, point)
      // In Layout mode the page stays put: only the description sheet is dragged.
      return p.layout && grab === 'page' ? null : grab
    }
    /** Page mm per screen pixel at the current zoom. */
    const mmPerPx = () => ((olMap.getView().getResolution() ?? 1) * 1000) / latest.current.props.course.printScale
    const toPage = (point: Point) => pagePosition(latest.current.props.course, latest.current.props.settings, point)
    /** Which handles an element has: a text element's height follows its lines, so only its sides. */
    const handlesOf = (id: string): Handle[] => {
      const kind = latest.current.page.elements.find(e => e.id === id)?.kind
      return kind === 'text' ? ['e', 'w'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
    }
    /** What a press at a ground point takes hold of in Layout mode: a handle of the selected element, or an element. */
    const layoutGrab = (point: Point): { id: string; handle: Handle | null; box: Bounds } | null => {
      const { props: p, page: pg } = latest.current
      if (!p.layout) return null
      const at = toPage(point)
      const only = p.layout.selected.length === 1 ? p.layout.selected[0] : undefined
      const selected = pg.elements.find(e => e.id === only)
      if (selected && !selected.locked) {
        const handle = handleAt(selected.box, at, HANDLE_PX * mmPerPx(), handlesOf(selected.id))
        if (handle) return { id: selected.id, handle, box: selected.box }
      }
      const hit = elementAt(pg.elements, at, 1.5 * mmPerPx())
      return hit ? { id: hit.id, handle: null, box: hit.box } : null
    }
    let dragging: Drag | null = null
    olMap.addInteraction(
      new PointerInteraction({
        handleDownEvent: (e: MapBrowserEvent) => {
          const point = e.coordinate as Point
          const layoutHit = layoutGrab(point)
          if (layoutHit) {
            // Shift: add to the selection or take away, without dragging.
            if ((e.originalEvent as PointerEvent).shiftKey) {
              latest.current.props.layout?.onSelect(layoutHit.id, true)
              return true
            }
            if (!latest.current.props.layout?.selected.includes(layoutHit.id) || layoutHit.handle)
              latest.current.props.layout?.onSelect(layoutHit.id)
            const d: ElementDrag = {
              id: layoutHit.id,
              handle: layoutHit.handle,
              start: layoutHit.box,
              from: toPage(point),
              box: layoutHit.box,
              guides: { x: null, y: null },
            }
            elementDragRef.current = d
            return true
          }
          const grab = grabbed(point)
          if (!grab) {
            // Off every element: nothing is selected any more, and the map pans.
            latest.current.props.layout?.onSelect(null)
            return false
          }
          dragging = { grab, from: point, point }
          return true
        },
        handleDragEvent: (e: MapBrowserEvent) => {
          const d = elementDragRef.current
          if (d) {
            const { props: p, page: pg } = latest.current
            const [x, y] = toPage(e.coordinate as Point)
            const delta: Point = [x - d.from[0], y - d.from[1]]
            const others = pg.elements.filter(o => o.id !== d.id).map(o => o.box)
            const targets = snapTargets(pg.size, p.settings.margin, pg.mapArea, others)
            const snap = !(e.originalEvent as PointerEvent).altKey
            const threshold = SNAP_PX * mmPerPx()
            let next: { box: Bounds; guides: Guides }
            if (d.handle) {
              const aspect = p.layout?.aspectOf(d.id)
              const box = resizeBox(d.start, d.handle, delta, { min: 2, ...(aspect ? { aspect } : {}) })
              next = snap ? snapResize(box, d.handle, targets, threshold) : { box, guides: { x: null, y: null } }
            } else {
              const box = {
                minX: d.start.minX + delta[0],
                maxX: d.start.maxX + delta[0],
                minY: d.start.minY + delta[1],
                maxY: d.start.maxY + delta[1],
              }
              next = snap ? snapMove(box, targets, threshold) : { box, guides: { x: null, y: null } }
            }
            elementDragRef.current = { ...d, ...next }
            setElementDrag(elementDragRef.current)
            return
          }
          if (!dragging) return
          dragging = { ...dragging, point: e.coordinate as Point }
          setDrag(dragging)
        },
        handleUpEvent: () => {
          const d = elementDragRef.current
          elementDragRef.current = null
          if (d) {
            const moved =
              d.box.minX !== d.start.minX || d.box.maxX !== d.start.maxX || d.box.minY !== d.start.minY || d.box.maxY !== d.start.maxY
            const editing = latest.current.props.layout
            if (moved && editing) {
              try {
                editing.onEdit(editing.place(d.id, d.box))
              } catch {
                // A box the layout refuses (too small): nothing changes.
              }
            }
            setElementDrag(null)
            return false
          }
          const done = dragging
          dragging = null
          if (done && (done.point[0] !== done.from[0] || done.point[1] !== done.from[1]))
            latest.current.props.onChange(latest.current.shown)
          setDrag(null)
          return false
        },
      }),
    )
    // The pointer shows what can be moved or resized.
    const element = target.current
    olMap.on('pointermove', e => {
      if (e.dragging || dragging || elementDragRef.current) return
      const point = e.coordinate as Point
      const hit = layoutGrab(point)
      element.style.cursor = hit ? (hit.handle ? CURSORS[hit.handle] : 'move') : grabbed(point) ? 'move' : ''
    })
    return () => {
      olMap.setTarget(undefined)
      map.current = null
    }
  }, [layers, versionId, grid, tilesUrl])

  // Show the whole page when the view opens, when another course's page is shown, when the paper
  // changes size, and when Layout mode starts or ends.
  const layoutOn = layout !== null
  // biome-ignore lint/correctness/useExhaustiveDependencies: not on every move of the page
  useEffect(() => {
    const { props: p, shown: s } = latest.current
    const e = pageGroundArea(p.course, s)
    const m = map.current
    if (!m) return
    // The map may not have measured its element yet.
    m.updateSize()
    m.getView().fit([e.minX, e.minY, e.maxX, e.maxY], { size: m.getSize(), padding: [56, 40, 40, 40] })
  }, [course.id, versionId, settings.paper, settings.orientation, layoutOn])

  // The course, as in the editor.
  useEffect(() => {
    const scale = course.printScale
    const primitives = [...specialsDrawing(doc, course.id, scale), ...courseDrawing(doc, course)]
    layers.course.setDrawings([{ primitives, printScale: scale, paint: { color: COURSE_PURPLE } }])
  }, [layers, doc, course])

  useEffect(() => {
    let current = true
    loadFonts(fontsOnPage(page))
      .then(() => current && setFontsReady(n => n + 1))
      // Without the font the text shows in a fallback font; the PDF is not affected.
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [page])

  // White areas over the map, under the course (the paper and margin above them clip them to the map area).
  useEffect(() => {
    layers.white.setDrawings([
      {
        primitives: transformPrimitives(
          page.whiteAreas.flatMap(w => w.primitives),
          1,
          pageToPaperOffset(course, shown),
        ),
        printScale: course.printScale,
        paint: { color: '#ffffff' },
      },
    ])
  }, [layers, course, shown, page])

  // The print layout, above the paper (and the course, where it covers the map).
  // biome-ignore lint/correctness/useExhaustiveDependencies: drawn again once the fonts have loaded
  useEffect(() => {
    const offset = pageToPaperOffset(course, shown)
    layers.elements.setDrawings([
      {
        primitives: transformPrimitives(
          page.elements.flatMap(e => e.primitives),
          1,
          offset,
        ),
        printScale: course.printScale,
        paint: { color: '#000' },
        images: id => images.get(id) ?? null,
      },
    ])
  }, [layers, course, shown, page, fontsReady, images, loaded])

  // The page: dimmed surroundings, white margin (and bands), the sheet on its white box, and the frame.
  useEffect(() => {
    const whole = groundRing(course, shown, { minX: 0, minY: 0, maxX: page.size[0], maxY: page.size[1] })
    const inner = groundPoints(course, shown, flattenPath(page.mapClip)[0] ?? [])
    const far = 1e5
    const e = grid.extent
    const world: Point[] = [
      [e.minX - far, e.minY - far],
      [e.maxX + far, e.minY - far],
      [e.maxX + far, e.maxY + far],
      [e.minX - far, e.maxY + far],
      [e.minX - far, e.minY - far],
    ]
    const feature = (geometry: Polygon | LineString | OlPoint, style: Style | Style[]) => {
      const f = new Feature(geometry)
      f.setStyle(style)
      return f
    }
    const under = [feature(new Polygon([world, whole]), styles.dim), feature(new Polygon([whole, inner]), styles.paper)]
    const over: Feature[] = [feature(new LineString(whole), styles.frame)]
    // Layout mode: the selected elements' outlines, one element's handles, and the lines it snapped to.
    const ids = elementDrag ? [elementDrag.id] : (layout?.selected ?? [])
    const chosen = page.elements.filter(el => ids.includes(el.id))
    for (const el of chosen) over.push(feature(new LineString(groundRing(course, shown, el.box)), styles.selection))
    const selected = chosen.length === 1 ? chosen[0] : undefined
    if (selected) {
      if (!selected.locked) {
        const handles = Object.entries(handlePoints(selected.box))
          .filter(([h]) => selected.kind !== 'text' || h === 'e' || h === 'w')
          .map(([, at]) => at as Point)
        for (const at of groundPoints(course, shown, handles)) over.push(feature(new OlPoint(at), styles.handle))
      }
    }
    if (elementDrag) {
      const { x, y } = elementDrag.guides
      if (x !== null)
        over.push(
          feature(
            new LineString(
              groundPoints(course, shown, [
                [x, 0],
                [x, page.size[1]],
              ]),
            ),
            styles.guide,
          ),
        )
      if (y !== null)
        over.push(
          feature(
            new LineString(
              groundPoints(course, shown, [
                [0, y],
                [page.size[0], y],
              ]),
            ),
            styles.guide,
          ),
        )
    }
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
  }, [layers, course, shown, page, grid, t, layout, elementDrag])

  return (
    <div
      ref={target}
      data-testid="print-map"
      role="application"
      aria-label={layout ? t('layout.mapLabel') : t('print.mapLabel')}
      className="absolute inset-0 bg-white focus:outline-none"
    />
  )
}

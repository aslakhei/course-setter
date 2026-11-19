// Map viewer: OpenLayers in the map version's own frame (ground metres, y up; not Web Mercator), so
// distances on screen are plain Euclidean lengths in metres. Tiles come from the version's PMTiles
// archive through a signed URL, read with HTTP range requests.
import 'ol/ol.css'
import { apply, type TileGrid as CoreTileGrid, type Point as FramePoint, inverse, type Similarity } from '@course-setter/core'
import { defaults as defaultControls, ScaleLine } from 'ol/control.js'
import Feature from 'ol/Feature.js'
import { type LineString, Point } from 'ol/geom.js'
import type ImageTile from 'ol/ImageTile.js'
import Draw from 'ol/interaction/Draw.js'
import TileLayer from 'ol/layer/Tile.js'
import VectorLayer from 'ol/layer/Vector.js'
import OlMap from 'ol/Map.js'
import Projection from 'ol/proj/Projection.js'
import { addCoordinateTransforms, addProjection } from 'ol/proj.js'
import VectorSource from 'ol/source/Vector.js'
import XYZ from 'ol/source/XYZ.js'
import { Circle, Fill, Stroke, Style, Text } from 'ol/style.js'
import TileState from 'ol/TileState.js'
import TileGrid from 'ol/tilegrid/TileGrid.js'
import View from 'ol/View.js'
import { PMTiles } from 'pmtiles'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatLength } from '../lib/format.ts'
import { Button } from './ui.tsx'

// Blue, so a measurement or a marker never looks like part of a course (courses are purple).
const BLUE = '#0b62a4'

const measureStyle = new Style({
  stroke: new Stroke({ color: BLUE, width: 3 }),
  image: new Circle({ radius: 4, fill: new Fill({ color: BLUE }) }),
})

const markerStyle = (label: string, active: boolean) =>
  new Style({
    image: new Circle({
      radius: 9,
      fill: new Fill({ color: active ? BLUE : 'rgba(255,255,255,0.85)' }),
      stroke: new Stroke({ color: BLUE, width: 2 }),
    }),
    text: new Text({ text: label, font: '600 11px sans-serif', fill: new Fill({ color: active ? '#fff' : BLUE }) }),
  })

export type Marker = { id: string; point: FramePoint; label: string; active?: boolean }

/** Another version drawn over this one, moved into this version's frame by `toThis`. */
export type Overlay = { versionId: string; grid: CoreTileGrid; tilesUrl: string; toThis: Similarity; opacity: number }

type Props = {
  /** Distinguishes one map version from another (the projection is per version). */
  versionId: string
  grid: CoreTileGrid
  tilesUrl: string
  scale: number
  /** Measuring tool on (default) or no tools. */
  tools?: 'measure' | 'none'
  markers?: Marker[]
  /** Called with the frame coordinates of a click. */
  onPick?: (point: FramePoint) => void
  overlay?: Overlay | null
}

export const extentOf = (grid: CoreTileGrid) => [grid.extent.minX, grid.extent.minY, grid.extent.maxX, grid.extent.maxY]

export function projectionFor(versionId: string, grid: CoreTileGrid): Projection {
  const projection = new Projection({ code: `map-frame-${versionId}`, units: 'm', extent: extentOf(grid) })
  // Registered so OpenLayers can reproject another version's tiles onto this one.
  addProjection(projection)
  return projection
}

export function tileSource(grid: CoreTileGrid, tilesUrl: string, projection: Projection): XYZ {
  const archive = new PMTiles(tilesUrl)
  return new XYZ({
    projection,
    tileGrid: new TileGrid({
      origin: grid.origin,
      resolutions: grid.levels.map(l => l.resolution),
      tileSize: grid.tileSize,
      extent: extentOf(grid),
    }),
    tileUrlFunction: ([z, x, y]) => `${z}/${x}/${y}`,
    tileLoadFunction: (tile, key) => {
      const [z, x, y] = key.split('/').map(Number) as [number, number, number]
      const image = (tile as ImageTile).getImage() as HTMLImageElement
      archive.getZxy(z, x, y).then(
        found => {
          // Blank paper is not stored: nothing to draw, the white background shows.
          if (!found) return tile.setState(TileState.EMPTY)
          const url = URL.createObjectURL(new Blob([found.data], { type: 'image/png' }))
          image.onload = () => URL.revokeObjectURL(url)
          image.src = url
        },
        () => tile.setState(TileState.ERROR),
      )
    },
  })
}

export function MapViewer({ versionId, grid, tilesUrl, scale, tools = 'measure', markers, onPick, overlay }: Props) {
  const { t } = useTranslation()
  const target = useRef<HTMLDivElement>(null)
  const mapRef = useRef<OlMap | null>(null)
  const projectionRef = useRef<Projection | null>(null)
  const measureSource = useRef(new VectorSource())
  const markerSource = useRef(new VectorSource())
  const overlayLayer = useRef(new TileLayer({ zIndex: 1 }))
  const drawRef = useRef<Draw | null>(null)
  const pickRef = useRef(onPick)
  pickRef.current = onPick
  const [measuring, setMeasuring] = useState(false)
  const [length, setLength] = useState<number | null>(null)

  useEffect(() => {
    if (!target.current) return
    const extent = extentOf(grid)
    const projection = projectionFor(versionId, grid)
    projectionRef.current = projection
    const finest = grid.levels.at(-1)?.resolution ?? 1

    const map = new OlMap({
      target: target.current,
      layers: [
        new TileLayer({ source: tileSource(grid, tilesUrl, projection) }),
        overlayLayer.current,
        new VectorLayer({ source: measureSource.current, style: measureStyle, zIndex: 2 }),
        new VectorLayer({ source: markerSource.current, zIndex: 3 }),
      ],
      view: new View({
        projection,
        // Two extra steps past the finest tiles, for looking closely at symbols.
        resolutions: [...grid.levels.map(l => l.resolution), finest / 2, finest / 4],
        extent,
        constrainOnlyCenter: true,
      }),
      controls: defaultControls({ rotate: false, attribution: false }).extend([
        new ScaleLine({ units: 'metric', bar: true, text: false, minWidth: 120 }),
      ]),
    })
    map.getView().fit(extent, { padding: [16, 16, 16, 16] })
    map.on('singleclick', e => {
      if (!drawRef.current) pickRef.current?.(e.coordinate as FramePoint)
    })
    mapRef.current = map
    measureSource.current.clear()
    setLength(null)
    return () => {
      map.setTarget(undefined)
      mapRef.current = null
    }
  }, [versionId, grid, tilesUrl])

  // Markers.
  useEffect(() => {
    markerSource.current.clear()
    for (const m of markers ?? []) {
      const feature = new Feature(new Point(m.point))
      feature.setId(m.id)
      feature.setStyle(markerStyle(m.label, m.active ?? false))
      markerSource.current.addFeature(feature)
    }
  }, [markers])

  // The other version, reprojected onto this one through the transform.
  useEffect(() => {
    const projection = projectionRef.current
    if (!overlay || !projection) {
      overlayLayer.current.setSource(null)
      return
    }
    const other = projectionFor(overlay.versionId, overlay.grid)
    const toThis = overlay.toThis
    const back = inverse(toThis)
    addCoordinateTransforms(
      other,
      projection,
      c => apply(toThis, c as FramePoint),
      c => apply(back, c as FramePoint),
    )
    overlayLayer.current.setSource(tileSource(overlay.grid, overlay.tilesUrl, other))
  }, [overlay?.versionId, overlay?.grid, overlay?.tilesUrl, overlay?.toThis, overlay])

  useEffect(() => {
    overlayLayer.current.setOpacity(overlay?.opacity ?? 0.5)
  }, [overlay?.opacity])

  // Measuring.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !measuring) return
    const draw = new Draw({ source: measureSource.current, type: 'LineString', style: measureStyle })
    draw.on('drawstart', e => {
      measureSource.current.clear()
      const geometry = e.feature.getGeometry() as LineString
      geometry.on('change', () => setLength(geometry.getLength()))
    })
    draw.on('drawend', e => setLength((e.feature.getGeometry() as LineString).getLength()))
    map.addInteraction(draw)
    drawRef.current = draw
    return () => {
      map.removeInteraction(draw)
      drawRef.current = null
    }
  }, [measuring])

  const fit = () => mapRef.current?.getView().fit(extentOf(grid), { padding: [16, 16, 16, 16], duration: 200 })
  const clear = () => {
    drawRef.current?.abortDrawing()
    measureSource.current.clear()
    setLength(null)
  }

  return (
    <div className="relative h-full min-h-[320px] overflow-hidden rounded-md border border-line bg-white">
      <div ref={target} data-testid={`map-viewer-${versionId}`} className="absolute inset-0" />
      <div className="absolute top-2 right-2 flex gap-1.5">
        {tools === 'measure' && (
          <Button size="sm" variant={measuring ? 'primary' : 'secondary'} aria-pressed={measuring} onClick={() => setMeasuring(m => !m)}>
            {t('viewer.measure')}
          </Button>
        )}
        <Button size="sm" onClick={fit}>
          {t('viewer.fit')}
        </Button>
      </div>
      {tools === 'measure' && (measuring || length !== null) && (
        <div className="absolute right-2 bottom-2 flex items-center gap-2 rounded border border-line bg-white/95 px-2.5 py-1.5 text-[13px] shadow-sm">
          <span data-testid="measured-length" aria-live="polite">
            {length === null ? t('viewer.measureHelp') : formatLength(length, scale)}
          </span>
          {length !== null && (
            <Button size="sm" onClick={clear}>
              {t('viewer.clear')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

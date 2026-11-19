// Map viewer: OpenLayers in the map version's own frame (ground metres, y up; not Web Mercator), so
// distances on screen are plain Euclidean lengths in metres. Tiles come from the version's PMTiles
// archive through a signed URL, read with HTTP range requests.
import 'ol/ol.css'
import type { TileGrid as CoreTileGrid } from '@course-setter/core'
import { defaults as defaultControls, ScaleLine } from 'ol/control.js'
import type { LineString } from 'ol/geom.js'
import type ImageTile from 'ol/ImageTile.js'
import Draw from 'ol/interaction/Draw.js'
import TileLayer from 'ol/layer/Tile.js'
import VectorLayer from 'ol/layer/Vector.js'
import OlMap from 'ol/Map.js'
import Projection from 'ol/proj/Projection.js'
import VectorSource from 'ol/source/Vector.js'
import XYZ from 'ol/source/XYZ.js'
import { Circle, Fill, Stroke, Style } from 'ol/style.js'
import TileState from 'ol/TileState.js'
import TileGrid from 'ol/tilegrid/TileGrid.js'
import View from 'ol/View.js'
import { PMTiles } from 'pmtiles'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatLength } from '../lib/format.ts'
import { Button } from './ui.tsx'

// Blue, so a measurement never looks like part of a course (courses are purple).
const MEASURE = '#0b62a4'

const measureStyle = new Style({
  stroke: new Stroke({ color: MEASURE, width: 3 }),
  image: new Circle({ radius: 4, fill: new Fill({ color: MEASURE }) }),
})

type Props = {
  /** Distinguishes one map version from another (the projection is per version). */
  versionId: string
  grid: CoreTileGrid
  tilesUrl: string
  scale: number
}

export function MapViewer({ versionId, grid, tilesUrl, scale }: Props) {
  const { t } = useTranslation()
  const target = useRef<HTMLDivElement>(null)
  const mapRef = useRef<OlMap | null>(null)
  const measureSource = useRef(new VectorSource())
  const drawRef = useRef<Draw | null>(null)
  const [measuring, setMeasuring] = useState(false)
  const [length, setLength] = useState<number | null>(null)

  useEffect(() => {
    if (!target.current) return
    const { minX, minY, maxX, maxY } = grid.extent
    const extent = [minX, minY, maxX, maxY]
    const projection = new Projection({ code: `map-frame-${versionId}`, units: 'm', extent })
    const resolutions = grid.levels.map(l => l.resolution)
    const finest = resolutions.at(-1) ?? 1
    const archive = new PMTiles(tilesUrl)

    const source = new XYZ({
      projection,
      tileGrid: new TileGrid({ origin: grid.origin, resolutions, tileSize: grid.tileSize, extent }),
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

    const map = new OlMap({
      target: target.current,
      layers: [new TileLayer({ source }), new VectorLayer({ source: measureSource.current, style: measureStyle })],
      view: new View({
        projection,
        // Two extra steps past the finest tiles, for looking closely at symbols.
        resolutions: [...resolutions, finest / 2, finest / 4],
        extent,
        constrainOnlyCenter: true,
      }),
      controls: defaultControls({ rotate: false, attribution: false }).extend([
        new ScaleLine({ units: 'metric', bar: true, text: false, minWidth: 120 }),
      ]),
    })
    map.getView().fit(extent, { padding: [16, 16, 16, 16] })
    mapRef.current = map
    measureSource.current.clear()
    setLength(null)
    return () => {
      map.setTarget(undefined)
      mapRef.current = null
    }
  }, [versionId, grid, tilesUrl])

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

  const fit = () => {
    const { minX, minY, maxX, maxY } = grid.extent
    mapRef.current?.getView().fit([minX, minY, maxX, maxY], { padding: [16, 16, 16, 16], duration: 200 })
  }
  const clear = () => {
    drawRef.current?.abortDrawing()
    measureSource.current.clear()
    setLength(null)
  }

  return (
    <div className="relative h-full min-h-[420px] overflow-hidden rounded-md border border-line bg-white">
      <div ref={target} data-testid="map-viewer" className="absolute inset-0" />
      <div className="absolute top-2 right-2 flex gap-1.5">
        <Button size="sm" variant={measuring ? 'primary' : 'secondary'} aria-pressed={measuring} onClick={() => setMeasuring(m => !m)}>
          {t('viewer.measure')}
        </Button>
        <Button size="sm" onClick={fit}>
          {t('viewer.fit')}
        </Button>
      </div>
      {(measuring || length !== null) && (
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

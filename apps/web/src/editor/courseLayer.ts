// Draw course symbol primitives (paper mm, from @course-setter/core) on an OpenLayers vector layer.
// Line widths and text sizes are paper sizes at the course's print scale, so they grow and shrink with
// the zoom as they would on paper; the editor shows the course as it will be printed.
import type { Primitive, TileGrid } from '@course-setter/core'
import Feature from 'ol/Feature.js'
import { Circle as CircleGeometry, LineString, Point, Polygon } from 'ol/geom.js'
import type VectorSource from 'ol/source/Vector.js'
import { Fill, Stroke, Style, Text } from 'ol/style.js'

/** Course overprint purple (ISOM "purple", close to Pantone Purple C), drawn with Multiply. */
export const COURSE_PURPLE = '#b5179e'

type Paint = { color: string; lineDash?: number[] }

const mmToMetres = (mm: number, printScale: number) => (mm * printScale) / 1000

/** Features for `primitives` (in paper mm at `printScale`), each styled for whatever zoom is shown. */
export function primitiveFeatures(primitives: Primitive[], printScale: number, paint: Paint = { color: COURSE_PURPLE }): Feature[] {
  const m = (mm: number) => mmToMetres(mm, printScale)
  const point = ([x, y]: [number, number]): [number, number] => [m(x), m(y)]
  return primitives.map(p => {
    const feature =
      p.type === 'circle'
        ? new Feature(new CircleGeometry(point(p.center), m(p.radius)))
        : p.type === 'polyline'
          ? new Feature(
              p.closed
                ? new Polygon([[...p.points.map(point), point(p.points[0] as [number, number])]])
                : new LineString(p.points.map(point)),
            )
          : new Feature(new Point(point(p.at)))
    const widthM = p.type === 'text' ? 0 : m(p.lineWidth)
    const heightM = p.type === 'text' ? m(p.height) : 0
    feature.setStyle((_f, resolution) =>
      p.type === 'text'
        ? new Style({
            text: new Text({
              text: p.text,
              font: `${Math.max(1, heightM / resolution)}px Arial, sans-serif`,
              fill: new Fill({ color: paint.color }),
              textBaseline: 'middle',
            }),
          })
        : new Style({ stroke: new Stroke({ color: paint.color, width: Math.max(1, widthM / resolution), lineDash: paint.lineDash }) }),
    )
    return feature
  })
}

export function replaceFeatures(source: VectorSource, features: Feature[]) {
  source.clear(true)
  source.addFeatures(features)
}

/** Whether a frame point lies on the map version. */
export function onMap(grid: TileGrid, [x, y]: [number, number]): boolean {
  const e = grid.extent
  return x >= e.minX && x <= e.maxX && y >= e.minY && y <= e.maxY
}

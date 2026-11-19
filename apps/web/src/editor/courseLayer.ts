// An OpenLayers layer that draws course symbol primitives (paper mm, from @course-setter/core) with the
// same Canvas 2D backend the print snapshots are checked against. Line widths and text sizes are paper
// sizes at the course's print scale, so they grow and shrink with the zoom as they would on paper: the
// editor shows the course as it will be printed.
//
// The layer draws into its own canvas with the frame's exact map -> pixel transform, so symbols stay in
// place while panning and zooming and nothing is clipped when only part of a course is in view.
import { type DeviceTransform, drawPrimitives, type Primitive, type TileGrid } from '@course-setter/core'
import Layer from 'ol/layer/Layer.js'

/** Course overprint purple (ISOM "purple", close to Pantone Purple C), drawn with Multiply. */
export const COURSE_PURPLE = '#b5179e'

/** Colour, and an optional dash pattern in CSS pixels that replaces the primitives' own (previews). */
export type Paint = { color: string; lineDash?: number[] }

/** Primitives in paper mm at `printScale`, drawn in one colour. */
export type Drawing = { primitives: Primitive[]; printScale: number; paint: Paint }

export type PrimitiveLayer = { layer: Layer; setDrawings: (drawings: Drawing[]) => void }

/** A layer showing whatever drawings were last set. `className` lets CSS blend it (Multiply for overprint). */
export function primitiveLayer(className = '', opacity = 1): PrimitiveLayer {
  const canvas = document.createElement('canvas')
  canvas.className = className
  Object.assign(canvas.style, { position: 'absolute', left: '0', top: '0', opacity: String(opacity), pointerEvents: 'none' })
  let drawings: Drawing[] = []

  const layer = new Layer({
    render: frameState => {
      const [width = 0, height = 0] = frameState.size
      const ratio = frameState.pixelRatio
      const [w, h] = [Math.round(width * ratio), Math.round(height * ratio)]
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
        canvas.style.width = `${width}px`
        canvas.style.height = `${height}px`
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return canvas
      ctx.clearRect(0, 0, w, h)
      // Map metres -> CSS pixels for this frame, then paper mm -> metres and CSS -> device pixels.
      const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = frameState.coordinateToPixelTransform
      for (const drawing of drawings) {
        const k = (drawing.printScale / 1000) * ratio
        const transform: DeviceTransform = [a * k, b * k, c * k, d * k, e * ratio, f * ratio]
        drawPrimitives(ctx, drawing.primitives, {
          transform,
          color: drawing.paint.color,
          dashPx: drawing.paint.lineDash?.map(v => v * ratio),
          minLineWidthPx: ratio,
        })
      }
      return canvas
    },
  })

  return {
    layer,
    setDrawings: next => {
      drawings = next
      layer.changed()
    },
  }
}

/** Whether a frame point lies on the map version. */
export function onMap(grid: TileGrid, [x, y]: [number, number]): boolean {
  const e = grid.extent
  return x >= e.minX && x <= e.maxX && y >= e.minY && y <= e.maxY
}

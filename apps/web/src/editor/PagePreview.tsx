// A small drawing of a printed page without the map: the map area in beige, the course in purple, the
// layout and the description sheet, drawn by the same Canvas backend as the print view. For template
// previews, so a template is seen as it will look on the shown course.
import { drawPrimitives, fontsOnPage, type Primitive, type PrintPage, paperToDevice } from '@course-setter/core'
import { useEffect, useRef, useState } from 'react'
import { loadFonts } from '../lib/fonts.ts'
import { COURSE_PURPLE } from './courseLayer.ts'

const MAP_BEIGE = '#f1ecdf'

export function PagePreview({
  page,
  width,
  images,
  label,
}: {
  page: PrintPage
  width: number
  images?: (asset: string) => object | null
  label: string
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const height = Math.round((width * page.size[1]) / page.size[0])
  const [fontsReady, setFontsReady] = useState(0)

  useEffect(() => {
    let current = true
    loadFonts(fontsOnPage(page))
      .then(() => current && setFontsReady(n => n + 1))
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [page])

  // biome-ignore lint/correctness/useExhaustiveDependencies: drawn again once the fonts have loaded
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx || !canvas.current) return
    const ratio = window.devicePixelRatio || 1
    canvas.current.width = Math.round(width * ratio)
    canvas.current.height = Math.round(height * ratio)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.current.width, canvas.current.height)
    const transform = paperToDevice((width * ratio) / page.size[0], [0, 0], height * ratio)
    const options = { transform, ...(images ? { images } : {}) }
    const map: Primitive = { type: 'path', role: 'layout', commands: page.mapClip, lineWidth: 0, filled: true, color: MAP_BEIGE }
    drawPrimitives(ctx, [map, ...page.whiteAreas.flatMap(w => w.primitives)], { ...options, color: '#000' })
    drawPrimitives(ctx, page.course, { ...options, color: COURSE_PURPLE })
    drawPrimitives(ctx, [...page.mapOutline, ...page.elements.flatMap(e => e.primitives)], { ...options, color: '#000' })
    if (page.descriptions) {
      const b = page.descriptions.box
      const box: Primitive = {
        type: 'path',
        role: 'layout',
        commands: [['M', b.minX, b.minY], ['L', b.maxX, b.minY], ['L', b.maxX, b.maxY], ['L', b.minX, b.maxY], ['Z']],
        lineWidth: 0,
        filled: true,
        color: '#ffffff',
      }
      drawPrimitives(ctx, [box, ...page.descriptions.primitives], { ...options, color: '#000' })
    }
  }, [page, width, height, images, fontsReady])

  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label={label}
      style={{ width, height }}
      className="block bg-white shadow-[0_1px_4px_rgba(29,27,32,0.25)]"
    />
  )
}

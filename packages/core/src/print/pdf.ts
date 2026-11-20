// A printed page as PDF: the map in the map area, the course on top in purple with Multiply (so map
// detail shows through, as overprinting does), and the description sheet in black on white. The worker
// supplies the map (an image of exactly the map area, or the original PDF map page placed at scale).
import {
  clip,
  endPath,
  type PDFDocument,
  type PDFEmbeddedPage,
  type PDFFont,
  type PDFImage,
  PDFName,
  type PDFPage,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  setGraphicsState,
} from 'pdf-lib'
import type { Point } from '../course/doc.ts'
import { drawPrimitivesOnPage, PT_PER_MM } from '../render/pdf.ts'
import type { Bounds } from '../render/primitives.ts'
import type { PrintPage } from './layout.ts'

/** ISOM purple as the editor shows it. */
export const PRINT_PURPLE = rgb(0xb5 / 255, 0x17 / 255, 0x9e / 255)
const BLACK = rgb(0, 0, 0)
const WHITE = rgb(1, 1, 1)

export type MapLayer =
  /** An image of exactly the map area. */
  | { kind: 'image'; image: PDFImage }
  /** A PDF page drawn with its bottom-left corner at `at` (page mm), scaled by `scale` (map paper -> page). */
  | { kind: 'page'; page: PDFEmbeddedPage; at: Point; scale: number }

export type PrintFonts = {
  regular: PDFFont
  bold: PDFFont
  /** Digit height of the fonts as a fraction of their size (Arial and Liberation Sans: about 0.7). */
  digitHeight?: number
}

const pt = (mm: number) => mm * PT_PER_MM

/** Operators that clip what follows to a box (page mm). */
function clipTo(box: Bounds) {
  return [rectangle(pt(box.minX), pt(box.minY), pt(box.maxX - box.minX), pt(box.maxY - box.minY)), clip(), endPath()]
}

/** Add the page to `pdf`. */
export function addPrintPage(pdf: PDFDocument, layout: PrintPage, map: MapLayer | null, fonts: PrintFonts): PDFPage {
  const page = pdf.addPage([pt(layout.size[0]), pt(layout.size[1])])
  const area = layout.mapArea

  if (map) {
    page.pushOperators(pushGraphicsState(), ...clipTo(area))
    if (map.kind === 'image') {
      page.drawImage(map.image, { x: pt(area.minX), y: pt(area.minY), width: pt(area.maxX - area.minX), height: pt(area.maxY - area.minY) })
    } else {
      page.drawPage(map.page, { x: pt(map.at[0]), y: pt(map.at[1]), xScale: map.scale, yScale: map.scale })
    }
    page.pushOperators(popGraphicsState())
  }

  // The course, multiplied onto the map and clipped to the map area.
  const multiply = page.node.newExtGState('Multiply', pdf.context.obj({ Type: 'ExtGState', BM: PDFName.of('Multiply') }))
  page.pushOperators(pushGraphicsState(), setGraphicsState(multiply), ...clipTo(area))
  const textOptions = { font: fonts.regular, boldFont: fonts.bold, ...(fonts.digitHeight ? { digitHeight: fonts.digitHeight } : {}) }
  drawPrimitivesOnPage(page, layout.course, { origin: [0, 0], color: PRINT_PURPLE, ...textOptions })
  page.pushOperators(popGraphicsState())

  if (layout.descriptions) {
    const { box, primitives } = layout.descriptions
    page.drawRectangle({ x: pt(box.minX), y: pt(box.minY), width: pt(box.maxX - box.minX), height: pt(box.maxY - box.minY), color: WHITE })
    drawPrimitivesOnPage(page, primitives, { origin: [0, 0], color: BLACK, ...textOptions })
  }
  return page
}

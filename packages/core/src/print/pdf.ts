// A printed page as PDF: the map in the map area, white areas over it, the course on top in purple with
// Multiply (so map detail shows through, as overprinting does), the print layout's elements (titles, logos, frames …)
// and the description sheet in black on white. The worker supplies the map (an image of exactly the map
// area, or the original PDF map page placed at scale), the fonts and the images the layout uses.
import {
  appendBezierCurve,
  clip,
  closePath,
  endPath,
  lineTo,
  moveTo,
  type PDFDocument,
  type PDFEmbeddedPage,
  type PDFFont,
  type PDFImage,
  PDFName,
  type PDFOperator,
  type PDFPage,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setGraphicsState,
} from 'pdf-lib'
import type { Point } from '../course/doc.ts'
import { drawPrimitivesOnPage, PT_PER_MM } from '../render/pdf.ts'
import type { Bounds, PathCommand } from '../render/primitives.ts'
import type { FontId } from '../text/fonts.ts'
import type { PrintPage } from './layout.ts'

/**
 * Digit height of Liberation Sans (packages/core/fonts, metric-compatible with Arial, OFL) as a fraction
 * of its size: 1409 of 2048 units (Arial's are 1472).
 */
export const FONT_DIGIT_HEIGHT = 1409 / 2048

/** ISOM purple as the editor shows it. */
export const PRINT_PURPLE = rgb(0xb5 / 255, 0x17 / 255, 0x9e / 255)
const BLACK = rgb(0, 0, 0)
const WHITE = rgb(1, 1, 1)

export type MapLayer =
  /** An image placed at `at` (page mm; default: the whole map area, e.g. where the print area runs off the map). */
  | { kind: 'image'; image: PDFImage; at?: Bounds }
  /** A PDF page drawn with its bottom-left corner at `at` (page mm), scaled by `scale` (map paper -> page). */
  | { kind: 'page'; page: PDFEmbeddedPage; at: Point; scale: number }

export type PrintFonts = {
  regular: PDFFont
  bold: PDFFont
  /** Digit height of the fonts as a fraction of their size (Arial and Liberation Sans: about 0.7). */
  digitHeight?: number
  /** The layout's fonts, embedded with FONT_FEATURES; at least those `fontsOnPage` lists. */
  layout?: Partial<Record<FontId, PDFFont>>
}

/** The images the layout's image elements show, by asset id (an image missing throws MissingAssetError). */
export type PrintImages = (asset: string) => PDFImage | PDFEmbeddedPage | null

const pt = (mm: number) => mm * PT_PER_MM

/** Operators that clip what follows to a closed outline (page mm). */
function clipTo(commands: PathCommand[]): PDFOperator[] {
  const ops: PDFOperator[] = commands.map(c =>
    c[0] === 'M'
      ? moveTo(pt(c[1]), pt(c[2]))
      : c[0] === 'L'
        ? lineTo(pt(c[1]), pt(c[2]))
        : c[0] === 'C'
          ? appendBezierCurve(pt(c[1]), pt(c[2]), pt(c[3]), pt(c[4]), pt(c[5]), pt(c[6]))
          : closePath(),
  )
  return [...ops, clip(), endPath()]
}

/** Add the page to `pdf`. */
export function addPrintPage(pdf: PDFDocument, layout: PrintPage, map: MapLayer | null, fonts: PrintFonts, images?: PrintImages): PDFPage {
  const page = pdf.addPage([pt(layout.size[0]), pt(layout.size[1])])
  const area = layout.mapArea

  if (map) {
    page.pushOperators(pushGraphicsState(), ...clipTo(layout.mapClip))
    if (map.kind === 'image') {
      const at = map.at ?? area
      page.drawImage(map.image, { x: pt(at.minX), y: pt(at.minY), width: pt(at.maxX - at.minX), height: pt(at.maxY - at.minY) })
    } else {
      page.drawPage(map.page, { x: pt(map.at[0]), y: pt(map.at[1]), xScale: map.scale, yScale: map.scale })
    }
    page.pushOperators(popGraphicsState())
  }

  // White areas over the map (the course stays on top of them), clipped to the map area.
  if (layout.whiteAreas.length) {
    page.pushOperators(pushGraphicsState(), ...clipTo(layout.mapClip))
    drawPrimitivesOnPage(
      page,
      layout.whiteAreas.flatMap(w => w.primitives),
      { origin: [0, 0], color: WHITE, font: fonts.regular },
    )
    page.pushOperators(popGraphicsState())
  }

  // The course, multiplied onto the map and clipped to the map area.
  const multiply = page.node.newExtGState('Multiply', pdf.context.obj({ Type: 'ExtGState', BM: PDFName.of('Multiply') }))
  page.pushOperators(pushGraphicsState(), setGraphicsState(multiply), ...clipTo(layout.mapClip))
  const textOptions = {
    font: fonts.regular,
    boldFont: fonts.bold,
    ...(fonts.digitHeight ? { digitHeight: fonts.digitHeight } : {}),
    ...(fonts.layout ? { fonts: fonts.layout } : {}),
    ...(images ? { images } : {}),
  }
  drawPrimitivesOnPage(page, layout.course, { origin: [0, 0], color: PRINT_PURPLE, ...textOptions })
  page.pushOperators(popGraphicsState())

  // The layout, as it is (no Multiply): a white band or backing covers the map and the course.
  drawPrimitivesOnPage(
    page,
    layout.elements.flatMap(e => e.primitives),
    { origin: [0, 0], color: BLACK, ...textOptions },
  )

  if (layout.descriptions) {
    const { box, primitives } = layout.descriptions
    page.drawRectangle({ x: pt(box.minX), y: pt(box.minY), width: pt(box.maxX - box.minX), height: pt(box.maxY - box.minY), color: WHITE })
    drawPrimitivesOnPage(page, primitives, { origin: [0, 0], color: BLACK, ...textOptions })
  }
  return page
}

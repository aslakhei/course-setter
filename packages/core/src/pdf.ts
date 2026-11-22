// The parts of core that need pdf-lib, exported separately (@course-setter/core/pdf) so pdf-lib stays
// out of the web app's bundle.

export { addPrintPage, FONT_DIGIT_HEIGHT, type MapLayer, PRINT_PURPLE, type PrintFonts, type PrintImages } from './print/pdf.ts'
export { drawPrimitivesOnPage, MissingAssetError, type PdfOptions, PT_PER_MM, pdfColor } from './render/pdf.ts'

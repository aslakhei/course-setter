// The parts of core that need pdf-lib, exported separately (@course-setter/core/pdf) so pdf-lib stays
// out of the web app's bundle.

export { addPrintPage, type MapLayer, PRINT_PURPLE, type PrintFonts } from './print/pdf.ts'
export { drawPrimitivesOnPage, type PdfOptions, PT_PER_MM } from './render/pdf.ts'

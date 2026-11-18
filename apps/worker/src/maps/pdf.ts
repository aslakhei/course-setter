// PDF maps: mupdf renders any region of the first page. The page size gives paper millimetres; the
// scale comes from the admin (a PDF does not store it). The map frame's origin is the page's
// bottom-left corner.
import * as mupdf from 'mupdf'
import { MapError, type MapSource, PT_PER_MM, type Region } from './source.ts'

export function loadPdf(file: Buffer, scale: number): MapSource {
  if (file.subarray(0, 5).toString('latin1') !== '%PDF-') throw new MapError('not_pdf', 'The file is not a PDF.')
  let page: mupdf.Page
  let list: mupdf.DisplayList
  try {
    const doc = mupdf.Document.openDocument(file, 'application/pdf')
    if (doc.countPages() < 1) throw new Error('no pages')
    page = doc.loadPage(0)
    // Recorded once, replayed for every region: much faster than interpreting the page each time.
    list = page.toDisplayList()
  } catch (err) {
    if (err instanceof MapError) throw err
    throw new MapError('unreadable_file', `The PDF could not be read: ${(err as Error).message}`)
  }
  const [x0, y0, x1, y1] = page.getBounds()
  const widthMm = (x1 - x0) / PT_PER_MM
  const heightMm = (y1 - y0) / PT_PER_MM

  return {
    kind: 'pdf',
    widthMm,
    heightMm,
    scale,
    origin: [0, (heightMm / 1000) * scale],
    georef: null,
    ocadVersion: null,
    render(region: Region, mmPerPx: number): Buffer {
      const pxPerPt = 1 / (mmPerPx * PT_PER_MM)
      const matrix = mupdf.Matrix.concat(mupdf.Matrix.translate(-x0, -y0), mupdf.Matrix.scale(pxPerPt, pxPerPt))
      const pixmap = new mupdf.Pixmap(
        mupdf.ColorSpace.DeviceRGB,
        [region.x, region.y, region.x + region.width, region.y + region.height],
        false,
      )
      try {
        pixmap.clear(255)
        const device = new mupdf.DrawDevice(matrix, pixmap)
        list.run(device, mupdf.Matrix.identity)
        device.close()
        device.destroy()
        const pixels = pixmap.getPixels()
        const stride = pixmap.getStride()
        const rowBytes = region.width * 3
        const rgb = Buffer.allocUnsafe(rowBytes * region.height)
        for (let y = 0; y < region.height; y++) rgb.set(pixels.subarray(y * stride, y * stride + rowBytes), y * rowBytes)
        return rgb
      } finally {
        pixmap.destroy()
      }
    },
  }
}

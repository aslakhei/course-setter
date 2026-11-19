import { groundMToPaperMm } from '@course-setter/core'

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const integer = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })
const oneDecimal = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** "18 Nov 2026" */
export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso))
}

/** "1:15 000", with a thin space as the thousands separator as on printed maps. */
export function formatScale(scale: number): string {
  return `1:${integer.format(scale).replace(/,/g, ' ')}`
}

/** "1 250 m · 83.3 mm at 1:15 000": ground length, and what it measures on paper at the map scale. */
export function formatLength(metres: number, scale: number): string {
  const ground = metres >= 100 ? integer.format(metres).replace(/,/g, ' ') : oneDecimal.format(metres)
  return `${ground} m · ${oneDecimal.format(groundMToPaperMm(metres, scale))} mm at ${formatScale(scale)}`
}

/** "5.4 MB" */
export function formatBytes(bytes: number): string {
  return `${oneDecimal.format(bytes / 1e6)} MB`
}

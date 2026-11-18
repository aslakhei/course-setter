const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/** "18 Nov 2026" */
export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso))
}

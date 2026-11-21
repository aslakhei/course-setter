/** A file name without characters file systems refuse ("H21: long/short" -> "H21- long-short"). */
export const safeFileName = (name: string) =>
  [...name]
    .map(ch => (ch.charCodeAt(0) < 32 || '/:*?"<>|'.includes(ch) ? '-' : ch))
    .join('')
    .trim() || 'course'

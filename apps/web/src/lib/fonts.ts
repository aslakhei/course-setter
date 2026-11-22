// The print layout's fonts in the browser: the same files the worker embeds in PDFs (packages/core/fonts),
// so text measures and looks the same in the print view and on paper. Each is loaded when a page first
// uses it.
import { FONTS, type FontId } from '@course-setter/core'
import sansBold from '@course-setter/core/fonts/LiberationSans-Bold.ttf?url'
import sans from '@course-setter/core/fonts/LiberationSans-Regular.ttf?url'
import displayBold from '@course-setter/core/fonts/Oswald-Bold.ttf?url'
import display from '@course-setter/core/fonts/Oswald-Regular.ttf?url'
import condensedBold from '@course-setter/core/fonts/RobotoCondensed-Bold.ttf?url'
import condensed from '@course-setter/core/fonts/RobotoCondensed-Regular.ttf?url'
import serifBold from '@course-setter/core/fonts/SourceSerif4-Bold.ttf?url'
import serif from '@course-setter/core/fonts/SourceSerif4-Regular.ttf?url'

const URLS: Record<FontId, string> = {
  sans,
  'sans-bold': sansBold,
  condensed,
  'condensed-bold': condensedBold,
  display,
  'display-bold': displayBold,
  serif,
  'serif-bold': serifBold,
}

const loading = new Map<FontId, Promise<void>>()

/** Loads the fonts (once each) under the family names the Canvas backend asks for. */
export function loadFonts(ids: FontId[]): Promise<void> {
  return Promise.all(
    ids.map(id => {
      let done = loading.get(id)
      if (!done) {
        const { family, weight } = FONTS[id]
        const face = new FontFace(family, `url(${URLS[id]})`, { weight: String(weight) })
        done = face.load().then(loaded => {
          document.fonts.add(loaded)
        })
        // A failed load can be tried again next time.
        done.catch(() => loading.delete(id))
        loading.set(id, done)
      }
      return done
    }),
  ).then(() => undefined)
}

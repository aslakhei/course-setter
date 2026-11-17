import { renderToString } from 'react-dom/server'
import { expect, it } from 'vitest'
import { App } from './App.tsx'
import './i18n.ts'

it('renders translated text and a value computed by @course-setter/core', () => {
  const html = renderToString(<App />)
  expect(html).toContain('Course setter')
  expect(html).toContain('66.7 mm')
})

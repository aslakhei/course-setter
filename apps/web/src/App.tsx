import { groundMToPaperMm } from '@course-setter/core'
import { useTranslation } from 'react-i18next'

export function App() {
  const { t } = useTranslation()
  return (
    <main>
      <h1>{t('app.title')}</h1>
      <p>{t('app.tagline')}</p>
      <p>{t('scaleExample', { mm: groundMToPaperMm(1000, 15000).toFixed(1) })}</p>
    </main>
  )
}

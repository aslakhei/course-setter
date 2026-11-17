import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json' with { type: 'json' }

// English only for now; adding a language = adding a locales/<lang>.json file here.
export const resources = { en: { translation: en } } as const

void i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  resources,
  initAsync: false,
  interpolation: { escapeValue: false }, // React already escapes
})

export default i18n

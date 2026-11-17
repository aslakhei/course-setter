import { groundMToPaperMm } from '@course-setter/core'
import { useTranslation } from 'react-i18next'

export type AuthState = { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; name: string }

type Props = {
  auth: AuthState
  onSignIn: () => void
  onSignOut: () => void
}

export function Home({ auth, onSignIn, onSignOut }: Props) {
  const { t } = useTranslation()
  return (
    <main>
      <h1>{t('app.title')}</h1>
      <p>{t('app.tagline')}</p>
      <p>{t('scaleExample', { mm: groundMToPaperMm(1000, 15000).toFixed(1) })}</p>
      {auth.status === 'loading' && <p>{t('auth.loading')}</p>}
      {auth.status === 'signedOut' && (
        <button type="button" onClick={onSignIn}>
          {t('auth.signInWithGoogle')}
        </button>
      )}
      {auth.status === 'signedIn' && (
        <p>
          {t('auth.signedInAs', { name: auth.name })}{' '}
          <button type="button" onClick={onSignOut}>
            {t('auth.signOut')}
          </button>
        </p>
      )}
    </main>
  )
}

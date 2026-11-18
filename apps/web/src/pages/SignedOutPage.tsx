import { useTranslation } from 'react-i18next'
import { signInWithGoogle } from '../auth/useSession.ts'
import { BrandMark } from '../components/BrandMark.tsx'
import { Button } from '../components/ui.tsx'

/** Shown instead of any signed-in page; signing in returns to the same URL. */
export function SignedOutPage({ message }: { message?: string }) {
  const { t } = useTranslation()
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-md border border-line bg-white p-8">
        <div className="flex items-center gap-2 text-lg font-bold">
          <span className="text-brand-600">
            <BrandMark size={24} />
          </span>
          {t('app.title')}
        </div>
        <p className="m-0 text-body">{t('app.tagline')}</p>
        <p className="m-0">{message ?? t('auth.signInPrompt')}</p>
        <Button variant="primary" size="lg" onClick={() => void signInWithGoogle()}>
          {t('auth.signInWithGoogle')}
        </Button>
      </div>
    </main>
  )
}

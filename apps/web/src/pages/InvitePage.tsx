import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { useSession } from '../auth/useSession.ts'
import { BrandMark } from '../components/BrandMark.tsx'
import { Button, ErrorMessage, Loading } from '../components/ui.tsx'
import { useAcceptInvite, useInviteInfo } from '../lib/api.ts'
import { SignedOutPage } from './SignedOutPage.tsx'

/** /invite/:token. Works signed out too: signing in comes back here. */
export function InvitePage() {
  const { t } = useTranslation()
  const session = useSession()
  if (session === undefined) return <Loading label={t('common.loading')} />
  if (session === null) return <SignedOutPage message={t('invite.signedOut')} />
  return <InviteCard />
}

function InviteCard() {
  const { t } = useTranslation()
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const info = useInviteInfo(token)
  const accept = useAcceptInvite()

  let body: React.ReactNode
  if (info.isError) {
    body = <ErrorMessage>{t('common.error')}</ErrorMessage>
  } else if (info.data === undefined) {
    body = <p className="m-0 text-muted">{t('common.loading')}</p>
  } else if (info.data === null) {
    body = (
      <>
        <p className="m-0">{t('invite.unknown')}</p>
        <Link to="/">{t('club.backToClubs')}</Link>
      </>
    )
  } else {
    const { clubId, clubName, status, alreadyMember } = info.data
    if (alreadyMember) {
      body = (
        <>
          <p className="m-0">{t('invite.alreadyMember', { club: clubName })}</p>
          <Link to={`/clubs/${clubId}`}>{t('invite.openClub', { club: clubName })}</Link>
        </>
      )
    } else if (status !== 'valid') {
      body = (
        <>
          <p className="m-0">{t(status === 'expired' ? 'invite.expired' : 'invite.revoked', { club: clubName })}</p>
          <Link to="/">{t('club.backToClubs')}</Link>
        </>
      )
    } else {
      body = (
        <>
          <p className="m-0">{t('invite.valid', { club: clubName })}</p>
          {accept.isError && <ErrorMessage>{t('invite.unknown')}</ErrorMessage>}
          <Button
            variant="primary"
            size="lg"
            disabled={accept.isPending}
            onClick={() => accept.mutate(token, { onSuccess: id => navigate(`/clubs/${id}`, { replace: true }) })}
          >
            {t('invite.join', { club: clubName })}
          </Button>
        </>
      )
    }
  }

  return (
    <main className="flex justify-center px-4 py-16">
      <div className="flex w-full max-w-md flex-col items-start gap-4 rounded-md border border-line bg-white p-8 [&>button]:self-stretch">
        <h1 className="m-0 flex items-center gap-2 text-lg font-bold">
          <span className="text-brand-600">
            <BrandMark size={22} />
          </span>
          {t('invite.heading')}
        </h1>
        {body}
      </div>
    </main>
  )
}

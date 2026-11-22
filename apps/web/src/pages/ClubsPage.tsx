import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { useSession } from '../auth/useSession.ts'
import { ClubBadge } from '../components/ClubBadge.tsx'
import { Button, ErrorMessage, fieldClass, Loading, Panel } from '../components/ui.tsx'
import { type MyClub, useCreateClub, useMyClubs } from '../lib/api.ts'

export function ClubsPage() {
  const session = useSession()
  const clubs = useMyClubs(session?.user.id ?? '')
  return <ClubsView clubs={clubs.data} failed={clubs.isError} />
}

export function ClubsView({ clubs, failed }: { clubs: MyClub[] | undefined; failed: boolean }) {
  const { t } = useTranslation()
  return (
    <main className="mx-auto flex max-w-[1200px] flex-wrap items-start gap-3.5 px-5 py-6">
      <Panel title={t('clubs.heading')} titleId="clubs-heading" className="min-w-0 flex-[999_1_480px]">
        {failed ? (
          <div className="px-3.5 py-4">
            <ErrorMessage>{t('common.error')}</ErrorMessage>
          </div>
        ) : clubs === undefined ? (
          <Loading label={t('common.loading')} />
        ) : clubs.length === 0 ? (
          <p className="m-0 px-3.5 py-6 text-body">{t('clubs.empty')}</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {clubs.map((club, i) => (
              <li key={club.id} className={i > 0 ? 'border-t border-line-soft' : ''}>
                <Link
                  to={`/clubs/${club.id}`}
                  className="flex items-center gap-3 px-3.5 py-2.5 text-ink no-underline hover:bg-subtle hover:text-ink"
                >
                  <ClubBadge name={club.name} logoAssetId={club.logoAssetId} size={32} />
                  <span className="grow font-semibold">{club.name}</span>
                  <span className="text-[13px] text-muted">{t(`roles.${club.role}`)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <CreateClubPanel />
    </main>
  )
}

function CreateClubPanel() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const createClub = useCreateClub()
  const [name, setName] = useState('')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    createClub.mutate(name, { onSuccess: clubId => navigate(`/clubs/${clubId}`) })
  }

  return (
    <Panel title={t('clubs.createHeading')} titleId="create-club-heading" className="flex-[1_1_320px]">
      <form onSubmit={submit} className="flex flex-col gap-2.5 px-3.5 py-3">
        <span className="text-body">{t('clubs.createHelp')}</span>
        <label htmlFor="club-name" className="text-[13px] font-semibold">
          {t('clubs.nameLabel')}
        </label>
        <input id="club-name" className={fieldClass} value={name} maxLength={100} required onChange={e => setName(e.target.value)} />
        {createClub.isError && <ErrorMessage>{t('common.error')}</ErrorMessage>}
        <Button type="submit" variant="primary" disabled={createClub.isPending || name.trim() === ''} className="self-start">
          {t('clubs.create')}
        </Button>
      </form>
    </Panel>
  )
}

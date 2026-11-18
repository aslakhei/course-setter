import { useTranslation } from 'react-i18next'
import { Link, NavLink, Outlet, useOutletContext, useParams } from 'react-router'
import { useSession } from '../auth/useSession.ts'
import { ClubMark, ErrorMessage, Loading } from '../components/ui.tsx'
import { type Club, type Member, useClub, useMembers } from '../lib/api.ts'

export type ClubContext = { club: Club; members: Member[]; me: Member; isAdmin: boolean }

/** The club's pages get the club, its members and the signed-in user's membership from here. */
export function useClubContext(): ClubContext {
  return useOutletContext<ClubContext>()
}

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `px-2.5 py-2 no-underline ${isActive ? 'font-semibold text-ink shadow-[inset_0_-2px_0_var(--color-brand-600)] hover:text-ink' : 'text-body hover:text-ink'}`

export function ClubLayout() {
  const { t } = useTranslation()
  const { clubId = '' } = useParams()
  const session = useSession()
  const club = useClub(clubId)
  const members = useMembers(clubId)

  if (club.isError || members.isError) {
    return (
      <main className="mx-auto max-w-[1200px] px-5 py-6">
        <ErrorMessage>{t('common.error')}</ErrorMessage>
      </main>
    )
  }
  if (club.data === undefined || members.data === undefined) return <Loading label={t('common.loading')} />

  const me = members.data.find(m => m.userId === session?.user.id)
  if (club.data === null || !me) {
    return (
      <main className="mx-auto flex max-w-[1200px] flex-col items-start gap-2 px-5 py-6">
        <p className="m-0">{t('club.notFound')}</p>
        <Link to="/">{t('club.backToClubs')}</Link>
      </main>
    )
  }

  const isAdmin = me.role === 'admin'
  const context: ClubContext = { club: club.data, members: members.data, me, isAdmin }

  return (
    <>
      <div className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-2 px-5 pt-3.5">
          <div className="flex flex-wrap items-center gap-3">
            <ClubMark name={club.data.name} />
            <h1 className="m-0 text-xl font-bold tracking-[-0.01em]">{club.data.name}</h1>
            <span className="text-[13px] text-muted">
              {t('club.memberCount', { count: members.data.length })} · {t(`roles.${me.role}`)}
            </span>
          </div>
          <nav aria-label={t('club.tabs.label')} className="-ml-2.5 flex gap-0.5 overflow-x-auto">
            <NavLink to="" end className={tabClass}>
              {t('club.tabs.overview')}
            </NavLink>
            <NavLink to="maps" className={tabClass}>
              {t('club.tabs.maps')}
            </NavLink>
            <NavLink to="events" className={tabClass}>
              {t('club.tabs.events')}
            </NavLink>
            <NavLink to="members" className={tabClass}>
              {t('club.tabs.members')}
            </NavLink>
            {isAdmin && (
              <NavLink to="settings" className={tabClass}>
                {t('club.tabs.settings')}
              </NavLink>
            )}
          </nav>
        </div>
      </div>
      <Outlet context={context} />
    </>
  )
}

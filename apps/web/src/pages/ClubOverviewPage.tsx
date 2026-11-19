import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { CopyButton } from '../components/CopyButton.tsx'
import { CalendarIcon, MapIcon } from '../components/icons.tsx'
import { Avatar, EmptyState, Loading, Panel } from '../components/ui.tsx'
import { inviteUrl, isActive, useInvites } from '../lib/api.ts'
import { useEvents } from '../lib/events.ts'
import { formatDate } from '../lib/format.ts'
import { useMaps } from '../lib/maps.ts'
import { EventRow } from './ClubEventsPage.tsx'
import { useClubContext } from './ClubLayout.tsx'
import { MapRow } from './ClubMapsPage.tsx'

const MEMBERS_SHOWN = 8

export function ClubOverviewPage() {
  const { t } = useTranslation()
  const { members, me, isAdmin } = useClubContext()

  return (
    <main className="mx-auto grid max-w-[1200px] grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] items-start gap-3.5 px-5 pt-4 pb-8">
      <OverviewMaps />

      <OverviewEvents />

      <Panel
        title={
          <>
            {t('members.heading')} <span className="font-normal text-muted">{members.length}</span>
          </>
        }
        titleId="overview-members"
        actions={
          <Link to="members" className="text-[13px]">
            {isAdmin ? t('members.manage') : t('members.viewAll')}
          </Link>
        }
      >
        <ul className="m-0 list-none py-1 pl-0">
          {members.slice(0, MEMBERS_SHOWN).map(member => (
            <li key={member.userId} className="flex items-center gap-2.5 px-3.5 py-1.5">
              <Avatar name={member.name || t('members.unnamed')} url={member.avatarUrl} seed={member.userId} size={26} />
              <span className="grow">
                {member.name || t('members.unnamed')} {member.userId === me.userId && <span className="text-muted">{t('common.you')}</span>}
              </span>
              <span className={`text-[13px] ${member.role === 'admin' ? 'font-semibold' : 'text-muted'}`}>{t(`roles.${member.role}`)}</span>
            </li>
          ))}
        </ul>
      </Panel>

      {isAdmin && <InviteSummary />}
    </main>
  )
}

const MAPS_SHOWN = 6
const EVENTS_SHOWN = 5

function OverviewEvents() {
  const { t } = useTranslation()
  const { club } = useClubContext()
  const events = useEvents(club.id)
  const shown = events.data?.slice(0, EVENTS_SHOWN)
  return (
    <Panel
      title={t('events.recent')}
      titleId="overview-events"
      actions={
        <Link to="events" className="text-[13px]">
          {t('events.all')}
        </Link>
      }
    >
      {shown === undefined ? (
        <Loading label={t('common.loading')} />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={
            <span className="text-[#a59fa9]">
              <CalendarIcon />
            </span>
          }
          title={t('events.empty')}
        >
          {t('events.emptyHelp')}
        </EmptyState>
      ) : (
        <ul className="m-0 list-none p-0">
          {shown.map((event, i) => (
            <EventRow key={event.id} event={event} first={i === 0} linkPrefix="events/" />
          ))}
        </ul>
      )}
    </Panel>
  )
}

function OverviewMaps() {
  const { t } = useTranslation()
  const { club, isAdmin } = useClubContext()
  const maps = useMaps(club.id)
  const shown = maps.data?.slice(0, MAPS_SHOWN)

  return (
    <Panel
      title={t('maps.heading')}
      titleId="overview-maps"
      actions={
        <Link to="maps" className="text-[13px]">
          {t('maps.all')}
        </Link>
      }
    >
      {shown === undefined ? (
        <Loading label={t('common.loading')} />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={
            <span className="text-[#a59fa9]">
              <MapIcon />
            </span>
          }
          title={t('maps.empty')}
        >
          {isAdmin ? t('maps.emptyAdmin') : t('maps.emptyMember')}
        </EmptyState>
      ) : (
        <ul className="m-0 list-none p-0">
          {shown.map((map, i) => (
            <MapRow key={map.id} map={map} first={i === 0} linkPrefix="maps/" />
          ))}
        </ul>
      )}
    </Panel>
  )
}

function InviteSummary() {
  const { t } = useTranslation()
  const { club } = useClubContext()
  const invites = useInvites(club.id, true)
  const latest = invites.data?.find(i => isActive(i))

  return (
    <Panel title={t('invites.inviteHeading')} titleId="overview-invite">
      <div className="flex flex-col gap-2.5 px-3.5 py-3">
        <span className="text-body">{t('invites.shareHelp')}</span>
        {latest ? (
          <>
            <div className="flex items-center gap-2 rounded border border-line bg-canvas px-2.5 py-2">
              <code className="min-w-0 grow truncate font-mono text-xs">{inviteUrl(latest.token)}</code>
              <CopyButton text={inviteUrl(latest.token)} label={t('invites.linkLabel')} />
            </div>
            <span className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-muted">
              <span>{t('invites.expires', { date: formatDate(latest.expiresAt) })}</span>
              <Link to="members" className="ml-auto">
                {t('invites.manage')}
              </Link>
            </span>
          </>
        ) : (
          <span className="flex flex-wrap gap-x-3 text-[13px] text-muted">
            <span>{t('invites.none')}</span>
            <Link to="members" className="ml-auto">
              {t('invites.create')}
            </Link>
          </span>
        )}
      </div>
    </Panel>
  )
}

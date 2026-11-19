import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { useSession } from '../auth/useSession.ts'
import { CalendarIcon } from '../components/icons.tsx'
import { Button, EmptyState, ErrorMessage, fieldClass, Loading, Panel } from '../components/ui.tsx'
import { type EventSummary, useCreateEvent, useDeleteEvent, useEvents } from '../lib/events.ts'
import { formatDate } from '../lib/format.ts'
import { latestReady, useMaps } from '../lib/maps.ts'
import { useClubContext } from './ClubLayout.tsx'

export function ClubEventsPage() {
  return (
    <main className="mx-auto flex max-w-[1200px] flex-wrap items-start gap-3.5 px-5 pt-4 pb-8">
      <EventsPanel />
      <CreateEventPanel />
    </main>
  )
}

function EventsPanel() {
  const { t } = useTranslation()
  const { club } = useClubContext()
  const events = useEvents(club.id)
  return (
    <Panel title={t('events.heading')} titleId="events-heading" className="flex-[999_1_560px]">
      {events.isError ? (
        <div className="px-3.5 py-3">
          <ErrorMessage>{t('common.error')}</ErrorMessage>
        </div>
      ) : events.data === undefined ? (
        <Loading label={t('common.loading')} />
      ) : events.data.length === 0 ? (
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
          {events.data.map((event, i) => (
            <EventRow key={event.id} event={event} first={i === 0} />
          ))}
        </ul>
      )}
    </Panel>
  )
}

export function EventRow({ event, first, linkPrefix = '' }: { event: EventSummary; first: boolean; linkPrefix?: string }) {
  const { t } = useTranslation()
  const session = useSession()
  const { club, isAdmin } = useClubContext()
  const remove = useDeleteEvent(club.id)
  const canDelete = isAdmin || event.createdBy === session?.user.id
  return (
    <li className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 ${first ? '' : 'border-t border-line-soft'}`}>
      <Link to={`${linkPrefix}${event.id}`} className="font-semibold">
        {event.name}
      </Link>
      {event.date && <span className="text-[13px]">{formatDate(event.date)}</span>}
      <span className="text-[13px] text-muted">{t('events.onMap', { map: event.mapName, version: event.mapVersion })}</span>
      <span className="grow" />
      <span className="text-xs text-muted">{t('events.updated', { date: formatDate(event.updatedAt) })}</span>
      {canDelete && !linkPrefix && (
        <Button
          size="sm"
          variant="danger"
          disabled={remove.isPending}
          onClick={() => window.confirm(t('events.deleteConfirm', { event: event.name })) && remove.mutate(event.id)}
        >
          {t('events.delete')}
        </Button>
      )}
    </li>
  )
}

function CreateEventPanel() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { club } = useClubContext()
  const maps = useMaps(club.id)
  const create = useCreateEvent(club.id)
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [map, setMap] = useState('')

  const choices = (maps.data ?? []).flatMap(m => {
    const v = latestReady(m)
    return v ? [{ versionId: v.id, label: t('events.mapOption', { map: m.name, version: v.version }) }] : []
  })
  const versionId = map || choices[0]?.versionId || ''

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !versionId) return
    create.mutate({ name, mapVersionId: versionId, date: date || null }, { onSuccess: id => navigate(id) })
  }

  return (
    <Panel title={t('events.createHeading')} titleId="create-event-heading" className="flex-[1_1_320px]">
      {maps.data !== undefined && choices.length === 0 ? (
        <p className="m-0 px-3.5 py-3 text-body">{t('events.noMaps')}</p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-2.5 px-3.5 py-3">
          <span className="text-body">{t('events.createHelp')}</span>
          <label htmlFor="event-name" className="text-[13px] font-semibold">
            {t('events.name')}
          </label>
          <input id="event-name" className={fieldClass} value={name} maxLength={120} required onChange={e => setName(e.target.value)} />
          <label htmlFor="event-date" className="text-[13px] font-semibold">
            {t('events.date')}
          </label>
          <input id="event-date" type="date" className={fieldClass} value={date} onChange={e => setDate(e.target.value)} />
          <label htmlFor="event-map" className="text-[13px] font-semibold">
            {t('events.map')}
          </label>
          <select id="event-map" className={fieldClass} value={versionId} onChange={e => setMap(e.target.value)}>
            {choices.map(c => (
              <option key={c.versionId} value={c.versionId}>
                {c.label}
              </option>
            ))}
          </select>
          {create.isError && <ErrorMessage>{t('common.error')}</ErrorMessage>}
          <Button type="submit" variant="primary" className="self-start" disabled={!name.trim() || !versionId || create.isPending}>
            {t('events.create')}
          </Button>
        </form>
      )}
    </Panel>
  )
}

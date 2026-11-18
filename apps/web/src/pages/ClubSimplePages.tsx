import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarIcon, MapIcon } from '../components/icons.tsx'
import { Button, EmptyState, ErrorMessage, fieldClass, Panel } from '../components/ui.tsx'
import { useRenameClub } from '../lib/api.ts'
import { useClubContext } from './ClubLayout.tsx'

const pageClass = 'mx-auto flex max-w-[1200px] flex-col gap-3.5 px-5 pt-4 pb-8'

export function ClubMapsPage() {
  const { t } = useTranslation()
  return (
    <main className={pageClass}>
      <Panel title={t('maps.heading')} titleId="maps-heading">
        <EmptyState
          icon={
            <span className="text-[#a59fa9]">
              <MapIcon />
            </span>
          }
          title={t('maps.empty')}
        >
          {t('maps.emptyHelp')}
        </EmptyState>
      </Panel>
    </main>
  )
}

export function ClubEventsPage() {
  const { t } = useTranslation()
  return (
    <main className={pageClass}>
      <Panel title={t('events.heading')} titleId="events-heading">
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
      </Panel>
    </main>
  )
}

export function ClubSettingsPage() {
  const { t } = useTranslation()
  const { club, isAdmin } = useClubContext()
  const rename = useRenameClub(club.id)
  const [name, setName] = useState(club.name)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    rename.mutate(name)
  }

  return (
    <main className={pageClass}>
      <Panel title={t('settings.heading')} titleId="settings-heading" className="max-w-xl">
        {isAdmin ? (
          <form onSubmit={submit} className="flex flex-col gap-2 px-3.5 py-3">
            <label htmlFor="club-rename" className="text-[13px] font-semibold">
              {t('clubs.nameLabel')}
            </label>
            <span className="text-[13px] text-muted">{t('settings.nameHelp')}</span>
            <span className="flex gap-2">
              <input
                id="club-rename"
                className={`${fieldClass} grow`}
                value={name}
                maxLength={100}
                required
                onChange={e => setName(e.target.value)}
              />
              <Button type="submit" variant="primary" disabled={rename.isPending || name.trim() === '' || name.trim() === club.name}>
                {t('common.save')}
              </Button>
            </span>
            {rename.isError && <ErrorMessage>{t('common.error')}</ErrorMessage>}
            {rename.isSuccess && <span className="text-[13px] text-muted">{t('common.saved')}</span>}
          </form>
        ) : (
          <p className="m-0 px-3.5 py-3 text-muted">{t('settings.adminsOnly')}</p>
        )}
      </Panel>
    </main>
  )
}

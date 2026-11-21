import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Button, ErrorMessage, fieldClass, Panel } from '../components/ui.tsx'
import { useDeleteClub } from '../lib/account.ts'
import { useRenameClub } from '../lib/api.ts'
import { useClubContext } from './ClubLayout.tsx'

const pageClass = 'mx-auto flex max-w-[1200px] flex-col gap-3.5 px-5 pt-4 pb-8'

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
      {isAdmin && <DeleteClub clubId={club.id} clubName={club.name} />}
    </main>
  )
}

/** Deleting the club for everyone, confirmed by typing its name. */
function DeleteClub({ clubId, clubName }: { clubId: string; clubName: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const remove = useDeleteClub(clubId)
  const [typed, setTyped] = useState('')
  return (
    <Panel title={t('settings.deleteHeading')} titleId="club-delete-heading" className="max-w-xl">
      <div className="flex flex-col gap-2 px-3.5 py-3">
        <p className="m-0 text-[14px]">{t('settings.deleteHelp')}</p>
        <label htmlFor="club-delete-name" className="text-[13px] font-semibold">
          {t('settings.deleteConfirm', { name: clubName })}
        </label>
        <span className="flex gap-2">
          <input id="club-delete-name" className={`${fieldClass} grow`} value={typed} onChange={e => setTyped(e.target.value)} />
          <Button
            variant="danger"
            disabled={typed.trim() !== clubName.trim() || remove.isPending}
            onClick={() => remove.mutate(undefined, { onSuccess: () => navigate('/') })}
          >
            {t('settings.delete')}
          </Button>
        </span>
        {remove.isError && <ErrorMessage>{t('common.error')}</ErrorMessage>}
      </div>
    </Panel>
  )
}

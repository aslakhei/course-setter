import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useSession } from '../auth/useSession.ts'
import { ImageLibrary } from '../components/ImageLibrary.tsx'
import { Avatar, Button, ErrorMessage, Panel } from '../components/ui.tsx'
import { downloadMyData, OnlyAdmin, useDeleteAccount } from '../lib/account.ts'

const pageClass = 'mx-auto flex max-w-[1200px] flex-col gap-3.5 px-5 pt-4 pb-8'

/** /account: who you are signed in as, your images, downloading your data and deleting your account. */
export function AccountPage() {
  const { t } = useTranslation()
  const session = useSession()
  const navigate = useNavigate()
  const remove = useDeleteAccount()
  const [downloading, setDownloading] = useState(false)
  const [downloadFailed, setDownloadFailed] = useState(false)
  const [sure, setSure] = useState(false)
  if (!session) return null
  const user = session.user
  const name = (user.user_metadata.full_name as string | undefined) ?? (user.user_metadata.name as string | undefined) ?? user.email ?? ''
  const avatarUrl = (user.user_metadata.avatar_url as string | undefined) ?? null

  const download = async () => {
    setDownloading(true)
    setDownloadFailed(false)
    try {
      await downloadMyData()
    } catch {
      setDownloadFailed(true)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <main className={pageClass}>
      <h1 className="m-0 text-xl font-bold">{t('account.heading')}</h1>
      <Panel title={t('account.signedInAs')} titleId="account-who" className="max-w-xl">
        <div className="flex items-center gap-3 px-3.5 py-3">
          <Avatar name={name} url={avatarUrl} seed={user.id} size={40} />
          <div className="flex flex-col">
            <span className="font-semibold">{name}</span>
            {user.email && <span className="text-[13px] text-muted">{user.email}</span>}
            <span className="text-[13px] text-muted">{t('account.fromGoogle')}</span>
          </div>
        </div>
      </Panel>

      <ImageLibrary
        scope={{ scope: 'personal' }}
        title={t('images.personalHeading')}
        titleId="account-images"
        help={t('images.personalHelp')}
        canEdit
      />

      <Panel title={t('account.dataHeading')} titleId="account-data" className="max-w-xl">
        <div className="flex flex-col items-start gap-2 px-3.5 py-3">
          <p className="m-0 text-[14px]">{t('account.dataHelp')}</p>
          <Button onClick={() => void download()} disabled={downloading}>
            {t('account.download')}
          </Button>
          {downloadFailed && <ErrorMessage>{t('common.error')}</ErrorMessage>}
        </div>
      </Panel>

      <Panel title={t('account.deleteHeading')} titleId="account-delete" className="max-w-xl">
        <div className="flex flex-col items-start gap-2 px-3.5 py-3">
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[14px]">
            <li>{t('account.deleteGone')}</li>
            <li>{t('account.deleteStays')}</li>
            <li>{t('account.deleteAlone')}</li>
          </ul>
          <label className="flex items-center gap-2 text-[14px]">
            <input type="checkbox" className="size-4 accent-brand-600" checked={sure} onChange={e => setSure(e.target.checked)} />
            {t('account.deleteSure')}
          </label>
          <Button
            variant="danger"
            disabled={!sure || remove.isPending}
            onClick={() => remove.mutate(undefined, { onSuccess: () => navigate('/') })}
          >
            {t('account.delete')}
          </Button>
          {remove.error instanceof OnlyAdmin ? (
            <ErrorMessage>{t('account.onlyAdmin', { clubs: remove.error.clubs.join(', ') })}</ErrorMessage>
          ) : (
            remove.isError && <ErrorMessage>{t('common.error')}</ErrorMessage>
          )}
        </div>
      </Panel>
    </main>
  )
}

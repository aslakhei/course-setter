// The club's saved print layout templates on the Settings tab (admins): who made each and when it last
// changed, and deleting them. Templates are saved from the Layout mode of any event.
import { useTranslation } from 'react-i18next'
import { formatDate } from '../lib/format.ts'
import { useDeleteTemplate, useTemplates } from '../lib/templates.ts'
import { Button, ErrorMessage, Loading, Panel } from './ui.tsx'

export function ClubTemplatesPanel({ clubId }: { clubId: string }) {
  const { t } = useTranslation()
  const templates = useTemplates(clubId)
  const remove = useDeleteTemplate(clubId)
  const club = (templates.data ?? []).filter(tpl => tpl.scope === 'club')

  return (
    <Panel title={t('templates.clubHeading')} titleId="club-templates" className="max-w-xl">
      <div className="flex flex-col gap-2 px-3.5 py-3">
        <span className="text-[13px] text-muted">{t('templates.clubHelp')}</span>
        {templates.isError ? (
          <ErrorMessage>{t('common.error')}</ErrorMessage>
        ) : templates.data === undefined ? (
          <Loading label={t('common.loading')} />
        ) : club.length === 0 ? (
          <span className="text-[13px] text-muted">{t('templates.noClubTemplates')}</span>
        ) : (
          <ul aria-label={t('templates.clubHeading')} className="m-0 flex list-none flex-col p-0">
            {club.map((tpl, i) => (
              <li key={tpl.id} className={`flex items-center gap-3 py-2 ${i ? 'border-t border-line-soft' : ''}`}>
                <span className="flex min-w-0 grow flex-col">
                  <span className="truncate text-[14px] font-semibold">{tpl.name}</span>
                  <span className="text-xs text-muted">{[tpl.madeBy, formatDate(tpl.updatedAt)].filter(Boolean).join(' · ')}</span>
                </span>
                <Button
                  size="sm"
                  variant="danger"
                  aria-label={t('templates.deleteLabel', { name: tpl.name })}
                  onClick={() => window.confirm(t('templates.deleteConfirm', { name: tpl.name })) && remove.mutate(tpl.id)}
                >
                  {t('images.delete')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {remove.isError && <ErrorMessage>{t('common.error')}</ErrorMessage>}
      </div>
    </Panel>
  )
}

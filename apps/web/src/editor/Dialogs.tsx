import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useSession } from '../auth/useSession.ts'
import { Avatar, Button, ErrorMessage, fieldClass } from '../components/ui.tsx'
import type { Member } from '../lib/api.ts'
import { type EventDetail, type SaveConflict, useEventMembers, useInviteToEvent, useRemoveFromEvent } from '../lib/events.ts'

function Modal({ titleId, children, onClose }: { titleId: string; children: ReactNode; onClose?: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('button, select, input')?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose?.()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(29,27,32,0.35)] px-4">
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex w-full max-w-md flex-col gap-3 rounded-md border border-line bg-white p-5 shadow-lg"
      >
        {children}
      </div>
    </div>
  )
}

const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

export function ConflictDialog({
  conflict,
  eventName,
  busy,
  onKeepMine,
  onUseTheirs,
}: {
  conflict: SaveConflict
  eventName: string
  busy: boolean
  onKeepMine: () => void
  onUseTheirs: () => void
}) {
  const { t } = useTranslation()
  return (
    <Modal titleId="conflict-heading">
      <h2 id="conflict-heading" className="m-0 text-base font-semibold">
        {t('editor.conflict.heading')}
      </h2>
      <p className="m-0">
        {t('editor.conflict.body', {
          name: conflict.savedBy || t('editor.conflict.someone'),
          time: timeFormat.format(new Date(conflict.savedAt)),
        })}
      </p>
      <div className="flex flex-col gap-1">
        <Button variant="primary" size="lg" disabled={busy} onClick={onKeepMine}>
          {t('editor.conflict.keepMine')}
        </Button>
        <span className="text-xs text-muted">{t('editor.conflict.keepMineHelp')}</span>
      </div>
      <div className="flex flex-col gap-1">
        <Button size="lg" disabled={busy} onClick={onUseTheirs}>
          {t('editor.conflict.useTheirs')}
        </Button>
        <span className="text-xs text-muted">
          {t('editor.conflict.useTheirsHelp', { copy: t('editor.conflict.copyName', { name: eventName }) })}
        </span>
      </div>
    </Modal>
  )
}

/** Who has access: the creator, the club's admins and invited members. People with access invite others from the club. */
export function AccessDialog({ event, clubMembers, onClose }: { event: EventDetail; clubMembers: Member[]; onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const session = useSession()
  const me = session?.user.id
  const invited = useEventMembers(event.id)
  const invite = useInviteToEvent(event.id)
  const remove = useRemoveFromEvent(event.id)
  const [choice, setChoice] = useState('')

  const isAdmin = clubMembers.some(m => m.userId === me && m.role === 'admin')
  const canManage = isAdmin || event.createdBy === me
  const invitedIds = new Set(invited.data?.map(m => m.userId))
  const withAccess = clubMembers.filter(m => m.userId === event.createdBy || m.role === 'admin' || invitedIds.has(m.userId))
  const others = clubMembers.filter(m => !withAccess.includes(m))
  const role = (m: Member) =>
    m.userId === event.createdBy ? t('editor.access.creator') : m.role === 'admin' ? t('editor.access.admin') : t('editor.access.invited')

  return (
    <Modal titleId="access-heading" onClose={onClose}>
      <h2 id="access-heading" className="m-0 text-base font-semibold">
        {t('editor.access.heading', { event: event.name })}
      </h2>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {withAccess.map(m => (
          <li key={m.userId} className="flex items-center gap-2">
            <Avatar name={m.name} url={m.avatarUrl} seed={m.userId} size={26} />
            <span className="grow">
              {m.name} {m.userId === me && <span className="text-muted">{t('common.you')}</span>}
            </span>
            <span className="text-xs text-muted">{role(m)}</span>
            {invitedIds.has(m.userId) && m.userId !== event.createdBy && m.role !== 'admin' && (canManage || m.userId === me) && (
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  if (m.userId === me) {
                    if (!window.confirm(t('editor.access.leaveConfirm', { event: event.name }))) return
                    remove.mutate(m.userId, { onSuccess: () => navigate(`/clubs/${event.clubId}/events`) })
                  } else remove.mutate(m.userId)
                }}
              >
                {m.userId === me ? t('editor.access.leave') : t('editor.access.remove')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {others.length === 0 ? (
        <p className="m-0 text-[13px] text-muted">{t('editor.access.everyone')}</p>
      ) : (
        <form
          className="flex flex-col gap-1.5"
          onSubmit={e => {
            e.preventDefault()
            if (choice) invite.mutate(choice, { onSuccess: () => setChoice('') })
          }}
        >
          <label htmlFor="invite-member" className="text-[13px] font-semibold">
            {t('editor.access.inviteLabel')}
          </label>
          <span className="flex gap-1.5">
            <select id="invite-member" className={`${fieldClass} grow`} value={choice} onChange={e => setChoice(e.target.value)}>
              <option value="">{t('editor.access.invitePlaceholder')}</option>
              {others.map(m => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
            <Button type="submit" variant="primary" disabled={!choice || invite.isPending}>
              {t('editor.access.invite')}
            </Button>
          </span>
        </form>
      )}
      {(invite.isError || remove.isError) && <ErrorMessage>{t('common.error')}</ErrorMessage>}
      <Button className="self-end" onClick={onClose}>
        {t('editor.access.close')}
      </Button>
    </Modal>
  )
}

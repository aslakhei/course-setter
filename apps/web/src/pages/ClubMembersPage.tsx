import type { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { CopyButton } from '../components/CopyButton.tsx'
import { Avatar, Button, ErrorMessage, fieldClass, Loading, Panel, visuallyHidden } from '../components/ui.tsx'
import {
  ApiError,
  type ClubRole,
  type Invite,
  inviteUrl,
  isActive,
  type Member,
  useCreateInvite,
  useInvites,
  useRemoveMember,
  useRevokeInvite,
  useSetRole,
} from '../lib/api.ts'
import { formatDate } from '../lib/format.ts'
import { useClubContext } from './ClubLayout.tsx'

export function ClubMembersPage() {
  const { isAdmin } = useClubContext()
  return (
    <main className="mx-auto flex max-w-[1200px] flex-wrap items-start gap-3.5 px-5 pt-4 pb-8">
      <MembersPanel />
      {isAdmin && <InviteLinksPanel />}
    </main>
  )
}

function errorText(error: unknown, t: TFunction): string {
  return error instanceof ApiError && error.code === 'lastAdmin' ? t('members.lastAdmin') : t('common.error')
}

function MembersPanel() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { club, members, me, isAdmin } = useClubContext()
  const setRole = useSetRole(club.id)
  const removeMember = useRemoveMember(club.id)
  const [filter, setFilter] = useState('')

  const displayName = (m: Member) => m.name || t('members.unnamed')
  const shown = members.filter(m => displayName(m).toLowerCase().includes(filter.trim().toLowerCase()))
  const error = setRole.error ?? removeMember.error

  const remove = (member: Member) => {
    const self = member.userId === me.userId
    const question = self
      ? t('members.leaveConfirm', { club: club.name })
      : t('members.removeConfirm', { name: displayName(member), club: club.name })
    if (!window.confirm(question)) return
    removeMember.mutate(member.userId, { onSuccess: () => self && navigate('/') })
  }

  return (
    <Panel
      title={
        <>
          {t('members.heading')} <span className="font-normal text-muted">{members.length}</span>
        </>
      }
      titleId="members-heading"
      className="min-w-0 flex-[999_1_560px]"
      actions={
        <>
          <label htmlFor="member-filter" className={visuallyHidden}>
            {t('members.filterLabel')}
          </label>
          <input
            id="member-filter"
            type="search"
            placeholder={t('members.filterPlaceholder')}
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className={`${fieldClass} w-52`}
          />
        </>
      }
    >
      {error && (
        <div className="border-b border-line px-3.5 py-2">
          <ErrorMessage>{errorText(error, t)}</ErrorMessage>
        </div>
      )}
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-[13px]">
          <thead>
            <tr className="bg-subtle text-left text-muted">
              <th scope="col" className="px-3.5 py-1.5 font-semibold">
                {t('members.name')}
              </th>
              <th scope="col" className="px-3.5 py-1.5 font-semibold">
                {t('members.role')}
              </th>
              <th scope="col" className="px-3.5 py-1.5 font-semibold">
                {t('members.joined')}
              </th>
              <th scope="col" className="px-3.5 py-1.5">
                <span className={visuallyHidden}>{t('members.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map(member => {
              const self = member.userId === me.userId
              return (
                <tr key={member.userId} className="border-t border-line-soft">
                  <td className="px-3.5 py-1.5">
                    <span className="flex items-center gap-2">
                      <Avatar name={displayName(member)} url={member.avatarUrl} seed={member.userId} />
                      {displayName(member)}
                      {self && <span className="text-muted">{t('common.you')}</span>}
                    </span>
                  </td>
                  <td className="px-3.5 py-1.5">
                    {isAdmin && !self ? (
                      <>
                        <label htmlFor={`role-${member.userId}`} className={visuallyHidden}>
                          {t('members.roleFor', { name: displayName(member) })}
                        </label>
                        <select
                          id={`role-${member.userId}`}
                          className={`${fieldClass} h-7 px-1`}
                          value={member.role}
                          disabled={setRole.isPending}
                          onChange={e => setRole.mutate({ userId: member.userId, role: e.target.value as ClubRole })}
                        >
                          <option value="admin">{t('roles.admin')}</option>
                          <option value="member">{t('roles.member')}</option>
                        </select>
                      </>
                    ) : (
                      <span className={member.role === 'admin' ? 'font-semibold' : ''}>{t(`roles.${member.role}`)}</span>
                    )}
                  </td>
                  <td className="px-3.5 py-1.5 text-muted">{formatDate(member.joinedAt)}</td>
                  <td className="px-3.5 py-1.5 text-right">
                    {self ? (
                      <Button size="sm" onClick={() => remove(member)} disabled={removeMember.isPending}>
                        {t('members.leave')}
                      </Button>
                    ) : (
                      isAdmin && (
                        <Button size="sm" variant="danger" onClick={() => remove(member)} disabled={removeMember.isPending}>
                          {t('members.remove')}
                        </Button>
                      )
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {shown.length === 0 && <p className="m-0 px-3.5 py-4 text-muted">{t('members.noMatch')}</p>}
      </div>
    </Panel>
  )
}

const validityOptions = [7, 14, 30] as const

function InviteLinksPanel() {
  const { t } = useTranslation()
  const { club } = useClubContext()
  const invites = useInvites(club.id, true)
  const createInvite = useCreateInvite(club.id)
  const revokeInvite = useRevokeInvite(club.id)
  const [days, setDays] = useState<number>(14)

  return (
    <Panel title={t('invites.heading')} titleId="invites-heading" className="flex-[1_1_320px]">
      <div className="flex flex-col gap-2.5 border-b border-line px-3.5 py-3">
        <span className="text-body">{t('invites.help')}</span>
        <span className="flex items-center gap-2">
          <label htmlFor="invite-days" className="text-[13px] text-body">
            {t('invites.validFor')}
          </label>
          <select id="invite-days" className={fieldClass} value={days} onChange={e => setDays(Number(e.target.value))}>
            {validityOptions.map(d => (
              <option key={d} value={d}>
                {t('invites.days', { count: d })}
              </option>
            ))}
          </select>
          <span className="grow" />
          <Button variant="primary" disabled={createInvite.isPending} onClick={() => createInvite.mutate(days)}>
            {t('invites.create')}
          </Button>
        </span>
        {(createInvite.isError || revokeInvite.isError) && <ErrorMessage>{t('common.error')}</ErrorMessage>}
      </div>
      {invites.isError ? (
        <div className="px-3.5 py-3">
          <ErrorMessage>{t('common.error')}</ErrorMessage>
        </div>
      ) : invites.data === undefined ? (
        <Loading label={t('common.loading')} />
      ) : invites.data.length === 0 ? (
        <p className="m-0 px-3.5 py-3 text-muted">{t('invites.none')}</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {invites.data.map((invite, i) => (
            <InviteRow
              key={invite.id}
              invite={invite}
              first={i === 0}
              onRevoke={() => revokeInvite.mutate(invite.id)}
              revoking={revokeInvite.isPending}
            />
          ))}
        </ul>
      )}
    </Panel>
  )
}

function InviteRow({ invite, first, onRevoke, revoking }: { invite: Invite; first: boolean; onRevoke: () => void; revoking: boolean }) {
  const { t } = useTranslation()
  const active = isActive(invite)
  const url = inviteUrl(invite.token)
  const status = invite.revokedAt
    ? t('invites.revoked', { date: formatDate(invite.revokedAt) })
    : active
      ? t('invites.expires', { date: formatDate(invite.expiresAt) })
      : t('invites.expired', { date: formatDate(invite.expiresAt) })

  return (
    <li className={`flex flex-col gap-1.5 px-3.5 py-2.5 ${first ? '' : 'border-t border-line-soft'} ${active ? '' : 'text-muted'}`}>
      <span className="flex items-center gap-2">
        <code data-testid="invite-link" className="min-w-0 grow truncate font-mono text-xs" title={active ? url : undefined}>
          {active ? url : `…/invite/${invite.token.slice(0, 12)}`}
        </code>
        {active && (
          <>
            <CopyButton text={url} label={t('invites.linkLabel')} />
            <Button size="sm" variant="danger" disabled={revoking} onClick={onRevoke}>
              {t('invites.revoke')}
            </Button>
          </>
        )}
      </span>
      <span className="text-xs text-muted">{status}</span>
    </li>
  )
}

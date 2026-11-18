import type { PostgrestError } from '@supabase/supabase-js'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../lib/api.ts'
import { ada, clubContext, mo, mutation, query, renderClubPage } from '../test/helpers.tsx'
import { ClubMembersPage } from './ClubMembersPage.tsx'

vi.mock('../lib/supabase.ts', () => ({ supabase: {} }))
vi.mock('../lib/api.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api.ts')>()),
  useInvites: vi.fn(),
  useCreateInvite: vi.fn(),
  useRevokeInvite: vi.fn(),
  useSetRole: vi.fn(),
  useRemoveMember: vi.fn(),
}))

const future = new Date(Date.now() + 7 * 86_400_000).toISOString()
const activeInvite: api.Invite = {
  id: 'i1',
  token: 'Q7f2kLm9xR4tWp8vZ3nB6cHd',
  createdAt: '2026-11-18T10:00:00Z',
  expiresAt: future,
  revokedAt: null,
}
const revokedInvite: api.Invite = {
  id: 'i0',
  token: 'Mx81pQ4zTa7eLs2Yq9WcAbCd',
  createdAt: '2026-11-01T10:00:00Z',
  expiresAt: future,
  revokedAt: '2026-11-10T10:00:00Z',
}

let setRole: ReturnType<typeof mutation>
let removeMember: ReturnType<typeof mutation>
let createInvite: ReturnType<typeof mutation>

beforeEach(() => {
  setRole = mutation()
  removeMember = mutation()
  createInvite = mutation()
  vi.mocked(api.useSetRole).mockReturnValue(setRole as ReturnType<typeof api.useSetRole>)
  vi.mocked(api.useRemoveMember).mockReturnValue(removeMember as ReturnType<typeof api.useRemoveMember>)
  vi.mocked(api.useCreateInvite).mockReturnValue(createInvite as ReturnType<typeof api.useCreateInvite>)
  vi.mocked(api.useRevokeInvite).mockReturnValue(mutation() as ReturnType<typeof api.useRevokeInvite>)
  vi.mocked(api.useInvites).mockReturnValue(query([activeInvite, revokedInvite]))
})

describe('members page as admin', () => {
  it('lets an admin change roles and remove others, but only leave themselves', async () => {
    renderClubPage(<ClubMembersPage />, clubContext(ada))
    const rows = screen.getAllByRole('row').slice(1)
    const [adaRow, moRow] = rows.map(r => within(r))

    expect(adaRow?.queryByRole('combobox')).toBeNull()
    expect(adaRow?.getByRole('button', { name: 'Leave club' })).toBeInTheDocument()
    expect(moRow?.getByRole('button', { name: 'Remove' })).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Role for Mo Lund'), 'admin')
    expect(setRole.mutate).toHaveBeenCalledWith({ userId: 'u-mo', role: 'admin' })
  })

  it('asks before removing a member', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    renderClubPage(<ClubMembersPage />, clubContext(ada))
    const remove = screen.getByRole('button', { name: 'Remove' })

    await userEvent.click(remove)
    expect(removeMember.mutate).not.toHaveBeenCalled()
    await userEvent.click(remove)
    expect(confirm).toHaveBeenLastCalledWith('Remove Mo Lund from Skogly OK?')
    expect(removeMember.mutate).toHaveBeenCalledWith('u-mo', expect.anything())
  })

  it('explains why the last admin cannot step down', () => {
    const error = new api.ApiError({ message: 'x', hint: 'last_admin', details: '', code: 'P0001' } as PostgrestError)
    vi.mocked(api.useRemoveMember).mockReturnValue(mutation({ error }) as ReturnType<typeof api.useRemoveMember>)
    renderClubPage(<ClubMembersPage />, clubContext(ada))
    expect(screen.getByRole('alert')).toHaveTextContent('A club must have at least one admin.')
  })

  it('shows active links with copy and revoke, and revoked links greyed out', async () => {
    renderClubPage(<ClubMembersPage />, clubContext(ada))
    const links = screen.getAllByTestId('invite-link')
    expect(links[0]).toHaveTextContent(`/invite/${activeInvite.token}`)
    expect(links[1]).toHaveTextContent('…/invite/Mx81pQ4zTa7e')
    expect(screen.getAllByRole('button', { name: 'Revoke' })).toHaveLength(1)
    expect(screen.getByText('Revoked 10 Nov 2026')).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Valid for'), '30')
    await userEvent.click(screen.getByRole('button', { name: 'Create link' }))
    expect(createInvite.mutate).toHaveBeenCalledWith(30)
  })

  it('filters members by name', async () => {
    renderClubPage(<ClubMembersPage />, clubContext(ada))
    await userEvent.type(screen.getByLabelText('Filter members'), 'mo')
    expect(screen.queryByText('Ada Hansen')).toBeNull()
    expect(screen.getByText('Mo Lund')).toBeInTheDocument()
  })
})

describe('members page as member', () => {
  it('shows the list without admin controls or invite links', () => {
    renderClubPage(<ClubMembersPage />, clubContext(mo))
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Leave club' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Invite links' })).toBeNull()
  })
})

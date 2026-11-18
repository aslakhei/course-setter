import type { Session } from '@supabase/supabase-js'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as auth from '../auth/useSession.ts'
import * as api from '../lib/api.ts'
import { mutation, query } from '../test/helpers.tsx'
import { InvitePage } from './InvitePage.tsx'

vi.mock('../lib/supabase.ts', () => ({ supabase: {} }))
vi.mock('../auth/useSession.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../auth/useSession.ts')>()),
  useSession: vi.fn(),
}))
vi.mock('../lib/api.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api.ts')>()),
  useInviteInfo: vi.fn(),
  useAcceptInvite: vi.fn(),
}))

const session = { user: { id: 'u-1' } } as Session
const info = (extra: Partial<api.InviteInfo>): api.InviteInfo => ({
  clubId: 'club-1',
  clubName: 'Skogly OK',
  status: 'valid',
  alreadyMember: false,
  ...extra,
})

let accept: ReturnType<typeof mutation>

beforeEach(() => {
  vi.mocked(auth.useSession).mockReturnValue(session)
  accept = mutation()
  vi.mocked(api.useAcceptInvite).mockReturnValue(accept as ReturnType<typeof api.useAcceptInvite>)
})

function renderInvite() {
  render(
    <MemoryRouter initialEntries={['/invite/tok123']}>
      <Routes>
        <Route path="/invite/:token" element={<InvitePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('invite page', () => {
  it('asks visitors who are not signed in to sign in first', () => {
    vi.mocked(auth.useSession).mockReturnValue(null)
    vi.mocked(api.useInviteInfo).mockReturnValue(query<api.InviteInfo | null>(undefined))
    renderInvite()
    expect(screen.getByText(/You have been invited to join a club/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument()
  })

  it('joins the club of a valid link', async () => {
    vi.mocked(api.useInviteInfo).mockReturnValue(query(info({})))
    renderInvite()
    expect(screen.getByText('You have been invited to join Skogly OK.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Join Skogly OK' }))
    expect(accept.mutate).toHaveBeenCalledWith('tok123', expect.anything())
  })

  it.each([
    [{ status: 'expired' as const }, 'This invite link to Skogly OK has expired.'],
    [{ status: 'revoked' as const }, 'This invite link to Skogly OK is no longer valid.'],
    [{ alreadyMember: true }, 'You are already a member of Skogly OK.'],
  ])('explains %o without a join button', (extra, text) => {
    vi.mocked(api.useInviteInfo).mockReturnValue(query(info(extra)))
    renderInvite()
    expect(screen.getByText(text, { exact: false })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Join/ })).toBeNull()
  })

  it('explains an unknown link', () => {
    vi.mocked(api.useInviteInfo).mockReturnValue(query<api.InviteInfo | null>(null))
    renderInvite()
    expect(screen.getByText(/This invite link is not valid/)).toBeInTheDocument()
  })
})

import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { vi } from 'vitest'
import type { Member } from '../lib/api.ts'
import type { ClubContext } from '../pages/ClubLayout.tsx'

export const ada: Member = { userId: 'u-ada', role: 'admin', joinedAt: '2026-11-18T10:00:00Z', name: 'Ada Hansen', avatarUrl: null }
export const mo: Member = { userId: 'u-mo', role: 'member', joinedAt: '2026-11-19T10:00:00Z', name: 'Mo Lund', avatarUrl: null }

export function clubContext(me: Member, members: Member[] = [ada, mo]): ClubContext {
  return {
    club: { id: 'club-1', name: 'Skogly OK', logoAssetId: null, colour: null, colour2: null, colour3: null },
    members,
    me,
    isAdmin: me.role === 'admin',
  }
}

/** Render a club page as the club layout would: inside a route that provides the club context. */
export function renderClubPage(page: ReactElement, context: ClubContext) {
  return render(
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={context} />}>
          <Route path="/" element={page} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

/** A stand-in for a TanStack Query result with only the fields the components read. */
export function query<T>(data: T | undefined, extra: Partial<UseQueryResult<T>> = {}): UseQueryResult<T> {
  return { data, isError: false, isPending: data === undefined, ...extra } as UseQueryResult<T>
}

export function mutation<TData = unknown, TVars = unknown>(
  extra: Partial<UseMutationResult<TData, Error, TVars>> = {},
): UseMutationResult<TData, Error, TVars> {
  return { mutate: vi.fn(), isPending: false, isError: false, isSuccess: false, error: null, ...extra } as unknown as UseMutationResult<
    TData,
    Error,
    TVars
  >
}

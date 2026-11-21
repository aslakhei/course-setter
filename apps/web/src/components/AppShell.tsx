import { useTranslation } from 'react-i18next'
import { Link, Outlet, useLocation, useParams } from 'react-router'
import { signInWithGoogle, signOut, useSession } from '../auth/useSession.ts'
import { useMyClubs } from '../lib/api.ts'
import { NOTICES_URL } from '../lib/links.ts'
import { SignedOutPage } from '../pages/SignedOutPage.tsx'
import { BrandMark } from './BrandMark.tsx'
import { Menu, menuItemClass } from './Menu.tsx'
import { Avatar, Button, Loading } from './ui.tsx'

function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

/** Signed-in pages: top bar with club switcher and account menu above the page. */
export function AppShell() {
  const { t } = useTranslation()
  const session = useSession()
  const { pathname } = useLocation()

  if (session === undefined) return <Loading label={t('common.loading')} />
  // The help pages can be read before signing in.
  if (session === null) return pathname === '/help' || pathname.startsWith('/help/') ? <PublicShell /> : <SignedOutPage />

  const user = session.user
  const name = (user.user_metadata.full_name as string | undefined) ?? (user.user_metadata.name as string | undefined) ?? user.email ?? ''
  const avatarUrl = (user.user_metadata.avatar_url as string | undefined) ?? null

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex h-12 max-w-[1200px] items-center gap-3 px-5">
          <Link to="/" className="flex items-center gap-2 text-[15px] font-bold text-ink no-underline hover:text-ink">
            <span className="text-brand-600">
              <BrandMark />
            </span>
            {t('app.title')}
          </Link>
          <span aria-hidden="true" className="text-[#c9c4cb]">
            /
          </span>
          <ClubSwitcher userId={user.id} />
          <span className="grow" />
          <Menu
            label={t('auth.accountMenu', { name })}
            align="end"
            buttonClassName="rounded-full"
            button={<Avatar name={name} url={avatarUrl} seed={user.id} size={32} />}
          >
            {close => (
              <>
                <div className="border-b border-line px-3 pt-1 pb-2">
                  <div className="font-semibold">{name}</div>
                  {user.email && <div className="text-[13px] text-muted">{user.email}</div>}
                </div>
                <Link to="/account" onClick={close} className={menuItemClass}>
                  {t('account.heading')}
                </Link>
                <Link to="/help" onClick={close} className={menuItemClass}>
                  {t('nav.help')}
                </Link>
                <a href={NOTICES_URL} target="_blank" rel="noreferrer" className={menuItemClass}>
                  {t('nav.licences')}
                </a>
                <button type="button" className={menuItemClass} onClick={() => void signOut()}>
                  {t('auth.signOut')}
                </button>
              </>
            )}
          </Menu>
        </div>
      </header>
      <Outlet />
    </div>
  )
}

/** Pages anyone can read (help): the brand and a sign-in button above the page. */
function PublicShell() {
  const { t } = useTranslation()
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex h-12 max-w-[1200px] items-center gap-3 px-5">
          <Link to="/" className="flex items-center gap-2 text-[15px] font-bold text-ink no-underline hover:text-ink">
            <span className="text-brand-600">
              <BrandMark />
            </span>
            {t('app.title')}
          </Link>
          <span className="grow" />
          <Button size="sm" variant="primary" onClick={() => void signInWithGoogle()}>
            {t('help.signIn')}
          </Button>
        </div>
      </header>
      <Outlet />
    </div>
  )
}

function ClubSwitcher({ userId }: { userId: string }) {
  const { t } = useTranslation()
  const { clubId } = useParams()
  const clubs = useMyClubs(userId)
  const current = clubs.data?.find(c => c.id === clubId)

  return (
    <Menu
      label={t('nav.switchClub')}
      buttonClassName="flex h-8 items-center gap-1.5 rounded bg-[#f3f0f4] px-2 font-semibold text-ink hover:bg-brand-50"
      button={
        <>
          {current?.name ?? t('nav.clubs')}
          <Chevron />
        </>
      }
    >
      {close => (
        <ul className="m-0 list-none p-0">
          {clubs.data?.map(club => (
            <li key={club.id}>
              <Link
                to={`/clubs/${club.id}`}
                onClick={close}
                aria-current={club.id === clubId ? 'page' : undefined}
                className={`${menuItemClass} ${club.id === clubId ? 'font-semibold' : ''}`}
              >
                <span className="grow">{club.name}</span>
                <span className="text-xs text-muted">{t(`roles.${club.role}`)}</span>
              </Link>
            </li>
          ))}
          <li className="mt-1 border-t border-line pt-1">
            <Link to="/" onClick={close} className={menuItemClass}>
              {t('nav.allClubs')}
            </Link>
          </li>
        </ul>
      )}
    </Menu>
  )
}

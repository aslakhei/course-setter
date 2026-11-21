import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Route, Routes } from 'react-router'
import { AppShell } from './components/AppShell.tsx'
import { Loading } from './components/ui.tsx'
import { ClubEventsPage } from './pages/ClubEventsPage.tsx'
import { ClubLayout } from './pages/ClubLayout.tsx'
import { ClubMapsPage } from './pages/ClubMapsPage.tsx'
import { ClubMembersPage } from './pages/ClubMembersPage.tsx'
import { ClubOverviewPage } from './pages/ClubOverviewPage.tsx'
import { ClubSettingsPage } from './pages/ClubSimplePages.tsx'
import { ClubsPage } from './pages/ClubsPage.tsx'
import { LiveloxHelpPage } from './pages/HelpPage.tsx'
import { InvitePage } from './pages/InvitePage.tsx'

// The map page brings OpenLayers; load it only when a map is opened.
const MapPage = lazy(() => import('./pages/MapPage.tsx').then(m => ({ default: m.MapPage })))
const EditorPage = lazy(() => import('./pages/EditorPage.tsx').then(m => ({ default: m.EditorPage })))
const AlignPage = lazy(() => import('./pages/AlignPage.tsx').then(m => ({ default: m.AlignPage })))

export function App() {
  const { t } = useTranslation()
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<ClubsPage />} />
        {/* The editor takes the whole window below the top bar, without the club header. */}
        <Route
          path="clubs/:clubId/events/:eventId"
          element={
            <Suspense fallback={<Loading label={t('common.loading')} />}>
              <EditorPage />
            </Suspense>
          }
        />
        <Route path="clubs/:clubId" element={<ClubLayout />}>
          <Route index element={<ClubOverviewPage />} />
          <Route path="maps" element={<ClubMapsPage />} />
          <Route
            path="maps/:mapId"
            element={
              <Suspense fallback={<Loading label={t('common.loading')} />}>
                <MapPage />
              </Suspense>
            }
          />
          <Route
            path="maps/:mapId/align/:versionId"
            element={
              <Suspense fallback={<Loading label={t('common.loading')} />}>
                <AlignPage />
              </Suspense>
            }
          />
          <Route path="events" element={<ClubEventsPage />} />
          <Route path="members" element={<ClubMembersPage />} />
          <Route path="settings" element={<ClubSettingsPage />} />
        </Route>
        <Route path="help/livelox" element={<LiveloxHelpPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="invite/:token" element={<InvitePage />} />
    </Routes>
  )
}

function NotFound() {
  const { t } = useTranslation()
  return (
    <main className="mx-auto flex max-w-[1200px] flex-col items-start gap-2 px-5 py-6">
      <h1 className="m-0 text-xl font-bold">{t('notFound.heading')}</h1>
      <Link to="/">{t('notFound.home')}</Link>
    </main>
  )
}

import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { MapViewer } from '../components/MapViewer.tsx'
import { Button, ErrorMessage, fieldClass, Loading } from '../components/ui.tsx'
import { formatDate } from '../lib/format.ts'
import { latestReady, useDeleteMapVersion, useMaps, useMapVersion, useTilesUrl } from '../lib/maps.ts'
import { useClubContext } from './ClubLayout.tsx'
import { VersionStatus, versionLabel } from './ClubMapsPage.tsx'

/** /clubs/:clubId/maps/:mapId?version=<id>: one map in the viewer. */
export function MapPage() {
  const { t } = useTranslation()
  const { mapId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { club, isAdmin } = useClubContext()
  const maps = useMaps(club.id)
  const map = maps.data?.find(m => m.id === mapId)
  const chosen = map?.versions.find(v => v.id === params.get('version')) ?? (map ? latestReady(map) : undefined)
  const version = useMapVersion(chosen?.status === 'ready' ? chosen.id : undefined)
  const tilesUrl = useTilesUrl(version.data?.tilesPath)
  const deleteVersion = useDeleteMapVersion(club.id)

  if (maps.isError) return <PageMessage>{t('common.error')}</PageMessage>
  if (maps.data === undefined) return <Loading label={t('common.loading')} />
  if (!map) {
    return (
      <PageMessage>
        {t('maps.notFound')} <Link to="..">{t('maps.backToMaps')}</Link>
      </PageMessage>
    )
  }

  const remove = () => {
    if (!chosen || !window.confirm(t('maps.deleteConfirm', { number: chosen.version, map: map.name }))) return
    deleteVersion.mutate(chosen.id, { onSuccess: () => navigate(`/clubs/${club.id}/maps`) })
  }

  const grid = version.data?.tiles
  return (
    <main className="mx-auto flex max-w-[1600px] flex-col gap-2.5 px-5 pt-3 pb-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link to=".." relative="path" className="text-[13px]">
          {t('maps.backToMaps')}
        </Link>
        <h2 className="m-0 text-base font-semibold">{map.name}</h2>
        <label htmlFor="map-version" className="sr-only">
          {t('maps.versionLabel')}
        </label>
        <select
          id="map-version"
          className={fieldClass}
          value={chosen?.id ?? ''}
          onChange={e => setParams({ version: e.target.value }, { replace: true })}
        >
          {map.versions.map(v => (
            <option key={v.id} value={v.id}>
              {versionLabel(v, t)} · {formatDate(v.createdAt)}
              {v.status === 'ready' ? '' : ` (${t(`maps.status.${v.status}`)})`}
            </option>
          ))}
        </select>
        <span className="grow" />
        {isAdmin && chosen && (
          <Button size="sm" variant="danger" onClick={remove} disabled={deleteVersion.isPending}>
            {t('maps.deleteVersion')}
          </Button>
        )}
      </div>
      {deleteVersion.isError && <ErrorMessage>{t('common.error')}</ErrorMessage>}
      {chosen && chosen.status !== 'ready' ? (
        <div className="rounded-md border border-line bg-white px-3.5 py-3">
          <VersionStatus version={chosen} />
        </div>
      ) : version.isError || tilesUrl.isError ? (
        <ErrorMessage>{t('common.error')}</ErrorMessage>
      ) : grid && tilesUrl.data && chosen ? (
        <div className="h-[calc(100vh-13rem)]">
          <MapViewer versionId={chosen.id} grid={grid} tilesUrl={tilesUrl.data} scale={version.data?.scale ?? 15000} />
        </div>
      ) : (
        <Loading label={t('common.loading')} />
      )}
    </main>
  )
}

function PageMessage({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-[1200px] px-5 py-6">{children}</main>
}

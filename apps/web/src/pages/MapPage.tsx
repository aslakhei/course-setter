import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { MapViewer } from '../components/MapViewer.tsx'
import { Button, ErrorMessage, fieldClass, Loading } from '../components/ui.tsx'
import { formatDate } from '../lib/format.ts'
import { type ClubMap, latestReady, type MapVersionSummary, useDeleteMapVersion, useMaps, useMapVersion, useTilesUrl } from '../lib/maps.ts'
import { useClubContext } from './ClubLayout.tsx'
import { UploadPanel, VersionStatus, versionLabel } from './ClubMapsPage.tsx'

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
  const [uploading, setUploading] = useState(false)

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
        {chosen && <Alignment version={chosen} map={map} isAdmin={isAdmin} />}
        <span className="grow" />
        {isAdmin && (
          <>
            <Button size="sm" onClick={() => setUploading(u => !u)} aria-expanded={uploading}>
              {t('maps.newVersion')}
            </Button>
            {chosen && (
              <Button size="sm" variant="danger" onClick={remove} disabled={deleteVersion.isPending}>
                {t('maps.deleteVersion')}
              </Button>
            )}
          </>
        )}
      </div>
      {deleteVersion.isError && <ErrorMessage>{t('common.error')}</ErrorMessage>}
      {isAdmin && uploading && (
        <div className="max-w-md">
          <UploadPanel mapId={map.id} onUploaded={() => setUploading(false)} />
        </div>
      )}
      {chosen && chosen.status !== 'ready' ? (
        <div className="rounded-md border border-line bg-white px-3.5 py-3">
          <VersionStatus version={chosen} mapId={map.id} linkPrefix="../" />
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

/** How a version was lined up with the one before it, and a way for admins to redo it. */
function Alignment({ version, map, isAdmin }: { version: MapVersionSummary; map: ClubMap; isAdmin: boolean }) {
  const { t } = useTranslation()
  const previous = map.versions.find(v => v.id === version.previousVersionId)
  if (version.status !== 'ready' || !previous || !version.transformMethod) return null
  return (
    <span className="text-[13px] text-muted">
      {t(`maps.alignedBy.${version.transformMethod}`, { number: previous.version, rms: (version.transformRms ?? 0).toFixed(1) })}
      {isAdmin && (
        <>
          {' '}
          <Link to={`align/${version.id}`}>{t('maps.lineUpAgain')}</Link>
        </>
      )}
    </span>
  )
}

function PageMessage({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-[1200px] px-5 py-6">{children}</main>
}

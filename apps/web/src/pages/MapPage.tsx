import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { MapViewer } from '../components/MapViewer.tsx'
import { Button, ErrorMessage, fieldClass, Loading } from '../components/ui.tsx'
import { formatDate } from '../lib/format.ts'
import {
  type ClubMap,
  latestReady,
  type MapDetails,
  type MapVersionDetail,
  type MapVersionSummary,
  useDeleteMapVersion,
  useMaps,
  useMapVersion,
  useSetMapDetails,
  useTilesUrl,
} from '../lib/maps.ts'
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
      {version.data && <Details version={version.data} isAdmin={isAdmin} />}
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

/** The version's details printed courses can show; admins edit them. */
function Details({ version, isAdmin }: { version: MapVersionDetail; isAdmin: boolean }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const shown = [
    version.contourInterval !== null ? t('maps.details.contourValue', { value: version.contourInterval }) : null,
    version.mapper ? t('maps.details.mapperValue', { value: version.mapper }) : null,
    version.year !== null ? t('maps.details.yearValue', { value: version.year }) : null,
  ].filter(Boolean)
  if (editing) return <DetailsForm key={version.id} version={version} onDone={() => setEditing(false)} />
  if (!shown.length && !isAdmin) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
      <span className={shown.length ? 'text-body' : 'text-muted'}>{shown.length ? shown.join(' · ') : t('maps.details.none')}</span>
      {isAdmin && (
        <Button size="sm" onClick={() => setEditing(true)}>
          {t('maps.details.edit')}
        </Button>
      )}
    </div>
  )
}

function DetailsForm({ version, onDone }: { version: MapVersionDetail; onDone: () => void }) {
  const { t } = useTranslation()
  const save = useSetMapDetails()
  const [contour, setContour] = useState(version.contourInterval?.toString() ?? '')
  const [mapper, setMapper] = useState(version.mapper ?? '')
  const [year, setYear] = useState(version.year?.toString() ?? '')
  const contourValue = contour.trim() === '' ? null : Number(contour.replace(',', '.'))
  const yearValue = year.trim() === '' ? null : Number(year)
  const contourOk = contourValue === null || (Number.isFinite(contourValue) && contourValue >= 0.5 && contourValue <= 50)
  const yearOk = yearValue === null || (Number.isInteger(yearValue) && yearValue >= 1900 && yearValue <= 2100)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!contourOk || !yearOk) return
    const details: MapDetails = { contourInterval: contourValue, mapper: mapper.trim() || null, year: yearValue }
    save.mutate({ versionId: version.id, details }, { onSuccess: onDone })
  }

  return (
    <form
      onSubmit={submit}
      aria-labelledby="map-details-heading"
      className="flex max-w-xl flex-col gap-2 rounded-md border border-line bg-white px-3.5 py-3"
    >
      <h3 id="map-details-heading" className="m-0 text-[13px] font-semibold">
        {t('maps.details.heading')}
      </h3>
      <span className="text-[13px] text-muted">{t('maps.details.help')}</span>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[13px]">
          {t('maps.details.contour')}
          <span className="flex items-center gap-1.5">
            <input className={`${fieldClass} w-16`} inputMode="decimal" value={contour} onChange={e => setContour(e.target.value)} />
            <span>m</span>
          </span>
        </label>
        <label className="flex grow flex-col gap-1 text-[13px]">
          {t('maps.details.mapper')}
          <input className={fieldClass} maxLength={200} value={mapper} onChange={e => setMapper(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[13px]" title={t('maps.details.yearHelp')}>
          {t('maps.details.year')}
          <input className={`${fieldClass} w-20`} inputMode="numeric" value={year} onChange={e => setYear(e.target.value)} />
        </label>
      </div>
      {!contourOk && <ErrorMessage>{t('maps.details.badContour')}</ErrorMessage>}
      {!yearOk && <ErrorMessage>{t('maps.details.badYear')}</ErrorMessage>}
      {save.isError && <ErrorMessage>{t('common.error')}</ErrorMessage>}
      <span className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={!contourOk || !yearOk || save.isPending}>
          {t('maps.details.save')}
        </Button>
        <Button size="sm" onClick={onDone}>
          {t('maps.details.cancel')}
        </Button>
      </span>
    </form>
  )
}

function PageMessage({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-[1200px] px-5 py-6">{children}</main>
}

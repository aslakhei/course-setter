import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { MapIcon } from '../components/icons.tsx'
import { Button, EmptyState, ErrorMessage, fieldClass, Loading, Panel } from '../components/ui.tsx'
import { formatBytes, formatScale } from '../lib/format.ts'
import {
  type ClubMap,
  COMMON_SCALES,
  kindOf,
  latestReady,
  MAX_UPLOAD_BYTES,
  type MapVersionSummary,
  nameFromFile,
  uploadAbandoned,
  useMaps,
  useUploadMap,
} from '../lib/maps.ts'
import { useClubContext } from './ClubLayout.tsx'

export function ClubMapsPage() {
  const { isAdmin } = useClubContext()
  return (
    <main className="mx-auto flex max-w-[1200px] flex-wrap items-start gap-3.5 px-5 pt-4 pb-8">
      <MapsPanel />
      {isAdmin && <UploadPanel />}
    </main>
  )
}

function MapsPanel() {
  const { t } = useTranslation()
  const { club, isAdmin } = useClubContext()
  const maps = useMaps(club.id)

  return (
    <Panel title={t('maps.heading')} titleId="maps-heading" className="flex-[999_1_560px]">
      {maps.isError ? (
        <div className="px-3.5 py-3">
          <ErrorMessage>{t('common.error')}</ErrorMessage>
        </div>
      ) : maps.data === undefined ? (
        <Loading label={t('common.loading')} />
      ) : maps.data.length === 0 ? (
        <EmptyState
          icon={
            <span className="text-[#a59fa9]">
              <MapIcon />
            </span>
          }
          title={t('maps.empty')}
        >
          {isAdmin ? t('maps.emptyAdmin') : t('maps.emptyMember')}
        </EmptyState>
      ) : (
        <ul className="m-0 list-none p-0">
          {maps.data.map((map, i) => (
            <MapRow key={map.id} map={map} first={i === 0} />
          ))}
        </ul>
      )}
    </Panel>
  )
}

export function MapRow({ map, first, linkPrefix = '' }: { map: ClubMap; first: boolean; linkPrefix?: string }) {
  const { t } = useTranslation()
  const ready = latestReady(map)
  // Admins also see the newest version that is not ready yet (processing or failed).
  const newest = map.versions[0]
  const pending = newest && newest.status !== 'ready' ? newest : undefined

  return (
    <li className={`flex flex-col gap-1 px-3.5 py-2.5 ${first ? '' : 'border-t border-line-soft'}`}>
      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {ready ? (
          <Link to={`${linkPrefix}${map.id}`} className="font-semibold">
            {map.name}
          </Link>
        ) : (
          <span className="font-semibold">{map.name}</span>
        )}
        {ready && <span className="text-[13px] text-muted">{versionLabel(ready, t)}</span>}
      </span>
      {pending && <VersionStatus version={pending} mapId={map.id} linkPrefix={linkPrefix} />}
    </li>
  )
}

export function versionLabel(v: MapVersionSummary, t: ReturnType<typeof useTranslation>['t']): string {
  return [t('maps.version', { number: v.version }), v.scale ? formatScale(v.scale) : null, t(`maps.kind.${v.kind}`)]
    .filter(Boolean)
    .join(' · ')
}

export function VersionStatus({ version, mapId, linkPrefix = '' }: { version: MapVersionSummary; mapId: string; linkPrefix?: string }) {
  const { t } = useTranslation()
  if (uploadAbandoned(version)) {
    return <span className="text-[13px] text-danger">{t('maps.uploadAbandoned', { number: version.version, file: version.fileName })}</span>
  }
  if (version.status === 'uploading' || version.status === 'processing') {
    return (
      <span className="text-[13px] text-muted" role="status">
        {t('maps.processing', { number: version.version, file: version.fileName })}
      </span>
    )
  }
  if (version.status === 'needs_alignment') {
    return (
      <span className="text-[13px] text-body">
        {t('maps.needsAlignment', { number: version.version })}{' '}
        <Link to={`${linkPrefix}${mapId}/align/${version.id}`}>{t('maps.lineUp')}</Link>
      </span>
    )
  }
  if (version.status === 'failed') {
    const known = ['not_ocad', 'unsupported_ocad_version', 'not_pdf', 'unreadable_file', 'empty_map'] as const
    const code = known.find(c => c === version.errorCode)
    return (
      <span className="text-[13px] text-danger">
        {t('maps.failed', { number: version.version, file: version.fileName })}{' '}
        {code ? t(`maps.errors.${code}`) : t('maps.errors.processing_failed')}
      </span>
    )
  }
  return null
}

/** Upload a new map, or with `mapId` a new version of that map. */
export function UploadPanel({ mapId, onUploaded }: { mapId?: string; onUploaded?: () => void } = {}) {
  const { t } = useTranslation()
  const { club } = useClubContext()
  const upload = useUploadMap(club.id)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [scale, setScale] = useState('15000')
  const [formKey, setFormKey] = useState(0)

  const kind = file ? kindOf(file.name) : null
  const problem = !file
    ? null
    : !kind
      ? t('maps.upload.wrongType')
      : file.size > MAX_UPLOAD_BYTES
        ? t('maps.upload.tooLarge', { size: formatBytes(file.size) })
        : null
  const scaleNumber = Number(scale)
  const scaleOk = kind !== 'pdf' || (Number.isInteger(scaleNumber) && scaleNumber >= 500 && scaleNumber <= 100000)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!file || problem || !scaleOk) return
    upload.mutate(
      { file, ...(mapId ? { mapId } : { name }), scale: kind === 'pdf' ? scaleNumber : undefined },
      {
        onSuccess: () => {
          setFile(null)
          setName('')
          setFormKey(k => k + 1)
          onUploaded?.()
        },
      },
    )
  }

  return (
    <Panel title={mapId ? t('maps.upload.versionHeading') : t('maps.upload.heading')} titleId="upload-heading" className="flex-[1_1_320px]">
      <form key={formKey} onSubmit={submit} className="flex flex-col gap-2.5 px-3.5 py-3">
        <span className="text-body">{mapId ? t('maps.upload.versionHelp') : t('maps.upload.help')}</span>
        <label htmlFor="map-file" className="text-[13px] font-semibold">
          {t('maps.upload.file')}
        </label>
        <input
          id="map-file"
          type="file"
          accept=".ocd,.pdf"
          className="text-[13px] file:mr-2 file:h-8 file:rounded file:border file:border-field file:bg-white file:px-3 file:font-[inherit]"
          onChange={e => {
            const chosen = e.target.files?.[0] ?? null
            setFile(chosen)
            if (chosen && !name && !mapId) setName(nameFromFile(chosen.name))
          }}
        />
        {problem && <ErrorMessage>{problem}</ErrorMessage>}
        {!mapId && (
          <>
            <label htmlFor="map-name" className="text-[13px] font-semibold">
              {t('maps.upload.name')}
            </label>
            <input id="map-name" className={fieldClass} value={name} maxLength={100} required onChange={e => setName(e.target.value)} />
          </>
        )}
        {kind === 'pdf' && (
          <>
            <label htmlFor="map-scale" className="text-[13px] font-semibold">
              {t('maps.upload.scale')}
            </label>
            <span className="text-[13px] text-muted">{t('maps.upload.scaleHelp')}</span>
            <span className="flex items-center gap-1.5">
              <span>1:</span>
              <input
                id="map-scale"
                className={`${fieldClass} w-28`}
                inputMode="numeric"
                list="common-scales"
                value={scale}
                required
                onChange={e => setScale(e.target.value.replace(/\s/g, ''))}
              />
              <datalist id="common-scales">
                {COMMON_SCALES.map(s => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </span>
            {!scaleOk && <ErrorMessage>{t('maps.upload.badScale')}</ErrorMessage>}
          </>
        )}
        {kind === 'ocad' && <span className="text-[13px] text-muted">{t('maps.upload.ocadScale')}</span>}
        {upload.isError && <ErrorMessage>{t('maps.upload.failed')}</ErrorMessage>}
        {upload.isSuccess && <span className="text-[13px] text-muted">{t('maps.upload.done')}</span>}
        <Button
          type="submit"
          variant="primary"
          className="self-start"
          disabled={!file || Boolean(problem) || !scaleOk || (!mapId && name.trim() === '') || upload.isPending}
        >
          {upload.isPending ? t('maps.upload.uploading') : t('maps.upload.submit')}
        </Button>
      </form>
    </Panel>
  )
}

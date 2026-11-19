import { type Fit, fitSimilarity, type Point } from '@course-setter/core'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { MapViewer, type Marker } from '../components/MapViewer.tsx'
import { Button, ErrorMessage, Loading, Panel } from '../components/ui.tsx'
import { useMaps, useMapVersion, useSaveAlignment, useTilesUrl } from '../lib/maps.ts'
import { useClubContext } from './ClubLayout.tsx'

type Pair = { id: number; from?: Point; to?: Point }

const complete = (p: Pair): p is Pair & { from: Point; to: Point } => Boolean(p.from && p.to)

/** Fit from the complete pairs, or null while there are too few (or they are all in one place). */
export function fitPairs(pairs: Pair[]): Fit | null {
  const done = pairs.filter(complete)
  if (done.length < 2) return null
  try {
    return fitSimilarity(done)
  } catch {
    return null
  }
}

/** Add a click on one side: it completes the oldest pair missing that side, or starts a new pair. */
export function addPoint(pairs: Pair[], side: 'from' | 'to', point: Point): Pair[] {
  const i = pairs.findIndex(p => !p[side])
  if (i === -1) return [...pairs, { id: Math.max(0, ...pairs.map(p => p.id)) + 1, [side]: point }]
  return pairs.map((p, j) => (j === i ? { ...p, [side]: point } : p))
}

/** /clubs/:clubId/maps/:mapId/align/:versionId: match points between a version and the one before it. */
export function AlignPage() {
  const { t } = useTranslation()
  const { mapId = '', versionId = '' } = useParams()
  const navigate = useNavigate()
  const { club, isAdmin } = useClubContext()
  const maps = useMaps(club.id)
  const next = useMapVersion(versionId)
  const previous = useMapVersion(next.data?.previousVersionId ?? undefined)
  const nextUrl = useTilesUrl(next.data?.tilesPath)
  const previousUrl = useTilesUrl(previous.data?.tilesPath)
  const save = useSaveAlignment(club.id)
  const [pairs, setPairs] = useState<Pair[]>([])
  const [overlay, setOverlay] = useState(false)

  const fit = useMemo(() => fitPairs(pairs), [pairs])
  // Before any points are matched, an existing (automatic) transform can be checked with the overlay.
  const transform = fit?.transform ?? next.data?.transform ?? null

  const fromMarkers = useMemo<Marker[]>(
    () => pairs.flatMap((p, i) => (p.from ? [{ id: `f${i}`, point: p.from, label: String(i + 1), active: !p.to }] : [])),
    [pairs],
  )
  const toMarkers = useMemo<Marker[]>(
    () => pairs.flatMap((p, i) => (p.to ? [{ id: `t${i}`, point: p.to, label: String(i + 1), active: !p.from }] : [])),
    [pairs],
  )
  const overlayProps = useMemo(
    () =>
      overlay && transform && previous.data?.tiles && previousUrl.data && previous.data
        ? { versionId: previous.data.id, grid: previous.data.tiles, tilesUrl: previousUrl.data, toThis: transform, opacity: 0.5 }
        : null,
    [overlay, transform, previous.data, previousUrl.data],
  )

  if (!isAdmin) return <PageMessage>{t('settings.adminsOnly')}</PageMessage>
  if (next.isError || previous.isError || nextUrl.isError || previousUrl.isError || maps.isError) {
    return <PageMessage>{t('common.error')}</PageMessage>
  }
  if (next.data === null || (next.data && !next.data.previousVersionId)) {
    return (
      <PageMessage>
        {t('align.notNeeded')} <Link to={`/clubs/${club.id}/maps/${mapId}`}>{t('maps.backToMaps')}</Link>
      </PageMessage>
    )
  }
  const n = next.data
  const p = previous.data
  if (!n || !p || !n.tiles || !p.tiles || !nextUrl.data || !previousUrl.data) return <Loading label={t('common.loading')} />

  const mapName = maps.data?.find(m => m.id === mapId)?.name ?? ''
  const onSave = () => {
    if (!fit) return
    save.mutate(
      { versionId: n.id, transform: fit.transform, rms: fit.rms },
      { onSuccess: () => navigate(`/clubs/${club.id}/maps/${mapId}?version=${n.id}`) },
    )
  }

  return (
    <main className="mx-auto flex max-w-[1600px] flex-col gap-2.5 px-5 pt-3 pb-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link to={`/clubs/${club.id}/maps/${mapId}`} className="text-[13px]">
          {mapName}
        </Link>
        <h2 className="m-0 text-base font-semibold">{t('align.heading', { next: n.version, previous: p.version })}</h2>
      </div>
      <p className="m-0 max-w-3xl text-body">{t('align.help', { next: n.version, previous: p.version })}</p>
      {n.status === 'ready' && n.transformMethod !== 'points' && pairs.length === 0 && (
        <p className="m-0 text-[13px] text-muted">{t('align.automatic')}</p>
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-2.5">
        <section aria-label={t('align.previous', { number: p.version })} className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold">{t('align.previous', { number: p.version })}</span>
          <div className="h-[calc(100vh-22rem)] min-h-[320px]">
            <MapViewer
              versionId={p.id}
              grid={p.tiles}
              tilesUrl={previousUrl.data}
              scale={p.scale ?? 15000}
              tools="none"
              markers={fromMarkers}
              onPick={point => setPairs(ps => addPoint(ps, 'from', point))}
            />
          </div>
        </section>
        <section aria-label={t('align.next', { number: n.version })} className="flex flex-col gap-1">
          <span className="flex items-center gap-3 text-[13px] font-semibold">
            {t('align.next', { number: n.version })}
            <label className="flex items-center gap-1.5 font-normal">
              <input type="checkbox" checked={overlay} disabled={!transform} onChange={e => setOverlay(e.target.checked)} />
              {t('align.overlay', { number: p.version })}
            </label>
          </span>
          <div className="h-[calc(100vh-22rem)] min-h-[320px]">
            <MapViewer
              versionId={n.id}
              grid={n.tiles}
              tilesUrl={nextUrl.data}
              scale={n.scale ?? 15000}
              tools="none"
              markers={toMarkers}
              onPick={point => setPairs(ps => addPoint(ps, 'to', point))}
              overlay={overlayProps}
            />
          </div>
        </section>
      </div>

      <Panel
        title={t('align.pairs')}
        titleId="align-pairs"
        actions={
          <>
            <Button size="sm" onClick={() => setPairs([])} disabled={pairs.length === 0}>
              {t('align.clear')}
            </Button>
            <Button size="sm" variant="primary" onClick={onSave} disabled={!fit || save.isPending}>
              {t('align.save', { number: n.version })}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-1.5 px-3.5 py-2.5">
          {pairs.length === 0 ? (
            <span className="text-muted">{t('align.none')}</span>
          ) : (
            <ol className="m-0 flex list-none flex-col gap-1 p-0">
              {pairs.map((pair, i) => (
                <li key={pair.id} className="flex items-center gap-2 text-[13px]">
                  <span className="font-semibold">{t('align.pair', { number: i + 1 })}</span>
                  <span className="text-muted">
                    {!pair.to
                      ? t('align.clickNext', { number: n.version })
                      : !pair.from
                        ? t('align.clickPrevious', { number: p.version })
                        : fit && pairs.filter(complete).length > 2
                          ? t('align.off', { distance: (fit.residuals[pairs.slice(0, i).filter(complete).length] ?? 0).toFixed(1) })
                          : ''}
                  </span>
                  <Button size="sm" variant="danger" onClick={() => setPairs(ps => ps.filter((_, j) => j !== i))}>
                    {t('align.remove')}
                  </Button>
                </li>
              ))}
            </ol>
          )}
          <span data-testid="align-fit" className="text-[13px]">
            {fit
              ? pairs.filter(complete).length === 2
                ? t('align.fitTwo')
                : t('align.fit', { rms: fit.rms.toFixed(1) })
              : pairs.length > 0
                ? t('align.tooFew')
                : ''}
          </span>
          {save.isError && <ErrorMessage>{t('common.error')}</ErrorMessage>}
        </div>
      </Panel>
    </main>
  )
}

function PageMessage({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-[1200px] px-5 py-6">{children}</main>
}

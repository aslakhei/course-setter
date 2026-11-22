// Layout mode's left panel: which layout the shown course uses, adding elements, and the layers (the
// layout's elements from top to bottom, then the description sheet and the map), each to select, hide,
// lock and move up or down.
import {
  addLayoutElement,
  type Course,
  type EventDoc,
  type Field,
  type NewElementKind,
  type PrintSettings,
  reorderLayoutElement,
  updateLayoutElement,
} from '@course-setter/core'
import { type FormEvent, type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, ErrorMessage, fieldClass } from '../components/ui.tsx'
import { useAssetRows } from '../lib/assets.ts'
import { type ChosenImage, ImagePicker } from './ImagePicker.tsx'
import { type AppliesTo, hiddenState, layerName, paletteElement, setHidden } from './layout.ts'

/** The Layers entry for the map area (element ids are uuids, so this never clashes). */
export const MAP_LAYER = '#map'

export type LayoutPanelProps = {
  doc: EventDoc
  course: Course
  settings: PrintSettings
  appliesTo: AppliesTo
  /** The selected elements' ids (or the map). */
  selected: string[]
  /** A click on a layer; `additive` (Shift) adds it to the selection or takes it away. */
  onSelect: (id: string | null, additive?: boolean) => void
  onEdit: (doc: EventDoc) => void
  clubId: string
  eventId: string
  descriptionsShown: boolean
  onDescriptions: (show: boolean) => void
  /** The shown course's field values, to name text elements as they print. */
  values: Record<Field, string>
}

const PALETTE: NewElementKind[] = ['text', 'shape', 'northArrow', 'scaleBar']

function IconButton({ label, pressed, onClick, children }: { label: string; pressed?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...(pressed !== undefined ? { 'aria-pressed': pressed } : {})}
      onClick={onClick}
      className="flex size-7 shrink-0 items-center justify-center rounded text-muted hover:bg-subtle hover:text-ink"
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        {children}
      </svg>
    </button>
  )
}

export function LayoutPanel(props: LayoutPanelProps) {
  const { doc, course, settings, appliesTo, selected, onSelect, onEdit } = props
  const { t } = useTranslation()
  const [qrOpen, setQrOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [qrUrl, setQrUrl] = useState('https://')
  const elements = (settings.ownLayout ?? doc.printLayout ?? { elements: [] }).elements
  // Image layers are named after their image.
  const imageIds = [...new Set(elements.flatMap(e => (e.kind === 'image' ? [e.asset] : [])))].sort()
  const imageRows = useAssetRows(imageIds)
  const imageNames = new Map((imageRows.data ?? []).map(a => [a.id, a.name]))
  const qrOk = /^https?:\/\/[^\s/]+\.[^\s]+$/.test(qrUrl.trim())

  const add = (kind: NewElementKind, extra: { url?: string; asset?: string; aspect?: number } = {}) => {
    const id = crypto.randomUUID()
    onEdit(addLayoutElement(doc, course.id, settings, paletteElement(kind, id, settings.margin, extra)))
    onSelect(id)
  }
  const addImage = (image: ChosenImage) => {
    setPicking(false)
    add('image', { asset: image.id, ...(image.aspect ? { aspect: image.aspect } : {}) })
  }
  const addQr = (e: FormEvent) => {
    e.preventDefault()
    if (!qrOk) return
    add('qr', { url: qrUrl.trim() })
    setQrOpen(false)
    setQrUrl('https://')
  }

  const rowClass = (on: boolean) =>
    `flex items-center gap-1 rounded px-1.5 ${on ? 'bg-brand-50 outline-1 -outline-offset-1 outline-brand-600' : 'hover:bg-subtle'}`

  return (
    <aside aria-label={t('layout.panel')} className="flex min-h-0 w-60 shrink-0 flex-col overflow-auto border-r border-line bg-white">
      <p className="m-0 border-b border-line-soft px-3 py-2 text-xs text-body" data-testid="layout-scope">
        {settings.ownLayout ? t('layout.own', { course: course.name }) : t('layout.shared')}
      </p>

      <section aria-labelledby="layout-add" className="flex flex-col gap-1.5 border-b border-line-soft px-3 py-2.5">
        <h2 id="layout-add" className="m-0 text-[13px] font-semibold">
          {t('layout.add')}
        </h2>
        <div className="grid grid-cols-2 gap-1.5">
          {PALETTE.map(kind => (
            <Button key={kind} size="sm" onClick={() => add(kind)}>
              {t(`layout.kinds.${kind}`)}
            </Button>
          ))}
          <Button size="sm" onClick={() => setPicking(true)}>
            {t('layout.kinds.image')}
          </Button>
          <Button size="sm" onClick={() => setQrOpen(o => !o)} aria-expanded={qrOpen}>
            {t('layout.kinds.qr')}
          </Button>
        </div>
        {qrOpen && (
          <form onSubmit={addQr} className="flex flex-col gap-1.5">
            <label htmlFor="layout-qr-url" className="text-xs text-muted">
              {t('layout.qrAddress')}
            </label>
            <input id="layout-qr-url" className={fieldClass} value={qrUrl} maxLength={500} onChange={e => setQrUrl(e.target.value)} />
            {!qrOk && qrUrl !== 'https://' && <ErrorMessage>{t('layout.qrBad')}</ErrorMessage>}
            <Button type="submit" size="sm" variant="primary" disabled={!qrOk}>
              {t('layout.qrAdd')}
            </Button>
          </form>
        )}
      </section>

      <section aria-labelledby="layout-layers" className="flex flex-col gap-0.5 px-2 py-2.5">
        <h2 id="layout-layers" className="m-0 px-1 pb-1 text-[13px] font-semibold">
          {t('layout.layers')}
        </h2>
        {elements.length === 0 && <span className="px-1 text-xs text-muted">{t('layout.layersEmpty')}</span>}
        <ul aria-label={t('layout.layers')} className="m-0 flex list-none flex-col gap-0.5 p-0">
          {[...elements].reverse().map((e, i) => {
            const name = layerName(e, t, props.values, imageNames)
            const hidden = hiddenState(doc, settings, e.id)
            const index = elements.length - 1 - i
            return (
              <li key={e.id} className={rowClass(selected.includes(e.id))}>
                <button
                  type="button"
                  className={`flex min-w-0 grow flex-col py-1 text-left text-[13px] ${hidden !== 'no' ? 'text-muted' : ''}`}
                  aria-current={selected.includes(e.id) ? 'true' : undefined}
                  onClick={click => onSelect(e.id, click.shiftKey)}
                >
                  <span className="truncate">{name}</span>
                  {hidden !== 'no' && (
                    <span className="text-[11px]">{t(hidden === 'all' ? 'layout.hiddenAll' : 'layout.hiddenCourse')}</span>
                  )}
                </button>
                <IconButton
                  label={t(hidden === 'no' ? 'layout.hide' : 'layout.show', { name })}
                  pressed={hidden !== 'no'}
                  onClick={() => onEdit(setHidden(doc, course, settings, hidden === 'all' ? 'all' : appliesTo, e.id, hidden === 'no'))}
                >
                  {hidden === 'no' ? (
                    <>
                      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                      <circle cx="12" cy="12" r="3" />
                    </>
                  ) : (
                    <path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6" />
                  )}
                </IconButton>
                <IconButton
                  label={t(e.locked ? 'layout.unlock' : 'layout.lock', { name })}
                  pressed={e.locked === true}
                  onClick={() =>
                    onEdit(
                      updateLayoutElement(doc, course.id, settings, e.id, x => {
                        const { locked: _old, ...rest } = x
                        return e.locked ? rest : { ...rest, locked: true }
                      }),
                    )
                  }
                >
                  <rect x="5" y="11" width="14" height="10" rx="2" />
                  <path d={e.locked ? 'M8 11V7a4 4 0 0 1 8 0v4' : 'M8 11V7a4 4 0 0 1 7.5-2'} />
                </IconButton>
                <IconButton
                  label={t('layout.up', { name })}
                  onClick={() => onEdit(reorderLayoutElement(doc, course.id, settings, e.id, index + 1))}
                >
                  <path d="M6 15l6-6 6 6" />
                </IconButton>
                <IconButton
                  label={t('layout.down', { name })}
                  onClick={() => onEdit(reorderLayoutElement(doc, course.id, settings, e.id, index - 1))}
                >
                  <path d="M6 9l6 6 6-6" />
                </IconButton>
              </li>
            )
          })}
          <li className={rowClass(false)}>
            <label className="flex grow items-center gap-2 py-1 text-[13px]">
              <input
                type="checkbox"
                className="size-4 accent-brand-600"
                checked={props.descriptionsShown}
                onChange={e => props.onDescriptions(e.target.checked)}
              />
              {t('layout.descriptions')}
            </label>
          </li>
          <li className={rowClass(selected.includes(MAP_LAYER))}>
            <button type="button" className="grow py-1 text-left text-[13px]" onClick={() => onSelect(MAP_LAYER)}>
              {t('layout.map')}
            </button>
          </li>
        </ul>
      </section>
      {picking && <ImagePicker clubId={props.clubId} eventId={props.eventId} onChoose={addImage} onClose={() => setPicking(false)} />}
    </aside>
  )
}

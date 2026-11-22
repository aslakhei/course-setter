// The template gallery in the Layout mode: universal templates (made for as many colours as the club
// has), the club's and one's own, each with the club's logo and colours, its images in their own shape,
// and seen on the shown course; one is copied into the event for every course
// (replacing the shared layout) or for the shown course only. The current layout can be saved as a
// template of one's own, or (admins) of the club.
import {
  type Branding,
  fitImages,
  type PrintLayout,
  type PrintPage,
  resolveTemplate,
  UNIVERSAL_TEMPLATES,
  universalLayout,
} from '@course-setter/core'
import { type FormEvent, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, ErrorMessage, fieldClass } from '../components/ui.tsx'
import { aspectOf, useAssetImages, useAssetRows } from '../lib/assets.ts'
import { formatDate } from '../lib/format.ts'
import type { SavedTemplate, TemplateScope } from '../lib/templates.ts'
import { Modal } from './Dialogs.tsx'
import { PagePreview } from './PagePreview.tsx'
import { Segmented } from './PrintView.tsx'

export type ApplyTemplate = (layout: PrintLayout, to: 'all' | 'course', keepSheets: boolean) => void
type Tab = 'universal' | 'club' | 'mine'
type Item = { key: string; name: string; note: string; layout: PrintLayout; saved?: SavedTemplate }

export function TemplateGallery({
  branding,
  courseName,
  clubName,
  saved,
  isAdmin,
  pageWith,
  onApply,
  onSave,
  saving,
  saveFailed,
  onDelete,
  onClose,
}: {
  branding: Branding
  courseName: string
  clubName: string
  /** The club's templates and one's own. */
  saved: SavedTemplate[]
  isAdmin: boolean
  /** The shown course's page with a layout applied (for every course or the shown one). */
  pageWith: (layout: PrintLayout, to: 'all' | 'course') => PrintPage
  onApply: ApplyTemplate
  /** Save the current layout as a template; resolves to whether one of that name was replaced. */
  onSave: (name: string, scope: TemplateScope) => Promise<boolean>
  saving: boolean
  saveFailed: boolean
  onDelete: (template: SavedTemplate) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('universal')
  const [chosen, setChosen] = useState('universal:plain')
  const [to, setTo] = useState<'all' | 'course'>('all')
  const [keepSheets, setKeepSheets] = useState(true)
  const [name, setName] = useState('')
  const [scope, setScope] = useState<TemplateScope>('personal')
  const [savedNote, setSavedNote] = useState<string | null>(null)

  // Resolved with the club's branding and stable ids, so previews do not change on every render.
  const resolved = useMemo((): Record<Tab, Item[]> => {
    const resolve = (key: string, layout: PrintLayout) => {
      let n = 0
      return resolveTemplate(layout, branding, () => `${key}-${++n}`)
    }
    const fromSaved = (s: SavedTemplate): Item => ({
      key: `saved:${s.id}`,
      name: s.name,
      note: [s.madeBy, formatDate(s.updatedAt)].filter(Boolean).join(' · '),
      layout: resolve(s.id, s.layout),
      saved: s,
    })
    return {
      universal: UNIVERSAL_TEMPLATES.map(u => ({
        key: `universal:${u.id}`,
        name: t(`templates.universalTemplates.${u.id}.name`),
        note: t(`templates.universalTemplates.${u.id}.description`),
        layout: resolve(u.id, universalLayout(u, branding)),
      })),
      club: saved.filter(s => s.scope === 'club').map(fromSaved),
      mine: saved.filter(s => s.scope === 'personal').map(fromSaved),
    }
  }, [branding, saved, t])

  const assetIds = useMemo(
    () =>
      [
        ...new Set(
          Object.values(resolved).flatMap(list => list.flatMap(i => i.layout.elements.flatMap(e => (e.kind === 'image' ? [e.asset] : [])))),
        ),
      ].sort(),
    [resolved],
  )
  const { images, loaded } = useAssetImages(assetIds)
  // Each image keeps its own aspect ratio inside the template's box (a square box for any logo).
  const rows = useAssetRows(assetIds)
  const items = useMemo((): Record<Tab, Item[]> => {
    const aspects = new Map((rows.data ?? []).map(a => [a.id, aspectOf(a)]))
    const fit = (list: Item[]) => list.map(i => ({ ...i, layout: fitImages(i.layout, id => aspects.get(id) ?? null) }))
    return { universal: fit(resolved.universal), club: fit(resolved.club), mine: fit(resolved.mine) }
  }, [resolved, rows.data])
  const shown = items[tab]
  const selected = shown.find(i => i.key === chosen) ?? shown[0]
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new resolver when an image comes in, so previews draw again
  const imageOf = useMemo(() => (id: string) => images.get(id) ?? null, [images, loaded])
  const pages = useMemo(() => shown.map(i => ({ ...i, page: pageWith(i.layout, 'all') })), [shown, pageWith])
  const selectedPage = useMemo(() => (selected ? pageWith(selected.layout, to) : null), [selected, to, pageWith])
  const canDelete = (s: SavedTemplate | undefined) => Boolean(s && (s.scope === 'personal' ? true : isAdmin))

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    const replaced = await onSave(name, scope).catch(() => null)
    if (replaced === null) return
    setSavedNote(replaced ? t('templates.replaced', { name: name.trim() }) : t('templates.saved', { name: name.trim() }))
    setTab(scope === 'club' ? 'club' : 'mine')
    setName('')
  }

  return (
    <Modal titleId="templates-heading" onClose={onClose} wide>
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="templates-heading" className="m-0 text-base font-semibold">
          {t('templates.heading')}
        </h2>
        <Segmented
          name="templates-tab"
          label={t('templates.heading')}
          options={['universal', 'club', 'mine'] as const}
          value={tab}
          text={o =>
            o === 'universal'
              ? t('templates.tabs.universal', { count: items.universal.length })
              : o === 'club'
                ? t('templates.tabs.club', { club: clubName, count: items.club.length })
                : t('templates.tabs.mine', { count: items.mine.length })
          }
          onChange={o => {
            setTab(o)
            setChosen('')
          }}
        />
        <span className="grow" />
        <Button size="sm" onClick={onClose}>
          {t('layout.picker.close')}
        </Button>
      </div>
      <p className="m-0 text-[13px] text-body">{t(`templates.help.${tab}`)}</p>
      <div className="flex min-h-0 flex-wrap gap-4">
        {pages.length === 0 ? (
          <p className="m-0 flex-[999_1_360px] text-[13px] text-muted">{t(`templates.empty.${tab}`)}</p>
        ) : (
          <ul
            aria-label={t(`templates.tabs.${tab}`, { club: clubName, count: pages.length })}
            className="m-0 grid min-w-0 flex-[999_1_360px] list-none grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3 p-0"
          >
            {pages.map(i => (
              <li key={i.key}>
                <button
                  type="button"
                  aria-pressed={selected?.key === i.key}
                  onClick={() => setChosen(i.key)}
                  className={`flex w-full flex-col items-center gap-1.5 rounded-md border bg-white p-2 text-left ${selected?.key === i.key ? 'border-2 border-brand-600 bg-brand-50' : 'border-line hover:border-brand-600'}`}
                >
                  <PagePreview page={i.page} width={96} images={imageOf} label={i.name} />
                  <span className="self-start text-[13px] font-semibold">{i.name}</span>
                  <span className="self-start text-xs text-muted">{i.note}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {selected && selectedPage && (
          <aside aria-label={t('templates.selected')} className="flex flex-[1_1_240px] flex-col gap-3 border-l border-line-soft pl-4">
            <h3 className="m-0 text-[15px] font-semibold">{selected.name}</h3>
            <div className="self-center">
              <PagePreview page={selectedPage} width={200} images={imageOf} label={t('templates.previewOf', { course: courseName })} />
            </div>
            <span className="text-center text-xs text-muted">{t('templates.previewHelp', { course: courseName })}</span>
            <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
              <legend className="mb-1 p-0 text-[13px] font-semibold">{t('templates.useFor')}</legend>
              {(['all', 'course'] as const).map(o => (
                <label key={o} className="flex items-center gap-2 text-[13px]">
                  <input type="radio" name="template-for" className="accent-brand-600" checked={to === o} onChange={() => setTo(o)} />
                  {o === 'all' ? t('templates.forAll') : t('templates.forCourse', { course: courseName })}
                </label>
              ))}
            </fieldset>
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                className="size-4 accent-brand-600"
                checked={keepSheets}
                onChange={e => setKeepSheets(e.target.checked)}
              />
              {t('templates.keepSheets')}
            </label>
            <span className="text-xs text-muted">{t('templates.copied')}</span>
            <Button variant="primary" size="lg" onClick={() => onApply(selected.layout, to, keepSheets)}>
              {t('templates.use')}
            </Button>
            {selected.saved && canDelete(selected.saved) && (
              <Button
                size="sm"
                variant="danger"
                className="self-start"
                onClick={() =>
                  selected.saved && window.confirm(t('templates.deleteConfirm', { name: selected.name })) && onDelete(selected.saved)
                }
              >
                {t('templates.delete')}
              </Button>
            )}
          </aside>
        )}
      </div>
      <form onSubmit={save} className="flex flex-wrap items-center gap-2.5 border-t border-line-soft pt-3">
        <label htmlFor="template-name" className="text-[13px] font-semibold">
          {t('templates.saveCurrent')}
        </label>
        <input
          id="template-name"
          className={`${fieldClass} w-56`}
          maxLength={100}
          value={name}
          placeholder={t('templates.namePlaceholder')}
          onChange={e => setName(e.target.value)}
        />
        <fieldset className="m-0 flex items-center gap-3 border-0 p-0">
          <legend className="sr-only">{t('templates.saveAs')}</legend>
          <label className="flex items-center gap-1.5 text-[13px]">
            <input
              type="radio"
              name="template-scope"
              className="accent-brand-600"
              checked={scope === 'personal'}
              onChange={() => setScope('personal')}
            />
            {t('templates.mine')}
          </label>
          <label
            className={`flex items-center gap-1.5 text-[13px] ${isAdmin ? '' : 'text-muted'}`}
            title={isAdmin ? undefined : t('templates.adminsOnly')}
          >
            <input
              type="radio"
              name="template-scope"
              className="accent-brand-600"
              disabled={!isAdmin}
              checked={scope === 'club'}
              onChange={() => setScope('club')}
            />
            {t('templates.forClub', { club: clubName })}
          </label>
        </fieldset>
        <Button type="submit" size="sm" disabled={!name.trim() || saving}>
          {t('templates.save')}
        </Button>
        {savedNote && <span className="text-xs text-muted">{savedNote}</span>}
        {saveFailed && <ErrorMessage>{t('common.error')}</ErrorMessage>}
      </form>
    </Modal>
  )
}

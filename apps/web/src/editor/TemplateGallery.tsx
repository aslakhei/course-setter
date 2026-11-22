// The template gallery in the Layout mode: universal templates with the club's logo and colours, seen
// on the shown course; one is copied into the event for every course (replacing the shared layout) or
// for the shown course only.
import { type Branding, type PrintLayout, type PrintPage, resolveTemplate, UNIVERSAL_TEMPLATES } from '@course-setter/core'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui.tsx'
import { useAssetImages } from '../lib/assets.ts'
import { Modal } from './Dialogs.tsx'
import { PagePreview } from './PagePreview.tsx'

export type ApplyTemplate = (layout: PrintLayout, to: 'all' | 'course', keepSheets: boolean) => void

export function TemplateGallery({
  branding,
  courseName,
  pageWith,
  onApply,
  onClose,
}: {
  branding: Branding
  courseName: string
  /** The shown course's page with a layout applied (for every course or the shown one). */
  pageWith: (layout: PrintLayout, to: 'all' | 'course') => PrintPage
  onApply: ApplyTemplate
  onClose: () => void
}) {
  const { t } = useTranslation()
  // Resolved once per branding, with stable ids so previews do not change on every render.
  const templates = useMemo(
    () =>
      UNIVERSAL_TEMPLATES.map(tpl => {
        let n = 0
        return { id: tpl.id, layout: resolveTemplate(tpl.layout, branding, () => `${tpl.id}-${++n}`) }
      }),
    [branding],
  )
  const [chosen, setChosen] = useState(templates[0]?.id ?? '')
  const [to, setTo] = useState<'all' | 'course'>('all')
  const [keepSheets, setKeepSheets] = useState(true)
  const assetIds = useMemo(
    () => [...new Set(templates.flatMap(tpl => tpl.layout.elements.flatMap(e => (e.kind === 'image' ? [e.asset] : []))))].sort(),
    [templates],
  )
  const { images, loaded } = useAssetImages(assetIds)
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new resolver when an image comes in, so previews draw again
  const imageOf = useMemo(() => (id: string) => images.get(id) ?? null, [images, loaded])
  const pages = useMemo(
    () => templates.map(tpl => ({ id: tpl.id, layout: tpl.layout, page: pageWith(tpl.layout, 'all') })),
    [templates, pageWith],
  )
  const selected = templates.find(tpl => tpl.id === chosen)
  const selectedPage = useMemo(() => (selected ? pageWith(selected.layout, to) : null), [selected, to, pageWith])

  return (
    <Modal titleId="templates-heading" onClose={onClose} wide>
      <div className="flex items-center gap-3">
        <h2 id="templates-heading" className="m-0 grow text-base font-semibold">
          {t('templates.heading')}
        </h2>
        <Button size="sm" onClick={onClose}>
          {t('layout.picker.close')}
        </Button>
      </div>
      <p className="m-0 text-[13px] text-body">{t('templates.universalHelp')}</p>
      <div className="flex min-h-0 flex-wrap gap-4">
        <ul
          aria-label={t('templates.universal')}
          className="m-0 grid min-w-0 flex-[999_1_360px] list-none grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3 p-0"
        >
          {pages.map(({ id, page }) => (
            <li key={id}>
              <button
                type="button"
                aria-pressed={chosen === id}
                onClick={() => setChosen(id)}
                className={`flex w-full flex-col items-center gap-1.5 rounded-md border bg-white p-2 text-left ${chosen === id ? 'border-2 border-brand-600 bg-brand-50' : 'border-line hover:border-brand-600'}`}
              >
                <PagePreview page={page} width={96} images={imageOf} label={t(`templates.universalTemplates.${id}.name`)} />
                <span className="self-start text-[13px] font-semibold">{t(`templates.universalTemplates.${id}.name`)}</span>
                <span className="self-start text-xs text-muted">{t(`templates.universalTemplates.${id}.description`)}</span>
              </button>
            </li>
          ))}
        </ul>
        {selected && selectedPage && (
          <aside aria-label={t('templates.selected')} className="flex flex-[1_1_240px] flex-col gap-3 border-l border-line-soft pl-4">
            <h3 className="m-0 text-[15px] font-semibold">{t(`templates.universalTemplates.${selected.id}.name`)}</h3>
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
          </aside>
        )}
      </div>
    </Modal>
  )
}

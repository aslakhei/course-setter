// The print view's toolbar (which course's page is shown, paper, orientation) and panel (which courses
// to print, one PDF or one per course, making the PDF and downloading recent ones).
import {
  type Course,
  courseLength,
  DEFAULT_CELL_SIZE,
  type EventDoc,
  ORIENTATIONS,
  type Orientation,
  PAPERS,
  type Paper,
  type PrintSettings,
} from '@course-setter/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, ErrorMessage, fieldClass } from '../components/ui.tsx'
import { downloadUrl, type ExportSummary, isPending, useExports, useRequestExport } from '../lib/exports.ts'
import { formatScale } from '../lib/format.ts'
import { formatKm } from './CoursePanel.tsx'
import { CELL_SIZES, formatPaper, PRINT_SCALES } from './print.ts'
import type { SaveStatus } from './useAutosave.ts'

function Segmented<T extends string>({
  name,
  label,
  options,
  value,
  text,
  onChange,
}: {
  name: string
  label: string
  options: readonly T[]
  value: T
  text: (option: T) => string
  onChange: (option: T) => void
}) {
  return (
    <fieldset className="m-0 flex overflow-hidden rounded border border-field p-0">
      <legend className="sr-only">{label}</legend>
      {options.map((option, i) => (
        <label
          key={option}
          className={`flex h-[30px] cursor-pointer items-center px-2.5 text-[13px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-600 ${i ? 'border-l border-field' : ''} ${option === value ? 'bg-brand-50 font-semibold text-brand-700' : 'bg-white hover:bg-subtle'}`}
        >
          <input type="radio" name={name} className="sr-only" checked={option === value} onChange={() => onChange(option)} />
          {text(option)}
        </label>
      ))}
    </fieldset>
  )
}

export function PrintToolbar({
  doc,
  course,
  settings,
  onCourse,
  onPaper,
  onScale,
  onCellSize,
  onReset,
  onBack,
}: {
  doc: EventDoc
  course: Course
  settings: PrintSettings
  onCourse: (courseId: string) => void
  onPaper: (paper: Paper, orientation: Orientation) => void
  onScale: (scale: number) => void
  onCellSize: (size: number) => void
  onReset: () => void
  onBack: () => void
}) {
  const { t } = useTranslation()
  const scales: readonly number[] = PRINT_SCALES.includes(course.printScale as (typeof PRINT_SCALES)[number])
    ? PRINT_SCALES
    : [...PRINT_SCALES, course.printScale].sort((a, b) => a - b)
  return (
    <div
      role="toolbar"
      aria-label={t('print.toolbar')}
      className="flex min-h-11 flex-wrap items-center gap-2.5 border-t border-line-soft bg-white px-3 py-1"
    >
      <Button onClick={onBack}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
          <path d="M15 5l-7 7 7 7" />
        </svg>
        {t('print.back')}
      </Button>
      <span aria-hidden="true" className="h-5 w-px bg-line" />
      <label htmlFor="print-course" className="text-[13px] text-muted">
        {t('print.pageOf')}
      </label>
      <select id="print-course" className={fieldClass} value={course.id} onChange={e => onCourse(e.target.value)}>
        {doc.courses.map(c => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <Segmented
        name="print-paper"
        label={t('print.paper')}
        options={Object.keys(PAPERS) as Paper[]}
        value={settings.paper}
        text={p => p}
        onChange={p => onPaper(p, settings.orientation)}
      />
      <Segmented
        name="print-orientation"
        label={t('print.orientation')}
        options={ORIENTATIONS}
        value={settings.orientation}
        text={o => t(`print.${o}`)}
        onChange={o => onPaper(settings.paper, o)}
      />
      <label htmlFor="print-scale" className="text-[13px] text-muted">
        {t('print.scale')}
      </label>
      <select
        id="print-scale"
        className={fieldClass}
        value={course.printScale}
        title={t('print.scaleHelp')}
        onChange={e => onScale(Number(e.target.value))}
      >
        {scales.map(s => (
          <option key={s} value={s}>
            {formatScale(s)}
          </option>
        ))}
      </select>
      <label htmlFor="print-cell-size" className="text-[13px] text-muted">
        {t('print.cellSize')}
      </label>
      <select
        id="print-cell-size"
        className={fieldClass}
        value={course.descriptionCellSize ?? DEFAULT_CELL_SIZE}
        title={t('print.cellSizeHelp')}
        onChange={e => onCellSize(Number(e.target.value))}
      >
        {CELL_SIZES.map(s => (
          <option key={s} value={s}>
            {t('print.cellSizeOption', { size: s })}
          </option>
        ))}
      </select>
      <Button size="sm" onClick={onReset} disabled={!course.print} title={t('print.resetHelp')}>
        {t('print.reset')}
      </Button>
      <span className="grow" />
      <span className="text-[13px] text-muted">{t('print.hint')}</span>
    </div>
  )
}

const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

export function PrintPanel({
  eventId,
  doc,
  shown,
  saveStatus,
  settingsOf,
  onShow,
}: {
  eventId: string
  doc: EventDoc
  /** The course whose page is on the map. */
  shown: Course
  saveStatus: SaveStatus
  /** The settings a course prints with. */
  settingsOf: (course: Course) => PrintSettings
  onShow: (courseId: string) => void
}) {
  const { t } = useTranslation()
  const [chosen, setChosen] = useState<Set<string>>(() => new Set([shown.id]))
  const [separate, setSeparate] = useState(false)
  const exports = useExports(eventId)
  const request = useRequestExport(eventId)
  const [downloadError, setDownloadError] = useState(false)

  // In the event's order; courses deleted meanwhile drop out.
  const courseIds = doc.courses.filter(c => chosen.has(c.id)).map(c => c.id)
  const toggle = (id: string) =>
    setChosen(old => {
      const next = new Set(old)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const names = (ids: string[]) =>
    ids
      .map(id => doc.courses.find(c => c.id === id)?.name)
      .filter(Boolean)
      .join(', ')

  // The export prints the event as saved: wait for the latest changes to be saved.
  const saved = saveStatus === 'saved'
  const download = async (x: ExportSummary) => {
    setDownloadError(false)
    try {
      window.location.assign(await downloadUrl(x))
    } catch {
      setDownloadError(true)
    }
  }

  return (
    <aside
      aria-label={t('print.panel')}
      className="flex min-h-0 flex-[1_1_320px] flex-col overflow-auto border-l border-line bg-white md:max-w-[340px]"
    >
      <div className="flex items-baseline gap-2 px-3 pt-3 pb-2">
        <h2 className="m-0 text-[15px] font-semibold">{t('print.panel')}</h2>
        <span className="text-xs text-muted">{t('print.selected', { count: courseIds.length, total: doc.courses.length })}</span>
      </div>
      <ul className="m-0 list-none p-0">
        {doc.courses.map(c => {
          const s = settingsOf(c)
          const isShown = c.id === shown.id
          return (
            <li key={c.id} className={`flex items-center gap-2.5 border-t border-line-soft px-3 py-2 ${isShown ? 'bg-[#eaf2f9]' : ''}`}>
              <input
                type="checkbox"
                id={`print-${c.id}`}
                className="size-4 accent-brand-600"
                checked={chosen.has(c.id)}
                onChange={() => toggle(c.id)}
              />
              <label htmlFor={`print-${c.id}`} className="flex grow flex-col text-[13px]">
                <span className={isShown ? 'font-semibold' : ''}>{c.name}</span>
                <span className="text-xs text-muted">
                  {t('print.summary', {
                    paper: formatPaper(s.paper, s.orientation, t),
                    scale: formatScale(c.printScale),
                    length: formatKm(courseLength(doc, c)),
                  })}
                </span>
              </label>
              {isShown ? (
                <span className="text-xs text-[#0b62a4]">{t('print.shown')}</span>
              ) : (
                <Button size="sm" aria-label={t('print.showCourse', { name: c.name })} onClick={() => onShow(c.id)}>
                  {t('print.show')}
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 border-t border-line px-3 py-3">
        <legend className="float-left mb-1 text-[13px] font-semibold">{t('print.files')}</legend>
        {[false, true].map(value => (
          <label key={String(value)} className="clear-both flex items-center gap-2 text-[13px]">
            <input
              type="radio"
              name="print-files"
              className="accent-brand-600"
              checked={separate === value}
              disabled={courseIds.length < 2}
              onChange={() => setSeparate(value)}
            />
            {value ? t('print.zip') : t('print.onePdf')}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-2 px-3 pb-3">
        <Button
          variant="primary"
          size="lg"
          disabled={courseIds.length === 0 || !saved || request.isPending}
          onClick={() => request.mutate({ courseIds, separate: separate && courseIds.length > 1 })}
        >
          {t('print.make', { count: courseIds.length })}
        </Button>
        {courseIds.length === 0 ? (
          <span className="text-xs text-muted">{t('print.chooseCourse')}</span>
        ) : saveStatus === 'unsaved' || saveStatus === 'saving' ? (
          <span className="text-xs text-muted">{t('print.waitForSave')}</span>
        ) : !saved ? (
          <span className="text-xs text-danger">{t('print.saveFirst')}</span>
        ) : null}
        {request.isError && <ErrorMessage>{t('common.error')}</ErrorMessage>}
      </div>
      <section aria-label={t('print.recent')} className="mt-auto flex flex-col gap-2 border-t border-line px-3 py-2.5">
        <h3 className="m-0 text-xs font-normal text-muted">{t('print.recent')}</h3>
        {exports.isError && <ErrorMessage>{t('common.error')}</ErrorMessage>}
        {exports.data?.length === 0 && <span className="text-[13px] text-muted">{t('print.none')}</span>}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {exports.data?.map(x => (
            <li key={x.id} data-testid="export" className="flex items-center gap-2 text-[13px]">
              {isPending(x) ? (
                <>
                  <span
                    aria-hidden="true"
                    className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-line border-t-brand-600"
                  />
                  <span className="grow">{t('print.making', { courses: names(x.courseIds) })}</span>
                </>
              ) : x.status === 'ready' ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2e7d32" strokeWidth="2.4" aria-hidden="true">
                    <path d="M5 12l5 5 9-10" />
                  </svg>
                  <span className="flex grow flex-col">
                    <span className="break-all">{x.fileName}</span>
                    <span className="text-xs text-muted">{timeFormat.format(new Date(x.finishedAt ?? x.createdAt))}</span>
                  </span>
                  <Button size="sm" aria-label={t('print.downloadLabel', { name: x.fileName })} onClick={() => void download(x)}>
                    {t('print.download')}
                  </Button>
                </>
              ) : (
                <span className="flex grow flex-col">
                  <span className="text-danger">{t('print.failed', { courses: names(x.courseIds) })}</span>
                  {x.error && <span className="text-xs text-muted">{x.error}</span>}
                </span>
              )}
            </li>
          ))}
        </ul>
        {downloadError && <ErrorMessage>{t('print.downloadFailed')}</ErrorMessage>}
      </section>
    </aside>
  )
}

import {
  BOUNDARY_STYLES,
  type BoundaryStyle,
  type Control,
  type Course,
  CourseError,
  courseLength,
  courseStops,
  coursesUsing,
  deleteControl,
  deleteCourse,
  deleteSpecial,
  type EventDoc,
  legLengths,
  moveCourseControl,
  removeCourseControl,
  routeLength,
  setControlCode,
  setSpecialBoundary,
  setSpecialCourses,
  updateCourse,
} from '@course-setter/core'
import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, fieldClass } from '../components/ui.tsx'
import { DescriptionsTab } from './DescriptionsTab.tsx'
import { ALL_CONTROLS, type EditorState } from './state.ts'

type Tab = 'controls' | 'descriptions' | 'settings'

export const formatKm = (metres: number) => (metres / 1000).toFixed(1)

type Props = {
  state: EditorState
  /** The event's name, the title of the description sheets. */
  eventName: string
  onCourse: (courseId: string) => void
  onSelect: (controlId: string | null) => void
  onEdit: (doc: EventDoc, select?: string | null) => void
  onNewCourse: (name: string) => void
}

export function CoursePanel({ state, eventName, onCourse, onSelect, onEdit, onNewCourse }: Props) {
  const { t } = useTranslation()
  const doc = state.history.present
  const course = state.courseId === ALL_CONTROLS ? null : (doc.courses.find(c => c.id === state.courseId) ?? null)
  const [tab, setTab] = useState<Tab>('controls')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  const addCourse = (e: FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return
    onNewCourse(newName)
    setNewName('')
    setAdding(false)
  }

  const tabClass = (name: Tab) =>
    `px-2 py-2 text-[13px] ${tab === name ? 'font-semibold text-ink shadow-[inset_0_-2px_0_var(--color-brand-600)]' : 'text-body hover:text-ink'}`

  return (
    <aside
      aria-label={t('editor.course')}
      className="flex min-h-0 flex-[1_1_320px] flex-col overflow-auto border-l border-line bg-white md:max-w-[340px]"
    >
      <div className="flex flex-col gap-2 border-b border-line px-3 py-2.5">
        <label htmlFor="editor-course" className="text-xs text-muted">
          {t('editor.course')}
        </label>
        <span className="flex gap-1.5">
          <select id="editor-course" className={`${fieldClass} grow`} value={state.courseId} onChange={e => onCourse(e.target.value)}>
            <option value={ALL_CONTROLS}>{t('editor.allControls', { count: doc.controls.length })}</option>
            {doc.courses.map(c => (
              <option key={c.id} value={c.id}>
                {t('editor.courseOption', { name: c.name, length: t('editor.km', { km: formatKm(courseLength(doc, c)) }) })}
              </option>
            ))}
          </select>
          <Button aria-label={t('editor.newCourse')} aria-expanded={adding} onClick={() => setAdding(a => !a)}>
            +
          </Button>
        </span>
        {adding && (
          <form onSubmit={addCourse} className="flex gap-1.5">
            <label htmlFor="new-course" className="sr-only">
              {t('editor.newCourseName')}
            </label>
            <input
              id="new-course"
              className={`${fieldClass} grow`}
              placeholder={t('editor.newCourseName')}
              maxLength={60}
              value={newName}
              onChange={e => setNewName(e.target.value)}
            />
            <Button type="submit" variant="primary" disabled={!newName.trim()}>
              {t('editor.addCourse')}
            </Button>
          </form>
        )}
        {course && (
          <span className="grid grid-cols-2 gap-1.5">
            <span className="flex flex-col rounded bg-subtle px-2 py-1.5">
              <span className="text-xs text-muted">{t('editor.length')}</span>
              <span data-testid="course-length" className="text-base font-bold">
                {t('editor.km', { km: formatKm(courseLength(doc, course)) })}
              </span>
            </span>
            <span className="flex flex-col rounded bg-subtle px-2 py-1.5">
              <span className="text-xs text-muted">{t('editor.controls')}</span>
              <span className="text-base font-bold">{courseStops(doc, course).filter(s => s.kind === 'control').length}</span>
            </span>
          </span>
        )}
      </div>

      {course && (
        <nav aria-label={t('editor.tabs.label')} className="flex gap-0.5 border-b border-line px-2">
          {(['controls', 'descriptions', 'settings'] as const).map(name => (
            <button key={name} type="button" aria-pressed={tab === name} className={tabClass(name)} onClick={() => setTab(name)}>
              {t(`editor.tabs.${name}`)}
            </button>
          ))}
        </nav>
      )}

      {!course ? (
        <PoolList doc={doc} selected={state.selected} onSelect={onSelect} />
      ) : tab === 'controls' ? (
        <StopList doc={doc} course={course} selected={state.selected} onSelect={onSelect} onEdit={onEdit} />
      ) : tab === 'descriptions' ? (
        <DescriptionsTab doc={doc} course={course} title={eventName} selected={state.selected} onSelect={onSelect} onEdit={onEdit} />
      ) : (
        <CourseSettings doc={doc} course={course} onEdit={onEdit} onDeleted={() => onCourse(ALL_CONTROLS)} />
      )}

      <SelectedControl key={state.selected ?? 'none'} doc={doc} course={course} selected={state.selected} onEdit={onEdit} />
      <SelectedSpecial doc={doc} selected={state.selected} onEdit={onEdit} />
    </aside>
  )
}

export function stopName(control: Control, t: ReturnType<typeof useTranslation>['t']): string {
  return control.kind === 'control' ? t('editor.stop.control', { code: control.code }) : t(`editor.stop.${control.kind}`)
}

function StopList({
  doc,
  course,
  selected,
  onSelect,
  onEdit,
}: {
  doc: EventDoc
  course: Course
  selected: string | null
  onSelect: (id: string) => void
  onEdit: (doc: EventDoc) => void
}) {
  const { t } = useTranslation()
  const stops = courseStops(doc, course)
  const legs = legLengths(doc, course)
  // A control can be visited more than once (butterflies): number its visits for stable keys.
  const seen = new Map<string, number>()
  const visit = stops.map(s => {
    const n = (seen.get(s.controlId) ?? 0) + 1
    seen.set(s.controlId, n)
    return n
  })
  if (stops.length === 0) return <p className="m-0 px-3 py-3 text-[13px] text-muted">{t('editor.emptyCourse')}</p>
  return (
    <ol className="m-0 list-none p-0 py-1 text-[13px]" aria-label={course.name}>
      {stops.map((stop, i) => {
        const control = doc.controls.find(c => c.id === stop.controlId) as Control
        const name = stopName(control, t)
        const isSelected = selected === stop.controlId
        const taped = control.route ? Math.round(routeLength(doc, control.id)) : null
        return (
          <li
            key={`${stop.controlId}-${visit[i]}`}
            className={`group flex items-center gap-1.5 px-3 py-1 ${i > 0 ? 'border-t border-line-soft' : ''} ${isSelected ? 'bg-[#eaf2f9]' : ''}`}
          >
            <button type="button" onClick={() => onSelect(stop.controlId)} className="flex grow items-center gap-2 py-0.5 text-left">
              <span className={`w-7 ${stop.number ? 'font-semibold' : 'text-muted'}`}>{stop.number ?? ''}</span>
              <span className={`grow ${isSelected ? 'font-semibold' : ''}`}>
                {name}
                {taped !== null && (
                  <span className="ml-1.5 text-xs font-normal text-muted">{t('editor.routeLength', { metres: taped })}</span>
                )}
              </span>
              {i > 0 && <span className="text-muted">{Math.round(legs[i - 1] ?? 0)} m</span>}
            </button>
            <span className="flex opacity-60 group-hover:opacity-100">
              <IconButton
                label={t('editor.moveUp', { name })}
                disabled={i === 0}
                onClick={() => onEdit(moveCourseControl(doc, course.id, i, i - 1))}
              >
                ↑
              </IconButton>
              <IconButton
                label={t('editor.moveDown', { name })}
                disabled={i === stops.length - 1}
                onClick={() => onEdit(moveCourseControl(doc, course.id, i, i + 1))}
              >
                ↓
              </IconButton>
              <IconButton label={t('editor.removeStop', { name })} onClick={() => onEdit(removeCourseControl(doc, course.id, i))}>
                ×
              </IconButton>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded text-body hover:bg-subtle disabled:opacity-30"
    >
      <span aria-hidden="true">{children}</span>
    </button>
  )
}

function PoolList({ doc, selected, onSelect }: { doc: EventDoc; selected: string | null; onSelect: (id: string) => void }) {
  const { t } = useTranslation()
  if (doc.controls.length === 0) return <p className="m-0 px-3 py-3 text-[13px] text-muted">{t('editor.emptyPool')}</p>
  const order = { mapIssue: 0, start: 1, control: 2, crossingPoint: 3, markedRoute: 4, finish: 5 } as const
  const sorted = [...doc.controls].sort((a, b) => order[a.kind] - order[b.kind] || (a.code ?? 0) - (b.code ?? 0))
  return (
    <ul className="m-0 list-none p-0 py-1 text-[13px]">
      {sorted.map((control, i) => (
        <li key={control.id} className={`${i > 0 ? 'border-t border-line-soft' : ''} ${selected === control.id ? 'bg-[#eaf2f9]' : ''}`}>
          <button type="button" onClick={() => onSelect(control.id)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left">
            <span className="grow">{stopName(control, t)}</span>
            <span className="text-xs text-muted">
              {coursesUsing(doc, control.id)
                .map(c => c.name)
                .join(', ')}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function CourseSettings({
  doc,
  course,
  onEdit,
  onDeleted,
}: {
  doc: EventDoc
  course: Course
  onEdit: (doc: EventDoc) => void
  onDeleted: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(course.name)
  useEffect(() => setName(course.name), [course.name])
  const [climb, setClimb] = useState(course.climb == null ? '' : String(course.climb))
  useEffect(() => setClimb(course.climb == null ? '' : String(course.climb)), [course.climb])
  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      <label htmlFor="course-name" className="text-[13px] font-semibold">
        {t('editor.settings.name')}
      </label>
      <input
        id="course-name"
        className={fieldClass}
        value={name}
        maxLength={60}
        onChange={e => setName(e.target.value)}
        onBlur={() => name.trim() && name.trim() !== course.name && onEdit(updateCourse(doc, course.id, { name }))}
      />
      <label htmlFor="course-climb" className="text-[13px] font-semibold">
        {t('editor.settings.climb')}
      </label>
      <input
        id="course-climb"
        className={`${fieldClass} w-24`}
        inputMode="numeric"
        value={climb}
        onChange={e => setClimb(e.target.value.replace(/\D/g, '').slice(0, 4))}
        onBlur={() => {
          const value = climb === '' ? null : Number(climb)
          if (value !== (course.climb ?? null)) onEdit(updateCourse(doc, course.id, { climb: value }))
        }}
        aria-describedby="course-climb-help"
      />
      <span id="course-climb-help" className="text-xs text-muted">
        {t('editor.settings.climbHelp')}
      </span>
      <Button
        variant="danger"
        className="mt-2 self-start"
        onClick={() => {
          if (!window.confirm(t('editor.settings.deleteConfirm', { course: course.name }))) return
          onEdit(deleteCourse(doc, course.id))
          onDeleted()
        }}
      >
        {t('editor.settings.delete')}
      </Button>
    </div>
  )
}

/** Properties of the selected special symbol: which courses show it, an out-of-bounds area's edge, delete. */
function SelectedSpecial({
  doc,
  selected,
  onEdit,
}: {
  doc: EventDoc
  selected: string | null
  onEdit: (doc: EventDoc, select?: string | null) => void
}) {
  const { t } = useTranslation()
  const special = doc.specials.find(s => s.id === selected)
  if (!special) return null
  const name = t(`editor.tools.${special.kind}`)
  const chosen = special.courses ?? null
  const toggle = (courseId: string, on: boolean) => {
    const next = on ? [...(chosen ?? []), courseId] : (chosen ?? []).filter(c => c !== courseId)
    onEdit(setSpecialCourses(doc, special.id, next))
  }
  return (
    <div className="mt-auto flex flex-col gap-2 border-t border-line px-3 py-2.5 text-[13px]">
      <span className="font-semibold">{t('editor.selected', { name })}</span>
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className="mb-1 p-0 text-xs text-muted">{t('editor.special.shownOn')}</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="special-courses"
            checked={chosen === null}
            onChange={() => onEdit(setSpecialCourses(doc, special.id, null))}
          />
          {t('editor.special.allCourses')}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="special-courses"
            checked={chosen !== null}
            onChange={() =>
              onEdit(
                setSpecialCourses(
                  doc,
                  special.id,
                  doc.courses.map(c => c.id),
                ),
              )
            }
          />
          {t('editor.special.chosenCourses')}
        </label>
        {chosen !== null && (
          <span className="ml-6 flex flex-col gap-1">
            {doc.courses.map(c => (
              <label key={c.id} className="flex items-center gap-2">
                <input type="checkbox" checked={chosen.includes(c.id)} onChange={e => toggle(c.id, e.target.checked)} />
                {c.name}
              </label>
            ))}
            {doc.courses.length === 0 && <span className="text-xs text-muted">{t('editor.special.noCourses')}</span>}
          </span>
        )}
      </fieldset>
      {special.kind === 'oobArea' && (
        <span className="flex items-center gap-2">
          <label htmlFor="special-boundary" className="text-xs text-muted">
            {t('editor.special.boundary')}
          </label>
          <select
            id="special-boundary"
            className={`${fieldClass} h-7 grow`}
            value={special.boundary ?? 'solid'}
            onChange={e => onEdit(setSpecialBoundary(doc, special.id, e.target.value as BoundaryStyle))}
          >
            {BOUNDARY_STYLES.map(style => (
              <option key={style} value={style}>
                {t(`editor.special.boundaryStyle.${style}`)}
              </option>
            ))}
          </select>
        </span>
      )}
      <span>
        <Button size="sm" variant="danger" onClick={() => onEdit(deleteSpecial(doc, special.id), null)}>
          {t('editor.special.delete', { name: name.toLowerCase() })}
        </Button>
      </span>
    </div>
  )
}

function SelectedControl({
  doc,
  course,
  selected,
  onEdit,
}: {
  doc: EventDoc
  course: Course | null
  selected: string | null
  onEdit: (doc: EventDoc, select?: string | null) => void
}) {
  const { t } = useTranslation()
  const control = selected ? doc.controls.find(c => c.id === selected) : undefined
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setCode(control?.code ? String(control.code) : '')
    setError(null)
  }, [control?.code])
  if (!control) return null
  const name = stopName(control, t)
  const courses = coursesUsing(doc, control.id).map(c => c.name)

  const saveCode = () => {
    const value = Number(code)
    if (!control.code || value === control.code) return
    try {
      onEdit(setControlCode(doc, control.id, value))
    } catch (err) {
      setError(err instanceof CourseError && err.code === 'code_in_use' ? t('editor.codeInUse', { code: value }) : null)
      setCode(String(control.code))
    }
  }
  const index = course ? course.controls.lastIndexOf(control.id) : -1

  return (
    <div className="mt-auto flex flex-col gap-2 border-t border-line px-3 py-2.5">
      <span className="text-[13px] font-semibold">{t('editor.selected', { name })}</span>
      {control.kind === 'control' && (
        <span className="flex items-center gap-1.5">
          <label htmlFor="control-code" className="text-xs text-muted">
            {t('editor.code')}
          </label>
          <input
            id="control-code"
            inputMode="numeric"
            className={`${fieldClass} h-7 w-16`}
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
            onBlur={saveCode}
            onKeyDown={e => e.key === 'Enter' && saveCode()}
          />
          <span className="text-xs text-muted">{t('editor.usedIn', { count: courses.length, courses: courses.join(', ') })}</span>
        </span>
      )}
      {control.kind !== 'control' && (
        <span className="text-xs text-muted">{t('editor.usedIn', { count: courses.length, courses: courses.join(', ') })}</span>
      )}
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
      <span className="flex flex-wrap gap-1.5">
        {course && index >= 0 && (
          <Button size="sm" onClick={() => onEdit(removeCourseControl(doc, course.id, index))}>
            {t('editor.removeFromCourse', { course: course.name })}
          </Button>
        )}
        <Button
          size="sm"
          variant="danger"
          onClick={() => window.confirm(t('editor.deleteControlConfirm', { name })) && onEdit(deleteControl(doc, control.id), null)}
        >
          {t('editor.deleteControl')}
        </Button>
      </span>
    </div>
  )
}

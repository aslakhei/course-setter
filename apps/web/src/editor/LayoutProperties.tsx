// Layout mode's right panel: the selected element's properties. Changes go to every course (the shared
// layout) or, for position, size and visibility, to the shown course only; a course can also get a
// layout of its own. Text and number fields save when they lose focus or on Enter, so typing makes one
// step of undo, not one per key.
import {
  ALIGNMENTS,
  ANCHORS,
  alignBoxes,
  type Bounds,
  type Course,
  detachLayout,
  duplicateLayoutElement,
  type EventDoc,
  FIELDS,
  MAX_MAP_BANDS,
  mapNodes,
  NORTH_ARROW_STYLES,
  type PageElementSpec,
  type PlacedElement,
  type Point,
  type PrintSettings,
  reattachLayout,
  removeLayoutElement,
  SHAPES,
  setMapAreaBands,
  setMapAreaRadius,
  setMapAreaStroke,
  specForBox,
  updateLayoutElement,
  updateWhiteArea,
  type WhiteArea,
} from '@course-setter/core'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, fieldClass } from '../components/ui.tsx'
import { shownPath, useAssetRows, useSignedUrls } from '../lib/assets.ts'
import { type ChosenImage, ImagePicker } from './ImagePicker.tsx'
import { MAP_LAYER } from './LayoutPanel.tsx'
import {
  type AppliesTo,
  areaCoordinates,
  baseElement,
  FONT_FAMILIES,
  type FontFamily,
  familyOf,
  fontFor,
  isBold,
  type Pen,
  pinnedText,
  placeElement,
  placeMany,
  removeArea,
  removeMany,
  SWATCHES,
  shownElement,
  whiteAreaOf,
} from './layout.ts'
import { Segmented } from './PrintView.tsx'

export type LayoutPropertiesProps = {
  doc: EventDoc
  course: Course
  settings: PrintSettings
  /** Page width and height, mm. */
  size: Point
  /** The elements as placed on the shown page (their boxes). */
  placed: PlacedElement[]
  appliesTo: AppliesTo
  onAppliesTo: (to: AppliesTo) => void
  /** The selected elements' ids (or the map). */
  selected: string[]
  onSelect: (id: string | null, additive?: boolean) => void
  onEdit: (doc: EventDoc) => void
  clubId: string
  eventId: string
  /** The white area being drawn, or null. */
  pen: Pen | null
  onPen: (pen: Pen | null) => void
  onPenDone: () => void
}

/** A text field or area that keeps what is typed and saves it on blur or Enter (Ctrl+Enter in an area). */
function CommitText({
  id,
  value,
  onCommit,
  multiline,
  maxLength,
  valid = () => true,
  inputRef,
}: {
  id: string
  value: string
  onCommit: (value: string) => void
  multiline?: boolean
  maxLength?: number
  valid?: (value: string) => boolean
  inputRef?: React.RefObject<HTMLTextAreaElement | null>
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    if (draft !== value && valid(draft)) onCommit(draft)
    else if (!valid(draft)) setDraft(value)
  }
  const common = { id, value: draft, maxLength, className: `${fieldClass} w-full`, onBlur: commit }
  return multiline ? (
    <textarea
      {...common}
      ref={inputRef}
      rows={3}
      className={`${fieldClass} h-auto w-full py-1.5`}
      onChange={e => setDraft(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit()
      }}
    />
  ) : (
    <input {...common} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && commit()} />
  )
}

/** A number field (saved on blur or Enter, kept within min and max). */
function CommitNumber({
  id,
  value,
  min,
  max,
  step = 1,
  onCommit,
  disabled,
}: {
  id: string
  value: number
  min: number
  max: number
  step?: number
  onCommit: (v: number) => void
  disabled?: boolean
}) {
  const shown = String(Math.round(value * 100) / 100)
  const [draft, setDraft] = useState(shown)
  useEffect(() => setDraft(shown), [shown])
  const commit = () => {
    const n = Number(draft.replace(',', '.'))
    if (!Number.isFinite(n) || draft.trim() === '') return setDraft(shown)
    const clamped = Math.min(max, Math.max(min, n))
    if (clamped !== value) onCommit(clamped)
    setDraft(String(clamped))
  }
  return (
    <input
      id={id}
      inputMode="decimal"
      step={step}
      disabled={disabled}
      className={`${fieldClass} w-16`}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => e.key === 'Enter' && commit()}
    />
  )
}

function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (color: string) => void }) {
  const { t } = useTranslation()
  return (
    <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
      <legend className="mb-1 p-0 text-xs font-semibold text-body">{label}</legend>
      <div className="flex flex-wrap items-center gap-1">
        {SWATCHES.map(c => (
          <button
            key={c}
            type="button"
            aria-label={t('layout.colorValue', { value: c })}
            aria-pressed={value.toLowerCase() === c}
            onClick={() => onChange(c)}
            className={`size-6 rounded border ${value.toLowerCase() === c ? 'outline-2 outline-offset-1 outline-brand-600' : ''} border-field`}
            style={{ background: c }}
          />
        ))}
        <label htmlFor={id} className="sr-only">
          {t('layout.otherColor')}
        </label>
        <input
          id={id}
          type="color"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="h-6 w-8 cursor-pointer border-0 bg-transparent p-0"
        />
        <span className="font-mono text-xs text-muted">{value.toUpperCase()}</span>
      </div>
    </fieldset>
  )
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs font-semibold text-body">
        {label}
      </label>
      {children}
    </div>
  )
}

function Check({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string
  checked: boolean
  onChange: (on: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className={`flex items-center gap-2 text-[13px] ${disabled ? 'text-muted' : ''}`}>
      <input
        type="checkbox"
        className="size-4 accent-brand-600"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
      />
      {label}
    </label>
  )
}

export function LayoutProperties(props: LayoutPropertiesProps) {
  const { doc, course, settings, size, placed, appliesTo, selected, onEdit } = props
  const { t } = useTranslation()
  const textRef = useRef<HTMLTextAreaElement>(null)
  const shared = !settings.ownLayout
  const courseOnly = shared && appliesTo === 'course'

  const frame = (children: ReactNode) => (
    <aside
      aria-label={t('layout.properties')}
      className="flex min-h-0 w-72 shrink-0 flex-col gap-3 overflow-auto border-l border-line bg-white px-3 py-3"
    >
      {children}
    </aside>
  )
  const scope = shared ? null : (
    <div className="flex flex-col items-start gap-1.5 rounded bg-subtle px-2.5 py-2 text-xs">
      <span>{t('layout.own', { course: course.name })}</span>
      <Button
        size="sm"
        onClick={() =>
          window.confirm(t('layout.useSharedConfirm', { course: course.name })) && onEdit(reattachLayout(doc, course.id, settings))
        }
      >
        {t('layout.useShared')}
      </Button>
    </div>
  )

  const [picking, setPicking] = useState(false)
  const single = selected.length === 1 ? (selected[0] ?? null) : null
  const singleSpec = single && single !== MAP_LAYER ? shownElement(doc, settings, single) : undefined
  const imageRows = useAssetRows(singleSpec?.kind === 'image' ? [singleSpec.asset] : [])
  const imageRow = imageRows.data?.[0]
  const thumbPath = imageRow ? shownPath(imageRow) : null
  const thumbUrls = useSignedUrls(thumbPath && imageRow?.status === 'ready' ? [thumbPath] : [])
  const appliesBlock = shared ? (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-body">{t('layout.appliesTo')}</span>
      <Segmented
        name="layout-applies"
        label={t('layout.appliesTo')}
        options={['all', 'course'] as const}
        value={appliesTo}
        text={o => (o === 'all' ? t('layout.allCourses') : t('layout.onlyCourse', { course: course.name }))}
        onChange={props.onAppliesTo}
      />
      <span className="text-xs text-muted">{courseOnly ? t('layout.appliesHelpCourse') : t('layout.appliesHelpAll')}</span>
      {courseOnly && (
        <Button size="sm" className="self-start" onClick={() => onEdit(detachLayout(doc, course.id, settings))}>
          {t('layout.detach', { course: course.name })}
        </Button>
      )}
    </div>
  ) : (
    scope
  )

  // Drawing a white area with the pen.
  const pen = props.pen
  if (pen) {
    const convertPen = (on: WhiteArea['on']) => {
      const c = areaCoordinates(course, settings)
      props.onPen({ on, nodes: mapNodes(pen.nodes, p => c.toArea(on, c.fromArea(pen.on, p))) })
    }
    return frame(
      <>
        <h2 className="m-0 text-[15px] font-semibold">{t('layout.pen.heading')}</h2>
        <p className="m-0 text-[13px]">{t('layout.pen.help')}</p>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-body">{t('layout.on.label')}</span>
          <Segmented
            name="layout-pen-on"
            label={t('layout.on.label')}
            options={['map', 'page'] as const}
            value={pen.on}
            text={o => t(`layout.on.${o}`)}
            onChange={convertPen}
          />
          <span className="text-xs text-muted">{t(`layout.on.help.${pen.on}`)}</span>
        </div>
        <span className="text-xs text-muted">{t('layout.pen.points', { count: pen.nodes.length })}</span>
        <div className="flex gap-1.5">
          <Button size="sm" variant="primary" disabled={pen.nodes.length < 3} onClick={props.onPenDone}>
            {t('layout.pen.finish')}
          </Button>
          <Button size="sm" onClick={() => props.onPen(null)}>
            {t('layout.pen.cancel')}
          </Button>
        </div>
      </>,
    )
  }

  // A white area: on the map or the page, lock, delete; its points are edited on the page.
  const area = single ? whiteAreaOf(doc, settings, single) : undefined
  if (area) {
    const changeArea = (change: (a: WhiteArea) => WhiteArea) => onEdit(updateWhiteArea(doc, course.id, settings, area.id, change))
    const convert = (on: WhiteArea['on']) => {
      if (on === area.on) return
      const c = areaCoordinates(course, settings)
      changeArea(a => ({ ...a, on, nodes: mapNodes(a.nodes, p => c.toArea(on, c.fromArea(a.on, p))) }))
    }
    return frame(
      <>
        <div className="flex items-center gap-2">
          <h2 className="m-0 grow text-[15px] font-semibold">{t('layout.whiteArea')}</h2>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              onEdit(removeArea(doc, course, settings, appliesTo, area.id))
              if (!courseOnly) props.onSelect(null)
            }}
          >
            {t('layout.delete')}
          </Button>
        </div>
        {appliesBlock}
        <fieldset disabled={courseOnly} className="m-0 flex flex-col gap-1.5 border-0 p-0 disabled:opacity-60">
          <span className="text-xs font-semibold text-body">{t('layout.on.label')}</span>
          <Segmented
            name="layout-area-on"
            label={t('layout.on.label')}
            options={['map', 'page'] as const}
            value={area.on}
            text={o => t(`layout.on.${o}`)}
            onChange={convert}
          />
          <span className="text-xs text-muted">{t(`layout.on.help.${area.on}`)}</span>
        </fieldset>
        <span className="text-xs text-muted">{t('layout.pen.points', { count: area.nodes.length })}</span>
        <p className="m-0 text-xs text-body">{t('layout.pen.editHelp')}</p>
        <Check
          label={t('layout.locked')}
          checked={area.locked === true}
          disabled={courseOnly}
          onChange={on =>
            changeArea(a => {
              const { locked: _old, ...rest } = a
              return on ? { ...rest, locked: true } : rest
            })
          }
        />
      </>,
    )
  }

  if (single === MAP_LAYER) {
    const mapArea = (settings.ownLayout ?? doc.printLayout)?.mapArea
    const radius = mapArea?.radius ?? 0
    const stroke = mapArea?.stroke
    const bands = mapArea?.bands ?? []
    const setBands = (next: { color: string; width: number }[]) => onEdit(setMapAreaBands(doc, course.id, settings, next))
    return frame(
      <>
        <h2 className="m-0 text-[15px] font-semibold">{t('layout.map')}</h2>
        {scope}
        <span className="text-xs text-muted">{t('layout.mapHelp')}</span>
        <Field label={t('layout.mapRadius')} htmlFor="layout-map-radius">
          <span className="flex items-center gap-1.5 text-[13px]">
            <CommitNumber
              id="layout-map-radius"
              value={radius}
              min={0}
              max={30}
              onCommit={v => onEdit(setMapAreaRadius(doc, course.id, settings, v))}
            />
            {t('layout.mm', { value: '' }).trim()}
          </span>
        </Field>
        <Check
          label={t('layout.mapOutline')}
          checked={Boolean(stroke)}
          onChange={on => onEdit(setMapAreaStroke(doc, course.id, settings, on ? { color: '#000000', width: 0.8 } : null))}
        />
        {stroke && (
          <>
            <ColorField
              id="layout-map-stroke"
              label={t('layout.outline')}
              value={stroke.color}
              onChange={color => onEdit(setMapAreaStroke(doc, course.id, settings, { ...stroke, color }))}
            />
            <Field label={t('layout.lineWidth')} htmlFor="layout-map-stroke-width">
              <CommitNumber
                id="layout-map-stroke-width"
                value={stroke.width}
                min={0.1}
                max={5}
                step={0.1}
                onCommit={width => onEdit(setMapAreaStroke(doc, course.id, settings, { ...stroke, width }))}
              />
            </Field>
          </>
        )}
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 p-0 text-[13px] font-semibold">{t('layout.mapBands')}</legend>
          <span className="text-xs text-muted">{t('layout.mapBandsHelp')}</span>
          {bands.map((band, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: bands have no ids; their place is what they are
            <div key={i} className="flex flex-wrap items-end gap-2 border-l-2 border-line-soft pl-2">
              <ColorField
                id={`layout-map-band-${i}`}
                label={t('layout.mapBand', { number: i + 1 })}
                value={band.color}
                onChange={color => setBands(bands.map((b, j) => (j === i ? { ...b, color } : b)))}
              />
              <Field label={t('layout.lineWidth')} htmlFor={`layout-map-band-width-${i}`}>
                <CommitNumber
                  id={`layout-map-band-width-${i}`}
                  value={band.width}
                  min={0.2}
                  max={10}
                  step={0.1}
                  onCommit={width => setBands(bands.map((b, j) => (j === i ? { ...b, width } : b)))}
                />
              </Field>
              <Button size="sm" onClick={() => setBands(bands.filter((_, j) => j !== i))}>
                {t('layout.mapBandRemove')}
              </Button>
            </div>
          ))}
          {bands.length < MAX_MAP_BANDS && (
            <Button size="sm" className="self-start" onClick={() => setBands([...bands, { color: '#000000', width: 1.5 }])}>
              {t('layout.mapBandAdd')}
            </Button>
          )}
        </fieldset>
      </>,
    )
  }

  // Several selected: line them up, or delete them together.
  const many = selected
    .filter(id => id !== MAP_LAYER)
    .flatMap(id => {
      const spec = shownElement(doc, settings, id)
      const box = placed.find(p => p.id === id)?.box
      return spec && box ? [{ spec, box }] : []
    })
  if (many.length > 1) {
    const align = (how: (typeof ALIGNMENTS)[number]) => {
      const boxes = alignBoxes(
        many.map(m => m.box),
        how,
      )
      const specs = many.filter(m => !m.spec.locked).map(m => specForBox(m.spec, boxes[many.indexOf(m)] ?? m.box, size))
      onEdit(placeMany(doc, course, settings, appliesTo, specs))
    }
    return frame(
      <>
        <div className="flex items-center gap-2">
          <h2 className="m-0 grow text-[15px] font-semibold">{t('layout.selectedCount', { count: many.length })}</h2>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              onEdit(
                removeMany(
                  doc,
                  course,
                  settings,
                  appliesTo,
                  many.map(m => m.spec.id),
                ),
              )
              if (!courseOnly) props.onSelect(null)
            }}
          >
            {t('layout.deleteAll')}
          </Button>
        </div>
        {appliesBlock}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-body">{t('layout.alignTitle')}</span>
          <div className="grid grid-cols-3 gap-1.5">
            {ALIGNMENTS.map(how => (
              <Button key={how} size="sm" onClick={() => align(how)}>
                {t(`layout.alignTo.${how}`)}
              </Button>
            ))}
          </div>
        </div>
        <span className="text-xs text-muted">{t('layout.multiHelp')}</span>
      </>,
    )
  }

  const spec = singleSpec
  const base = single ? baseElement(doc, settings, single) : undefined
  if (!spec || !base) return frame(<p className="m-0 text-[13px] text-muted">{t('layout.nothing')}</p>)
  const box: Bounds | undefined = placed.find(p => p.id === spec.id)?.box

  /** Change the element's own settings (every course, or the course's own layout). */
  const update = (change: (e: PageElementSpec) => PageElementSpec) => onEdit(updateLayoutElement(doc, course.id, settings, spec.id, change))
  /** Change the element's position or size (for every course or only this one). */
  const place = (next: PageElementSpec) => onEdit(placeElement(doc, course, settings, appliesTo, next))
  const insertField = (field: string) => {
    if (spec.kind !== 'text') return
    // Into what is in the box now (typed but not saved yet too), at the cursor.
    const area = textRef.current
    const current = area?.value ?? spec.text
    const at = area ? area.selectionStart : current.length
    const end = area ? area.selectionEnd : at
    const text = `${current.slice(0, at)}{${field}}${current.slice(end)}`.slice(0, 2000)
    update(e => ({ ...e, text }) as PageElementSpec)
  }

  return frame(
    <>
      <div className="flex items-center gap-2">
        <h2 className="m-0 grow text-[15px] font-semibold">{t(`layout.kinds.${spec.kind}`)}</h2>
        <Button
          size="sm"
          disabled={courseOnly}
          onClick={() => {
            const id = crypto.randomUUID()
            onEdit(duplicateLayoutElement(doc, course.id, settings, spec.id, id))
            props.onSelect(id)
          }}
        >
          {t('layout.duplicate')}
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={courseOnly}
          onClick={() => {
            onEdit(removeLayoutElement(doc, course.id, settings, spec.id))
            props.onSelect(null)
          }}
        >
          {t('layout.delete')}
        </Button>
      </div>

      {appliesBlock}

      <fieldset disabled={courseOnly} className="m-0 flex flex-col gap-3 border-0 p-0 disabled:opacity-60">
        {spec.kind === 'text' && (
          <>
            <Field label={t('layout.text')} htmlFor="layout-text">
              <CommitText
                id="layout-text"
                multiline
                maxLength={2000}
                value={spec.text}
                inputRef={textRef}
                onCommit={text => update(e => ({ ...e, text }) as PageElementSpec)}
              />
            </Field>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted">{t('layout.insertField')}</span>
              <div className="flex flex-wrap gap-1">
                {FIELDS.map(f => (
                  <button
                    key={f}
                    type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => insertField(f)}
                    className="rounded border border-field bg-white px-1.5 py-0.5 text-xs hover:bg-subtle"
                  >
                    {t(`layout.fields.${f}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-end gap-2">
              <Field label={t('layout.font')} htmlFor="layout-font">
                <select
                  id="layout-font"
                  className={fieldClass}
                  value={familyOf(spec.font)}
                  onChange={e => update(x => ({ ...x, font: fontFor(e.target.value as FontFamily, isBold(spec.font)) }) as PageElementSpec)}
                >
                  {FONT_FAMILIES.map(f => (
                    <option key={f.family} value={f.family}>
                      {t(`layout.fonts.${f.family}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('layout.size')} htmlFor="layout-size">
                <span className="flex items-center gap-1 text-[13px]">
                  <CommitNumber
                    id="layout-size"
                    value={spec.sizePt}
                    min={4}
                    max={200}
                    onCommit={sizePt => update(x => ({ ...x, sizePt }) as PageElementSpec)}
                  />
                  {t('layout.pt')}
                </span>
              </Field>
            </div>
            <Check
              label={t('layout.bold')}
              checked={isBold(spec.font)}
              onChange={on => update(x => ({ ...x, font: fontFor(familyOf(spec.font), on) }) as PageElementSpec)}
            />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-body">{t('layout.align')}</span>
              <Segmented
                name="layout-align"
                label={t('layout.align')}
                options={['left', 'center', 'right'] as const}
                value={spec.align ?? 'left'}
                text={o => t(`layout.alignments.${o}`)}
                onChange={align => update(x => ({ ...x, align }) as PageElementSpec)}
              />
            </div>
            <ColorField
              id="layout-color"
              label={t('layout.color')}
              value={spec.color}
              onChange={color => update(x => ({ ...x, color }) as PageElementSpec)}
            />
          </>
        )}

        {spec.kind === 'shape' && (
          <>
            <Field label={t('layout.shape')} htmlFor="layout-shape">
              <select
                id="layout-shape"
                className={fieldClass}
                value={spec.shape}
                onChange={e => update(x => ({ ...x, shape: e.target.value }) as PageElementSpec)}
              >
                {SHAPES.map(s => (
                  <option key={s} value={s}>
                    {t(`layout.shapes.${s}`)}
                  </option>
                ))}
              </select>
            </Field>
            {spec.shape === 'rect' && (
              <Field label={t('layout.radius')} htmlFor="layout-radius">
                <CommitNumber
                  id="layout-radius"
                  value={spec.radius ?? 0}
                  min={0}
                  max={100}
                  onCommit={radius => update(x => ({ ...x, radius }) as PageElementSpec)}
                />
              </Field>
            )}
            <Check
              label={t('layout.outline')}
              checked={Boolean(spec.stroke)}
              onChange={on =>
                update(x => {
                  const { stroke: _old, ...rest } = x as Extract<PageElementSpec, { kind: 'shape' }>
                  return (on ? { ...rest, stroke: { color: '#000000', width: 0.35 } } : rest) as PageElementSpec
                })
              }
            />
            {spec.stroke && (
              <>
                <ColorField
                  id="layout-stroke"
                  label={t('layout.outline')}
                  value={spec.stroke.color}
                  onChange={color =>
                    update(x => ({ ...x, stroke: { ...spec.stroke, width: spec.stroke?.width ?? 0.35, color } }) as PageElementSpec)
                  }
                />
                <Field label={t('layout.lineWidth')} htmlFor="layout-stroke-width">
                  <CommitNumber
                    id="layout-stroke-width"
                    value={spec.stroke.width}
                    min={0.05}
                    max={10}
                    step={0.05}
                    onCommit={width =>
                      update(x => ({ ...x, stroke: { color: spec.stroke?.color ?? '#000000', width } }) as PageElementSpec)
                    }
                  />
                </Field>
              </>
            )}
            <Check
              label={t('layout.fill')}
              checked={Boolean(spec.fill)}
              onChange={on =>
                update(x => {
                  const { fill: _old, ...rest } = x as Extract<PageElementSpec, { kind: 'shape' }>
                  return (on ? { ...rest, fill: { color: '#ffffff', opacity: 1 } } : rest) as PageElementSpec
                })
              }
            />
            {spec.fill && (
              <>
                <ColorField
                  id="layout-fill"
                  label={t('layout.fill')}
                  value={spec.fill.color}
                  onChange={color => update(x => ({ ...x, fill: { opacity: spec.fill?.opacity ?? 1, color } }) as PageElementSpec)}
                />
                <Field label={t('layout.opacity')} htmlFor="layout-opacity">
                  <CommitNumber
                    id="layout-opacity"
                    value={Math.round((spec.fill.opacity ?? 1) * 100)}
                    min={0}
                    max={100}
                    onCommit={v =>
                      update(x => ({ ...x, fill: { color: spec.fill?.color ?? '#ffffff', opacity: v / 100 } }) as PageElementSpec)
                    }
                  />
                </Field>
              </>
            )}
          </>
        )}

        {spec.kind === 'northArrow' && (
          <>
            <Field label={t('layout.style')} htmlFor="layout-arrow-style">
              <select
                id="layout-arrow-style"
                className={fieldClass}
                value={spec.style}
                onChange={e => update(x => ({ ...x, style: e.target.value }) as PageElementSpec)}
              >
                {NORTH_ARROW_STYLES.map(s => (
                  <option key={s} value={s}>
                    {t(`layout.arrowStyles.${s}`)}
                  </option>
                ))}
              </select>
            </Field>
            <ColorField
              id="layout-color"
              label={t('layout.color')}
              value={spec.color}
              onChange={color => update(x => ({ ...x, color }) as PageElementSpec)}
            />
          </>
        )}

        {spec.kind === 'image' && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2.5">
              <span className="flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded border border-line bg-subtle">
                {thumbPath && thumbUrls.data?.get(thumbPath) && (
                  <img src={thumbUrls.data.get(thumbPath)} alt="" className="max-h-full max-w-full object-contain" />
                )}
              </span>
              <span className="min-w-0 truncate text-[13px]">{imageRow?.name ?? t('layout.image')}</span>
            </div>
            {!imageRow && imageRows.data && <span className="text-xs text-muted">{t('layout.imageMissing')}</span>}
            {imageRow && imageRow.status !== 'ready' && <span className="text-xs text-muted">{t('layout.imageWaiting')}</span>}
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" onClick={() => setPicking(true)}>
                {t('layout.replaceImage')}
              </Button>
              <Button
                size="sm"
                disabled={!imageRow?.width || !imageRow?.height}
                onClick={() =>
                  imageRow?.width &&
                  imageRow.height &&
                  place({ ...spec, size: [spec.size[0], Math.round((spec.size[0] * imageRow.height * 100) / imageRow.width) / 100] })
                }
              >
                {t('layout.naturalSize')}
              </Button>
            </div>
          </div>
        )}

        {spec.kind === 'scaleBar' && (
          <ColorField
            id="layout-color"
            label={t('layout.color')}
            value={spec.color}
            onChange={color => update(x => ({ ...x, color }) as PageElementSpec)}
          />
        )}

        {spec.kind === 'qr' && (
          <>
            <Field label={t('layout.address')} htmlFor="layout-qr">
              <CommitText
                id="layout-qr"
                maxLength={500}
                value={spec.url}
                valid={v => /^https?:\/\/[^\s/]+\.[^\s]+$/.test(v.trim())}
                onCommit={url => update(x => ({ ...x, url: url.trim() }) as PageElementSpec)}
              />
            </Field>
            <ColorField
              id="layout-color"
              label={t('layout.color')}
              value={spec.color}
              onChange={color => update(x => ({ ...x, color }) as PageElementSpec)}
            />
          </>
        )}
      </fieldset>

      <div className="flex flex-col gap-2 border-t border-line-soft pt-3">
        <span className="text-xs font-semibold text-body">{t('layout.pinnedTo')}</span>
        <div className="flex items-start gap-3">
          <fieldset className="m-0 shrink-0 rounded border border-field p-1">
            <legend className="sr-only">{t('layout.pinnedTo')}</legend>
            <div className="grid grid-cols-3 gap-0.5">
              {ANCHORS.map(a => (
                <label
                  key={a}
                  title={t(`layout.anchors.${a}`)}
                  className={`size-5 cursor-pointer rounded-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-600 ${spec.anchor === a ? 'bg-brand-600' : 'bg-line-soft hover:bg-line'} has-[:disabled]:cursor-not-allowed`}
                >
                  <input
                    type="radio"
                    name="layout-anchor"
                    className="sr-only"
                    aria-label={t(`layout.anchors.${a}`)}
                    checked={spec.anchor === a}
                    disabled={courseOnly || !box}
                    onChange={() => box && update(e => specForBox(e, box, size, a))}
                  />
                </label>
              ))}
            </div>
          </fieldset>
          <span className="text-xs text-body">
            {pinnedText(spec, t)}. {t('layout.pinnedHelp')}
          </span>
        </div>
        <div className="flex gap-3">
          <Field label={t('layout.width')} htmlFor="layout-w">
            <CommitNumber
              id="layout-w"
              value={spec.size[0]}
              min={0.5}
              max={1000}
              disabled={Boolean(spec.stretch)}
              onCommit={w => place({ ...spec, size: [w, spec.size[1]] })}
            />
          </Field>
          <Field label={t('layout.height')} htmlFor="layout-h">
            <CommitNumber
              id="layout-h"
              // A text element is as high as its lines: shown, not set.
              value={spec.kind === 'text' && box ? box.maxY - box.minY : spec.size[1]}
              min={0.5}
              max={1000}
              disabled={spec.kind === 'text'}
              onCommit={h => place({ ...spec, size: [spec.size[0], h] })}
            />
          </Field>
        </div>
        <Check
          label={t('layout.stretch')}
          checked={Boolean(spec.stretch)}
          disabled={courseOnly || !box}
          onChange={on =>
            update(e => {
              const { stretch: _old, ...rest } = e
              if (!on) return { ...rest, size: [box ? box.maxX - box.minX : e.size[0], e.size[1]] } as PageElementSpec
              return { ...rest, stretch: [Math.max(0, box?.minX ?? 0), Math.max(0, size[0] - (box?.maxX ?? size[0]))] } as PageElementSpec
            })
          }
        />
        <Check
          label={t('layout.pushMap')}
          checked={spec.pushMap === true}
          disabled={courseOnly}
          onChange={on =>
            update(e => {
              const { pushMap: _old, ...rest } = e
              return (on ? { ...rest, pushMap: true } : rest) as PageElementSpec
            })
          }
        />
        <Check
          label={t('layout.backing')}
          checked={Boolean(spec.backing)}
          disabled={courseOnly}
          onChange={on =>
            update(e => {
              const { backing: _old, ...rest } = e
              return (on ? { ...rest, backing: { padding: 1.5 } } : rest) as PageElementSpec
            })
          }
        />
        <Check
          label={t('layout.locked')}
          checked={base.locked === true}
          onChange={on =>
            update(e => {
              const { locked: _old, ...rest } = e
              return (on ? { ...rest, locked: true } : rest) as PageElementSpec
            })
          }
        />
      </div>
      {picking && (
        <ImagePicker
          clubId={props.clubId}
          eventId={props.eventId}
          onClose={() => setPicking(false)}
          onChoose={(image: ChosenImage) => {
            setPicking(false)
            update(e => {
              if (e.kind !== 'image') return e
              const height = image.aspect ? Math.round((e.size[0] / image.aspect) * 100) / 100 : e.size[1]
              return { ...e, asset: image.id, size: [e.size[0], height] }
            })
          }}
        />
      )}
    </>,
  )
}

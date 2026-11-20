// The Descriptions tab: the selected course's control description sheet, drawn with the same Canvas
// backend as the map and the print, with a button over every cell the setter fills in. A cell opens the
// symbol picker, which pops out over the map next to the panel.
import {
  type Course,
  cellSymbol,
  DESCRIPTION_SYMBOLS,
  type DescriptionColumnKey,
  type DescriptionSymbolDef,
  type DeviceTransform,
  descriptionSheet,
  drawDescriptionSheet,
  drawDescriptionSymbol,
  drawPrimitives,
  type EventDoc,
  type Primitive,
  type SheetLine,
  setDescription,
} from '@course-setter/core'
import { type FormEvent, Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, fieldClass } from '../components/ui.tsx'
import { NOTICES_URL } from '../lib/links.ts'

/** On screen a cell is 36 CSS px (the sheet fits the panel at its narrowest); laid out at 6 mm cells and scaled. */
const CELL_PX = 36
const CELL_MM = 6
const PX_PER_MM = CELL_PX / CELL_MM
/** Room round the sheet for its outer line. */
const PAD = 2
const INK = '#1d1b20'
const KEYS = ['c', 'd', 'e', 'f', 'g', 'h'] as const

type Props = {
  doc: EventDoc
  course: Course
  title: string
  selected: string | null
  onSelect: (controlId: string) => void
  onEdit: (doc: EventDoc) => void
}

type Open = { controlId: string; column: DescriptionColumnKey; anchor: HTMLButtonElement }

export function DescriptionsTab({ doc, course, title, selected, onSelect, onEdit }: Props) {
  const { t } = useTranslation()
  const lines = useMemo(() => descriptionSheet(doc, course, title), [doc, course, title])
  const primitives = useMemo(() => drawDescriptionSheet(lines, CELL_MM), [lines])
  const [open, setOpen] = useState<Open | null>(null)
  const width = 8 * CELL_PX + 2 * PAD
  const height = lines.length * CELL_PX + 2 * PAD

  // The control may leave the course (undo, another tab): close its picker.
  const openLine = open ? lines.find(l => l.kind === 'control' && l.controlId === open.controlId) : undefined
  useEffect(() => {
    if (open && !openLine) setOpen(null)
  }, [open, openLine])

  const name = (line: Extract<SheetLine, { kind: 'control' }>) =>
    line.start ? t('editor.stop.start') : t('editor.stop.control', { code: line.code })

  return (
    <div className="flex flex-col gap-2.5 px-3 py-3">
      <div className="relative" style={{ width, height }} data-testid="description-sheet">
        {lines.map((line, row) =>
          line.kind === 'control' && line.controlId === selected ? (
            <span
              key={line.controlId}
              aria-hidden="true"
              className="absolute bg-[#eaf2f9]"
              style={{ left: PAD, top: PAD + row * CELL_PX, width: 8 * CELL_PX, height: CELL_PX }}
            />
          ) : null,
        )}
        <PrimitiveCanvas
          primitives={primitives}
          width={width}
          height={height}
          transform={[PX_PER_MM, 0, 0, -PX_PER_MM, PAD, PAD]}
          className="absolute top-0 left-0"
        />
        {lines.map((line, row) => {
          if (line.kind !== 'control') return null
          const top = PAD + row * CELL_PX
          return (
            <Fragment key={line.controlId}>
              <button
                type="button"
                aria-label={t('descriptions.selectControl', { name: name(line) })}
                className="absolute hover:bg-brand-600/5"
                style={{ left: PAD, top, width: 2 * CELL_PX, height: CELL_PX }}
                onClick={() => onSelect(line.controlId)}
              />
              {KEYS.map((key, i) => {
                const value = line.cells[key]
                const active = open?.controlId === line.controlId && open.column === key
                return (
                  <button
                    key={key}
                    type="button"
                    aria-label={t('descriptions.cell', {
                      name: name(line),
                      column: t(`descriptions.columns.${key}`),
                      value: value ? cellText(key, value) : t('descriptions.empty'),
                    })}
                    aria-haspopup="dialog"
                    aria-expanded={active}
                    className={`absolute ${active ? 'bg-brand-600/10 outline-2 -outline-offset-2 outline-brand-600' : 'hover:bg-brand-600/5 hover:outline-1 hover:-outline-offset-1 hover:outline-brand-600'}`}
                    style={{ left: PAD + (i + 2) * CELL_PX, top, width: CELL_PX, height: CELL_PX }}
                    onClick={e => {
                      const anchor = e.currentTarget
                      onSelect(line.controlId)
                      setOpen(o =>
                        o?.controlId === line.controlId && o.column === key ? null : { controlId: line.controlId, column: key, anchor },
                      )
                    }}
                  />
                )
              })}
            </Fragment>
          )
        })}
      </div>
      <p className="m-0 text-xs text-muted">{t('descriptions.help')}</p>
      <a href={NOTICES_URL} target="_blank" rel="noreferrer" className="self-start text-xs">
        {t('descriptions.credits')}
      </a>
      {open && openLine?.kind === 'control' && (
        <SymbolPicker
          key={`${open.controlId}:${open.column}`}
          title={t('descriptions.pickerTitle', { name: name(openLine), column: open.column.toUpperCase() })}
          column={open.column}
          current={openLine.cells[open.column]}
          anchor={open.anchor}
          onSet={value => {
            onEdit(setDescription(doc, open.controlId, open.column, value))
            setOpen(null)
            open.anchor.focus()
          }}
          onClose={() => {
            setOpen(null)
            open.anchor.focus()
          }}
        />
      )}
    </div>
  )
}

/** A cell's value for screen readers and the picker footer: the symbol's name, or the size as written. */
function cellText(column: DescriptionColumnKey, value: string): string {
  return cellSymbol(column, value)?.name ?? value.replace('x', '×')
}

/** Primitives drawn on a canvas sharp at any pixel ratio; `transform` maps paper mm to CSS pixels. */
function PrimitiveCanvas({
  primitives,
  width,
  height,
  transform,
  className = '',
}: {
  primitives: Primitive[]
  width: number
  height: number
  transform: DeviceTransform
  className?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    drawPrimitives(ctx, primitives, { transform: transform.map(v => v * ratio) as DeviceTransform, color: INK })
  }, [primitives, width, height, transform])
  // The sheet is read through the cell buttons; the canvas only shows it.
  return <canvas ref={ref} className={`pointer-events-none ${className}`} style={{ width, height }} />
}

const ICON_PX = 32
const ICON_TRANSFORM: DeviceTransform = [ICON_PX / CELL_MM, 0, 0, -ICON_PX / CELL_MM, ICON_PX / 2, ICON_PX / 2]

function SymbolIcon({ symbol }: { symbol: DescriptionSymbolDef }) {
  const primitives = useMemo(() => drawDescriptionSymbol(symbol, [0, 0], CELL_MM), [symbol])
  return <PrimitiveCanvas primitives={primitives} width={ICON_PX} height={ICON_PX} transform={ICON_TRANSFORM} />
}

type Group = { title: string; symbols: DescriptionSymbolDef[] }

const drawn = (column: string) => DESCRIPTION_SYMBOLS.filter(s => s.column === column && s.shapes.length > 0)

/** Column D's categories, by the first part of the symbol number. */
const FEATURE_GROUPS = ['landforms', 'rock', 'water', 'vegetation', 'manMade', 'special'] as const

function useGroups(column: DescriptionColumnKey): Group[] {
  const { t } = useTranslation()
  return useMemo(() => {
    const features = FEATURE_GROUPS.map((key, i) => ({
      title: t(`descriptions.groups.${key}`),
      symbols: drawn('D').filter(s => s.id.startsWith(`${i + 1}.`)),
    }))
    switch (column) {
      case 'd':
        return features
      case 'e':
        return [
          { title: t('descriptions.groups.appearance'), symbols: drawn('E') },
          ...features.map(g => ({ ...g, title: t('descriptions.groups.second', { group: g.title }) })),
        ]
      default:
        return [{ title: t(`descriptions.columns.${column}`), symbols: drawn(column.toUpperCase()) }]
    }
  }, [column, t])
}

const PICKER_WIDTH = 424
const GAP = 14

/** Where the picker goes: left of the course panel beside the cell, or under the cell when the panel fills the width. */
function place(anchor: HTMLElement, height: number): { left: number; top: number; arrow: number | null } {
  const cell = anchor.getBoundingClientRect()
  const panel = anchor.closest('aside')?.getBoundingClientRect()
  const maxTop = Math.max(8, window.innerHeight - height - 8)
  if (panel && panel.left >= PICKER_WIDTH + GAP + 8) {
    const middle = cell.top + cell.height / 2
    const top = Math.min(Math.max(8, middle - 120), maxTop)
    return { left: panel.left - PICKER_WIDTH - GAP, top, arrow: middle - top }
  }
  const left = Math.min(Math.max(8, cell.left + cell.width / 2 - PICKER_WIDTH / 2), window.innerWidth - PICKER_WIDTH - 8)
  return { left, top: Math.min(cell.bottom + 8, maxTop), arrow: null }
}

function SymbolPicker({
  title,
  column,
  current,
  anchor,
  onSet,
  onClose,
}: {
  title: string
  column: DescriptionColumnKey
  current: string | undefined
  anchor: HTMLButtonElement
  onSet: (value: string | null) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  /** The size field in column F, else the search field. */
  const focusRef = useRef<HTMLInputElement>(null)
  const groups = useGroups(column)
  const [query, setQuery] = useState('')
  const [hovered, setHovered] = useState<DescriptionSymbolDef | null>(null)
  const [size, setSize] = useState(current && !cellSymbol(column, current) ? current : '')
  const [sizeError, setSizeError] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number; arrow: number | null } | null>(null)
  const height = Math.min(560, window.innerHeight - 16)

  useLayoutEffect(() => {
    const update = () => setPosition(place(anchor, height))
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [anchor, height])

  // Focus the first field once; close on a click anywhere else (the cell's own button toggles it).
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    focusRef.current?.focus()
    const outside = (e: PointerEvent) => {
      const target = e.target as Node
      if (!ref.current?.contains(target) && !anchor.contains(target)) close.current()
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [anchor])

  const q = query.trim().toLowerCase()
  const shown = groups
    .map(g => ({ ...g, symbols: g.symbols.filter(s => !q || s.name.toLowerCase().includes(q) || s.id.startsWith(q)) }))
    .filter(g => g.symbols.length > 0)

  const setSizeText = (e: FormEvent) => {
    e.preventDefault()
    const value = size.trim()
    if (!value) return
    if (!/^\d{1,4}(?:[.,]\d{1,2})?(?:[x×/|]\d{1,4}(?:[.,]\d{1,2})?)?$/.test(value)) {
      setSizeError(true)
      return
    }
    onSet(value)
  }

  const footer = hovered?.name ?? (current ? cellText(column, current) : null)

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={title}
      className="fixed z-20 flex flex-col gap-2 rounded-md border border-field bg-white p-3 shadow-[0_8px_28px_rgba(29,27,32,0.18)]"
      style={{ width: PICKER_WIDTH, maxHeight: height, left: position?.left ?? -9999, top: position?.top ?? 0 }}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      {position?.arrow != null && (
        <span
          aria-hidden="true"
          className="absolute -right-[8px] h-3.5 w-3.5 rotate-45 border-t border-r border-field bg-white"
          style={{ top: position.arrow - 7 }}
        />
      )}
      <div className="flex items-center gap-2">
        <span className="flex grow flex-col">
          <span className="text-xs text-muted">{title}</span>
          <span className="font-semibold">{t(`descriptions.columns.${column}`)}</span>
        </span>
        <button
          type="button"
          aria-label={t('descriptions.close')}
          className="flex h-7 w-7 items-center justify-center rounded hover:bg-subtle"
          onClick={onClose}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
            <path d="M5 5l14 14M19 5L5 19" />
          </svg>
        </button>
      </div>
      {column === 'f' && (
        <form onSubmit={setSizeText} className="flex flex-col gap-1">
          <label htmlFor="description-size" className="text-xs text-muted">
            {t('descriptions.size')}
          </label>
          <span className="flex gap-1.5">
            <input
              id="description-size"
              ref={focusRef}
              className={`${fieldClass} grow`}
              inputMode="decimal"
              placeholder="1.5"
              value={size}
              aria-invalid={sizeError}
              aria-describedby="description-size-help"
              onChange={e => {
                setSize(e.target.value)
                setSizeError(false)
              }}
            />
            <Button type="submit" disabled={!size.trim()}>
              {t('descriptions.setSize')}
            </Button>
          </span>
          <span id="description-size-help" className={`text-xs ${sizeError ? 'text-danger' : 'text-muted'}`}>
            {t('descriptions.sizeHelp')}
          </span>
        </form>
      )}
      <label htmlFor="description-search" className="sr-only">
        {t('descriptions.search')}
      </label>
      <input
        id="description-search"
        ref={column === 'f' ? undefined : focusRef}
        type="search"
        className={fieldClass}
        placeholder={t('descriptions.searchPlaceholder')}
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      <div className="-mr-1.5 min-h-0 grow overflow-auto pr-1.5">
        {shown.length === 0 && <p className="m-0 py-3 text-[13px] text-muted">{t('descriptions.noMatch')}</p>}
        {shown.map(group => (
          <section key={group.title} aria-label={group.title}>
            <h3 className="mt-3 mb-1.5 text-xs font-semibold text-muted first:mt-1">{group.title}</h3>
            <div className="grid grid-cols-[repeat(8,44px)] gap-1">
              {group.symbols.map(symbol => {
                const on = symbol.id === current
                return (
                  <button
                    key={symbol.id}
                    type="button"
                    aria-label={symbol.name}
                    title={symbol.name}
                    aria-pressed={on}
                    className={`flex h-11 w-11 items-center justify-center rounded ${on ? 'border-2 border-brand-600 bg-brand-50' : 'border border-line hover:border-brand-600'}`}
                    onPointerEnter={() => setHovered(symbol)}
                    onPointerLeave={() => setHovered(null)}
                    onFocus={() => setHovered(symbol)}
                    onBlur={() => setHovered(null)}
                    onClick={() => onSet(symbol.id)}
                  >
                    <SymbolIcon symbol={symbol} />
                  </button>
                )
              })}
            </div>
          </section>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-line-soft pt-2">
        <span className="grow text-[13px] text-body" aria-live="polite">
          {footer ? (
            <>
              {hovered ? '' : `${t('descriptions.current')} `}
              <b className="text-ink">{footer}</b>
            </>
          ) : (
            t('descriptions.hoverHint')
          )}
        </span>
        <Button size="sm" disabled={!current} onClick={() => onSet(null)}>
          {t('descriptions.clear')}
        </Button>
      </div>
    </div>
  )
}

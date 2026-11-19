import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Tool } from './state.ts'

const PURPLE = '#b5179e'

const icons: Record<Tool, ReactNode> = {
  select: <path d="M5 3l14 8-6 2-2 6z" stroke="currentColor" />,
  start: <path d="M12 4l8 15H4z" stroke={PURPLE} />,
  control: <circle cx="12" cy="12" r="7" stroke={PURPLE} />,
  finish: (
    <g stroke={PURPLE}>
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="9" />
    </g>
  ),
  crossingPoint: (
    <g stroke={PURPLE}>
      <path d="M9 4c-3 5-3 11 0 16" />
      <path d="M15 4c3 5 3 11 0 16" />
    </g>
  ),
  bend: <path d="M4 18l6-10 10 4" stroke="currentColor" />,
}

/** Tool groups; later tools (gaps in lines and circles, special markings) get their own group here. */
const groups: Tool[][] = [['select'], ['start', 'control', 'finish', 'crossingPoint'], ['bend']]

function Divider() {
  return <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />
}

export function Toolbar({
  tool,
  onTool,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  hint,
}: {
  tool: Tool
  onTool: (tool: Tool) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  hint: string
}) {
  const { t } = useTranslation()
  const toolButton = (name: Tool) => (
    <button
      key={name}
      type="button"
      aria-pressed={tool === name}
      onClick={() => onTool(name)}
      className={`flex h-8 items-center gap-1.5 rounded border px-2.5 text-[13px] ${tool === name ? 'border-[#c9a9c3] bg-brand-50 font-semibold' : 'border-transparent hover:bg-subtle'}`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="2" aria-hidden="true">
        {icons[name]}
      </svg>
      {t(`editor.tools.${name}`)}
    </button>
  )
  return (
    <div
      role="toolbar"
      aria-label={t('editor.tools.label')}
      className="flex min-h-11 flex-wrap items-center gap-1 border-t border-line-soft bg-white px-3 py-1"
    >
      {groups.map((group, i) => (
        <span key={group.join()} className="flex items-center gap-1">
          {i > 0 && <Divider />}
          {group.map(toolButton)}
        </span>
      ))}
      <Divider />
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        className="h-8 rounded px-2.5 text-[13px] hover:bg-subtle disabled:text-[#a59fa9] disabled:hover:bg-transparent"
      >
        {t('editor.undo')}
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        className="h-8 rounded px-2.5 text-[13px] hover:bg-subtle disabled:text-[#a59fa9] disabled:hover:bg-transparent"
      >
        {t('editor.redo')}
      </button>
      <span className="grow" />
      <span className="text-[13px] text-muted">{hint}</span>
    </div>
  )
}

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Menu, menuItemClass } from '../components/Menu.tsx'
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
  // An hourglass: ")(".
  crossingPoint: (
    <g stroke={PURPLE}>
      <path d="M8 4c4 5 4 11 0 16" />
      <path d="M16 4c-4 5-4 11 0 16" />
    </g>
  ),
  bend: <path d="M4 18l6-10 10 4" stroke="currentColor" />,
}

/**
 * Special course planning symbols (ISOM 2017-2 / ISSprOM 2019-2, 7xx). Only the crossing point so far;
 * map issue point, marked route, out-of-bounds boundary/area/route, first aid and refreshment point
 * join this menu with special markings.
 */
const specialTools: Tool[] = ['crossingPoint']

function Icon({ tool }: { tool: Tool }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="2" aria-hidden="true">
      {icons[tool]}
    </svg>
  )
}

function Divider() {
  return <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />
}

const buttonClass = (active: boolean) =>
  `flex h-8 items-center gap-1.5 rounded border px-2.5 text-[13px] ${active ? 'border-[#c9a9c3] bg-brand-50 font-semibold' : 'border-transparent hover:bg-subtle'}`

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
    <button key={name} type="button" aria-pressed={tool === name} onClick={() => onTool(name)} className={buttonClass(tool === name)}>
      <Icon tool={name} />
      {t(`editor.tools.${name}`)}
    </button>
  )
  const special = specialTools.includes(tool) ? tool : null

  return (
    <div
      role="toolbar"
      aria-label={t('editor.tools.label')}
      className="flex min-h-11 flex-wrap items-center gap-1 border-t border-line-soft bg-white px-3 py-1"
    >
      {toolButton('select')}
      <Divider />
      {(['start', 'control', 'finish'] as const).map(toolButton)}
      <Menu
        label={t('editor.tools.special')}
        buttonClassName={buttonClass(special !== null)}
        button={
          <>
            {special && <Icon tool={special} />}
            {special ? t(`editor.tools.${special}`) : t('editor.tools.special')}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </>
        }
      >
        {close => (
          <>
            <ul className="m-0 list-none p-0">
              {specialTools.map(name => (
                <li key={name}>
                  <button
                    type="button"
                    className={`${menuItemClass} ${tool === name ? 'font-semibold' : ''}`}
                    aria-pressed={tool === name}
                    onClick={() => {
                      onTool(name)
                      close()
                    }}
                  >
                    <Icon tool={name} />
                    {t(`editor.tools.${name}`)}
                  </button>
                </li>
              ))}
            </ul>
            <p className="m-0 max-w-64 border-t border-line px-3 pt-2 pb-1 text-xs text-muted">{t('editor.tools.moreLater')}</p>
          </>
        )}
      </Menu>
      <Divider />
      {toolButton('bend')}
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

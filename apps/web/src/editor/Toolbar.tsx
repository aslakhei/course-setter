import { SPECIALS_BY_STANDARD, type Standard } from '@course-setter/core'
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
  mapIssue: <path d="M6 12h12" stroke={PURPLE} strokeWidth="4" />,
  markedRoute: <path d="M3 19L21 5" stroke={PURPLE} strokeDasharray="5 2.5" />,
  oobBoundary: <path d="M3 19L21 5" stroke={PURPLE} strokeWidth="4" />,
  oobArea: (
    <g stroke={PURPLE} strokeWidth="1.5">
      <rect x="4" y="4" width="16" height="16" />
      <path d="M4 12l8-8M4 20L20 4M12 20l8-8M12 4l8 8M4 4l16 16M4 12l8 8" />
    </g>
  ),
  oobRoute: <path d="M3 9l4 4m0-4l-4 4M10 9l4 4m0-4l-4 4M17 9l4 4m0-4l-4 4" stroke={PURPLE} />,
  crossingSection: <path d="M3 6q2 3 5 3h13M3 18q2-3 5-3h13" stroke={PURPLE} />,
  firstAid: <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" fill={PURPLE} />,
  refreshment: (
    <g stroke={PURPLE}>
      <ellipse cx="12" cy="6" rx="7" ry="2" />
      <path d="M5 6l3 13h8l3-13" />
    </g>
  ),
  temporaryConstruction: <path d="M4 10l6-6 10 10-6 6z" stroke={PURPLE} strokeWidth="1" fill={PURPLE} fillOpacity="0.5" />,
}

/**
 * Special course planning symbols (ISOM 2017-2 / ISSprOM 2019-2, 7xx): the crossing point (a stop on the
 * course) and the special symbols of the event's standard.
 */
const specialTools = (standard: Standard): Tool[] => ['crossingPoint', ...SPECIALS_BY_STANDARD[standard]]

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
  standard,
  tool,
  onTool,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  hint,
}: {
  standard: Standard
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
  const specials = specialTools(standard)
  const special = specials.includes(tool) ? tool : null

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
          <ul className="m-0 list-none p-0">
            {specials.map(name => (
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

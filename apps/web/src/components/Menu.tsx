import { type ReactNode, useEffect, useId, useRef, useState } from 'react'

/** A button that opens a small list below it; closes on Escape, outside click or choosing an item. */
export function Menu({
  label,
  button,
  buttonClassName,
  align = 'start',
  children,
}: {
  label: string
  button: ReactNode
  buttonClassName: string
  align?: 'start' | 'end'
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        className={buttonClassName}
        onClick={() => setOpen(o => !o)}
      >
        {button}
      </button>
      {open && (
        <div
          id={id}
          className={`absolute top-full z-20 mt-1 min-w-56 rounded-md border border-line bg-white py-1 shadow-[0_4px_16px_rgba(29,27,32,0.12)] ${align === 'end' ? 'right-0' : 'left-0'}`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export const menuItemClass = 'flex w-full items-center gap-2 px-3 py-2 text-left text-ink no-underline hover:bg-subtle'

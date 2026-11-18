import type { ButtonHTMLAttributes, ReactNode } from 'react'

const buttonBase =
  'inline-flex items-center justify-center gap-1.5 rounded font-[inherit] whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60'

const buttonVariants = {
  primary: 'bg-brand-600 font-semibold text-white hover:bg-brand-700',
  secondary: 'border border-field bg-white text-ink hover:bg-subtle',
  danger: 'text-danger hover:bg-red-50',
} as const

const buttonSizes = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-8 px-3 text-[13px]',
  lg: 'h-10 px-4 text-sm',
} as const

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof buttonVariants
  size?: keyof typeof buttonSizes
}

export function Button({ variant = 'secondary', size = 'md', className = '', type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={`${buttonBase} ${buttonVariants[variant]} ${buttonSizes[size]} ${className}`} {...props} />
}

/** A bordered box with a title row, the building block of every page. */
export function Panel({
  title,
  titleId,
  actions,
  children,
  className = '',
}: {
  title: ReactNode
  titleId: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section aria-labelledby={titleId} className={`min-w-0 rounded-md border border-line bg-white ${className}`}>
      <div className="flex min-h-10 flex-wrap items-center gap-2 border-b border-line px-3.5 py-1.5">
        <h2 id={titleId} className="grow text-sm font-semibold">
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  )
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 px-3.5 py-6 text-center text-body">
      {icon}
      <span className="font-semibold text-ink">{title}</span>
      {children && <span>{children}</span>}
    </div>
  )
}

const avatarColours = [
  'bg-brand-100 text-brand-600',
  'bg-[#e3e6ef] text-[#34416b]',
  'bg-[#f1e7d9] text-[#74470f]',
  'bg-[#dfeaf0] text-[#22506a]',
  'bg-[#ece0e6] text-[#6b2648]',
] as const

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? '?'
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : ''
  return (first + last).toUpperCase()
}

/** Profile picture, or coloured initials when there is none (or it fails to load). */
export function Avatar({ name, url, seed, size = 24 }: { name: string; url?: string | null; seed: string; size?: number }) {
  const colour = avatarColours[[...seed].reduce((sum, c) => sum + c.charCodeAt(0), 0) % avatarColours.length]
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) }
  if (url) {
    return <img src={url} alt="" referrerPolicy="no-referrer" className="shrink-0 rounded-full object-cover" style={style} />
  }
  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-full font-bold ${colour}`} style={style}>
      {initials(name)}
    </span>
  )
}

export function ClubMark({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-md bg-brand-600 font-bold text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.39) }}
    >
      {initials(name)}
    </span>
  )
}

export function ErrorMessage({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-[13px] text-danger">
      {children}
    </p>
  )
}

export function Loading({ label }: { label: string }) {
  return <p className="px-3.5 py-6 text-center text-muted">{label}</p>
}

export const fieldClass =
  'h-8 rounded border border-field bg-white px-2 font-[inherit] text-[13px] text-ink placeholder:text-muted focus:border-brand-600 focus:outline-none'

export const visuallyHidden = 'sr-only'

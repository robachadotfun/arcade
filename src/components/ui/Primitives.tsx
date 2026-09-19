'use client'

import Link from 'next/link'
import {forwardRef, useEffect, useId, useRef, type ReactNode} from 'react'

/**
 * The small set of primitives the whole product is built from.
 *
 * Written by hand rather than pulled from a component library: the design brief is a
 * bespoke editorial surface, and stripping a library's identity back out costs more than
 * writing the twelve components that actually get used. Accessibility is implemented
 * directly here — focus trapping, labelled dialogs, real button semantics.
 */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 font-sans font-medium transition-[background-color,border-color,color,transform] duration-200 ease-[var(--ease-mechanical)] disabled:cursor-not-allowed disabled:opacity-40 active:translate-y-px select-none'

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-paper hover:bg-ink-soft',
  secondary: 'bg-transparent text-ink border border-hairline-strong hover:bg-paper-deep',
  ghost: 'bg-transparent text-ink-muted hover:text-ink hover:bg-paper-deep',
  danger: 'bg-transparent text-signal-stop border border-signal-stop/30 hover:bg-signal-stop/5',
}

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[0.8125rem] rounded-[var(--radius-edge)]',
  md: 'h-11 px-5 text-[0.9375rem] rounded-[var(--radius-edge)]',
  lg: 'h-14 px-7 text-base rounded-[var(--radius-edge)]',
}

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant
    size?: ButtonSize
  }
>(function Button({variant = 'primary', size = 'md', className = '', ...props}, ref) {
  return (
    <button
      ref={ref}
      className={`${BUTTON_BASE} ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]} ${className}`}
      {...props}
    />
  )
})

/**
 * A link styled as a button.
 *
 * Separate from {@link Button} rather than an `asChild` prop, because nesting an anchor
 * inside a button is invalid HTML and breaks keyboard and screen-reader behaviour. If it
 * navigates, it is an anchor.
 */
export function ButtonLink({
  href,
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: {
  href: string
  children: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
} & Omit<React.ComponentPropsWithoutRef<typeof Link>, 'href' | 'className' | 'children'>) {
  return (
    <Link
      href={href}
      className={`${BUTTON_BASE} ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]} ${className}`}
      {...props}
    >
      {children}
    </Link>
  )
}

/** A tiny uppercase technical label. The Arc-native detail, used everywhere. */
export function Label({children, className = ''}: {children: ReactNode; className?: string}) {
  return <span className={`label text-ink-faint ${className}`}>{children}</span>
}

/**
 * A status pill. `tone` sets the colour, but the text always carries the meaning too, so
 * the state is never communicated by colour alone.
 */
export function Pill({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode
  tone?: 'neutral' | 'live' | 'warn' | 'stop' | 'arc'
  className?: string
}) {
  const tones: Record<string, string> = {
    neutral: 'border-hairline-strong text-ink-muted',
    live: 'border-signal-live/30 text-signal-live',
    warn: 'border-signal-warn/30 text-signal-warn',
    stop: 'border-signal-stop/30 text-signal-stop',
    arc: 'border-arc/30 text-arc',
  }
  return (
    <span
      className={`micro inline-flex items-center gap-1.5 border px-2 py-1 ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

/** A small filled dot. Decorative only — never the sole carrier of meaning. */
export function Dot({tone = 'live', pulse = false}: {tone?: 'live' | 'warn' | 'stop' | 'arc'; pulse?: boolean}) {
  const tones: Record<string, string> = {
    live: 'bg-signal-live',
    warn: 'bg-signal-warn',
    stop: 'bg-signal-stop',
    arc: 'bg-arc',
  }
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-1.5 rounded-full ${tones[tone]} ${pulse ? 'node-pulse' : ''}`}
    />
  )
}

/**
 * A structural panel. Hairline border, minimal radius, no shadow — deliberately not a
 * floating SaaS card.
 */
export function Panel({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode
  className?: string
  as?: 'div' | 'section' | 'article' | 'li'
}) {
  return (
    <Tag className={`border border-hairline bg-paper-raised ${className}`}>{children}</Tag>
  )
}

/** Section heading with an eyebrow label and an optional rule above it. */
export function SectionHead({
  eyebrow,
  title,
  lede,
  align = 'left',
  className = '',
}: {
  eyebrow?: string
  title: ReactNode
  lede?: ReactNode
  align?: 'left' | 'center'
  className?: string
}) {
  return (
    <header className={`${align === 'center' ? 'text-center' : ''} ${className}`}>
      {eyebrow ? (
        <div className={`mb-5 flex items-center gap-3 ${align === 'center' ? 'justify-center' : ''}`}>
          <span aria-hidden="true" className="h-px w-8 bg-hairline-strong" />
          <Label>{eyebrow}</Label>
        </div>
      ) : null}
      <h2 className="text-title text-ink">{title}</h2>
      {lede ? (
        <p
          className={`mt-5 max-w-[46ch] text-lede text-ink-muted ${align === 'center' ? 'mx-auto' : ''}`}
        >
          {lede}
        </p>
      ) : null}
    </header>
  )
}

/**
 * An accessible modal dialog: focus is moved in, trapped while open, and restored on close.
 * Escape and backdrop both dismiss. Scroll is locked on the body.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  labelledBy,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  labelledBy?: string
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const autoId = useId()
  const titleId = labelledBy ?? `${autoId}-title`
  const descId = `${autoId}-desc`

  useEffect(() => {
    if (!open) return

    previouslyFocused.current = document.activeElement as HTMLElement | null
    const {overflow} = document.body.style
    document.body.style.overflow = 'hidden'

    // Move focus into the dialog so a keyboard user is not left behind on the page.
    const focusTimer = window.setTimeout(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      ;(first ?? panelRef.current)?.focus()
    }, 0)

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusables || focusables.length === 0) return

      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (!first || !last) return

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = overflow
      previouslyFocused.current?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 bg-ink/20 backdrop-blur-[2px]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className="relative z-10 w-full max-w-md border border-hairline-strong bg-paper-raised p-6 sm:p-7"
      >
        <h2 id={titleId} className="font-display text-[1.375rem] leading-tight text-ink">
          {title}
        </h2>
        {description ? (
          <p id={descId} className="mt-2 text-[0.9375rem] leading-relaxed text-ink-muted">
            {description}
          </p>
        ) : null}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  )
}

/** A definition row: tiny label, value aligned right. Used across every detail panel. */
export function DataRow({
  label,
  value,
  mono = false,
  className = '',
}: {
  label: string
  value: ReactNode
  mono?: boolean
  className?: string
}) {
  return (
    <div className={`flex items-baseline justify-between gap-6 py-2.5 ${className}`}>
      <dt className="label shrink-0 text-ink-faint">{label}</dt>
      <dd
        className={`min-w-0 text-right text-[0.9375rem] text-ink ${mono ? 'font-mono text-[0.8125rem] break-all' : ''}`}
        data-numeric={mono ? '' : undefined}
      >
        {value}
      </dd>
    </div>
  )
}

/** Inline external link with consistent affordance. */
export function ExternalLink({
  href,
  children,
  className = '',
}: {
  href: string
  children: ReactNode
  className?: string
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 text-arc underline decoration-arc/25 underline-offset-[3px] transition-colors hover:decoration-arc ${className}`}
    >
      {children}
      <svg viewBox="0 0 12 12" className="size-2.5 shrink-0" aria-hidden="true" fill="none">
        <path d="M3 9L9 3M9 3H4.5M9 3v4.5" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    </a>
  )
}

/** Screen-reader-only text. */
export function VisuallyHidden({children}: {children: ReactNode}) {
  return <span className="sr-only">{children}</span>
}

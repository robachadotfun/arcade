'use client'

import {useState} from 'react'
import type {FaqItem} from '@/content/faq'

/**
 * FAQ list.
 *
 * Built on native `<details>`/`<summary>`, which gives correct expand/collapse semantics,
 * keyboard operation and find-in-page behaviour for free, then styled back to the Arcade
 * hairline language.
 */
export function FaqAccordion({items, className = ''}: {items: FaqItem[]; className?: string}) {
  // Tracked only to rotate the indicator; the open state itself lives in the DOM element.
  const [open, setOpen] = useState<Set<number>>(new Set())

  return (
    <div className={`border-t border-hairline ${className}`}>
      {items.map((item, i) => (
        <details
          key={item.question}
          className="group border-b border-hairline"
          onToggle={(event) => {
            const isOpen = (event.currentTarget as HTMLDetailsElement).open
            setOpen((prev) => {
              const next = new Set(prev)
              if (isOpen) next.add(i)
              else next.delete(i)
              return next
            })
          }}
        >
          <summary className="flex cursor-pointer list-none items-start justify-between gap-6 py-5 [&::-webkit-details-marker]:hidden">
            <span className="text-[1.0625rem] leading-snug text-ink">{item.question}</span>
            <span
              aria-hidden="true"
              className="mt-1.5 grid size-4 shrink-0 place-items-center text-ink-faint transition-transform duration-300 ease-[var(--ease-mechanical)]"
              style={{transform: open.has(i) ? 'rotate(45deg)' : undefined}}
            >
              <svg viewBox="0 0 14 14" className="size-3.5" fill="none">
                <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </span>
          </summary>
          <div className="pb-6 pr-10">
            <p className="max-w-[62ch] text-[0.9375rem] leading-relaxed text-ink-muted">
              {item.answer}
            </p>
          </div>
        </details>
      ))}
    </div>
  )
}

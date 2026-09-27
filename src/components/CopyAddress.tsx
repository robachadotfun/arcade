'use client'

import {useState} from 'react'

/**
 * A contract address shown in full, with one click to copy it.
 *
 * Truncating to `0x1ec7…24B6` is fine for a row in a table where the address is incidental.
 * It is wrong wherever the address is the point: a reader comparing against an explorer needs
 * every character, and the middle is exactly where a lookalike address differs.
 *
 * The copy control is a real button with a live region rather than an icon that silently
 * succeeds, because "did that work" is the immediate question and a tooltip does not answer
 * it for anyone using a screen reader.
 *
 * Clipboard access can be refused — insecure origins, permissions, older browsers — so the
 * failure path says so instead of showing a success state that did not happen. The address
 * stays selectable either way, which is the fallback that always works.
 */
export function CopyAddress({address, className = ''}: {address: string; className?: string}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  async function copy() {
    try {
      await navigator.clipboard.writeText(address)
      setState('copied')
    } catch {
      setState('failed')
    }
    window.setTimeout(() => setState('idle'), 2500)
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-3">
        <code className="font-mono text-[0.875rem] break-all text-ink select-all">{address}</code>
        <button
          type="button"
          onClick={() => void copy()}
          className="shrink-0 border border-hairline-strong px-2.5 py-1 font-mono text-[0.6875rem] uppercase tracking-wide text-ink-muted transition-colors hover:border-ink hover:text-ink"
        >
          {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
        </button>
      </div>
      <p aria-live="polite" className="sr-only">
        {state === 'copied'
          ? 'Address copied to the clipboard.'
          : state === 'failed'
            ? 'Could not copy. Select the address and copy it manually.'
            : ''}
      </p>
    </div>
  )
}

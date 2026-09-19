'use client'

import {useState} from 'react'
import {Button, SectionHead} from '../ui/Primitives'

/**
 * Admin sign-in.
 *
 * The key is POSTed to a server route and compared there in constant time. It never becomes
 * part of the client bundle and is never stored in the browser — the only thing that comes
 * back is an httpOnly session cookie.
 */
export function AdminLogin({onAuthenticated}: {onAuthenticated: () => void}) {
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/session', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({token}),
      })
      if (res.ok) {
        setToken('')
        onAuthenticated()
        return
      }
      const data = (await res.json().catch(() => ({}))) as {error?: string}
      setError(data.error ?? 'Invalid key.')
    } catch {
      setError('Could not reach the server.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="shell py-20 md:py-28">
      <div className="mx-auto max-w-[26rem]">
        <SectionHead eyebrow="Admin" title="Operator access" />
        <form onSubmit={submit} className="mt-10 border border-hairline bg-paper-raised p-6">
          <label htmlFor="admin-key" className="label block text-ink-faint">
            Admin key
          </label>
          <input
            id="admin-key"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            required
            className="mt-3 h-11 w-full border border-hairline-strong bg-paper px-3 font-mono text-[0.875rem] text-ink outline-none focus-visible:border-arc"
          />
          {error ? (
            <p role="alert" className="mt-3 text-[0.8125rem] text-signal-stop">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="mt-5 w-full" disabled={pending || token.length === 0}>
            {pending ? 'Checking…' : 'Enter console'}
          </Button>
          <p className="mt-5 text-[0.75rem] leading-relaxed text-ink-faint">
            Set <code className="font-mono">ARCADE_ADMIN_KEY</code> (server-only, minimum 24
            characters) to enable this route. Without it the route returns 404 rather than
            advertising an admin surface.
          </p>
        </form>
      </div>
    </div>
  )
}

import {cookies} from 'next/headers'
import {NextResponse} from 'next/server'
import {ADMIN_COOKIE, ADMIN_SESSION_SECONDS, isAdminEnabled, verifyAdminToken} from '@/lib/adminAuth'

/**
 * Admin session endpoint.
 *
 * The admin key is only ever compared on the server. It is never sent to the client, never
 * exposed through a NEXT_PUBLIC_ variable, and never written into the bundle. A successful
 * check sets an httpOnly, sameSite=strict cookie holding a session marker — not the key.
 */

export const runtime = 'nodejs'

export async function POST(request: Request) {
  if (!isAdminEnabled()) {
    return NextResponse.json({error: 'Admin access is not configured.'}, {status: 404})
  }

  let token: unknown
  try {
    const body = (await request.json()) as {token?: unknown}
    token = body.token
  } catch {
    return NextResponse.json({error: 'Malformed request.'}, {status: 400})
  }

  if (typeof token !== 'string' || !verifyAdminToken(token)) {
    // Uniform message and status: do not distinguish "wrong key" from "malformed key".
    return NextResponse.json({error: 'Invalid key.'}, {status: 401})
  }

  const store = await cookies()
  store.set(ADMIN_COOKIE, 'granted', {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ADMIN_SESSION_SECONDS,
  })

  return NextResponse.json({ok: true})
}

export async function DELETE() {
  const store = await cookies()
  store.delete(ADMIN_COOKIE)
  return NextResponse.json({ok: true})
}

export async function GET() {
  if (!isAdminEnabled()) {
    return NextResponse.json({error: 'Admin access is not configured.'}, {status: 404})
  }
  const store = await cookies()
  return NextResponse.json({authenticated: store.get(ADMIN_COOKIE)?.value === 'granted'})
}

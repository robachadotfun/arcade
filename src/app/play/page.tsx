import type {Metadata} from 'next'
import {PlaySurface} from '@/components/PlaySurface'

export const metadata: Metadata = {
  title: 'Play',
  description:
    'Choose a machine, pay in USDC, and spin once. The outcome is decided onchain and verifiable by anyone.',
}

export default async function PlayPage({
  searchParams,
}: {
  searchParams: Promise<{machine?: string}>
}) {
  const {machine} = await searchParams
  return <PlaySurface initialSlug={machine} />
}

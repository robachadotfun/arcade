import type {Metadata} from 'next'
import {MyArcade} from '@/components/MyArcade'

export const metadata: Metadata = {
  title: 'My Arcade',
  description: 'Your spins, your rewards, and anything still waiting to be claimed.',
}

export default function MyArcadePage() {
  return <MyArcade />
}

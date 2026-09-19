import type {Metadata} from 'next'
import {LegalDocumentView} from '@/components/LegalDocumentView'
import {RESPONSIBLE_PLAY} from '@/content/legal'

export const metadata: Metadata = {
  title: 'Responsible Play',
  description: 'Session limits, self-exclusion, and an honest account of what browser-local controls can and cannot do.',
}

export default function Page() {
  return <LegalDocumentView doc={RESPONSIBLE_PLAY} />
}

import type {Metadata} from 'next'
import {LegalDocumentView} from '@/components/LegalDocumentView'
import {PRIVACY} from '@/content/legal'

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'Arcade has no accounts and no user database. What stays in your browser, and what is public because it is onchain.',
}

export default function Page() {
  return <LegalDocumentView doc={PRIVACY} />
}

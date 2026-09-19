import type {Metadata} from 'next'
import {LegalDocumentView} from '@/components/LegalDocumentView'
import {TERMS} from '@/content/legal'

export const metadata: Metadata = {
  title: 'Terms of Use',
  description: 'The agreement between you and the operator of the Arcade interface.',
}

export default function Page() {
  return <LegalDocumentView doc={TERMS} />
}

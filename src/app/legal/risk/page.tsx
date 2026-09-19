import type {Metadata} from 'next'
import {LegalDocumentView} from '@/components/LegalDocumentView'
import {RISK_DISCLOSURE} from '@/content/legal'

export const metadata: Metadata = {
  title: 'Risk Disclosure',
  description: 'What can go wrong when you spin: odds, volatility, unaudited contracts, randomness assumptions and regulatory risk.',
}

export default function Page() {
  return <LegalDocumentView doc={RISK_DISCLOSURE} />
}

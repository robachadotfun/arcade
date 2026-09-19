import type {Metadata} from 'next'
import Link from 'next/link'
import {FaqAccordion} from '@/components/FaqAccordion'
import {SectionHead, Label} from '@/components/ui/Primitives'
import {ArcadeArt} from '@/components/ArcadeArt'
import {HOME_FAQ, FAIRNESS_FAQ} from '@/content/faq'

export const metadata: Metadata = {
  title: 'FAQ',
  description:
    'What Arcade is, what a spin costs, where rewards come from, how the outcome is chosen, and what Arcade cannot promise.',
}

export default function FaqPage() {
  return (
    <div className="relative iso-grid">
      <div className="shell relative py-14 md:py-20">
      <SectionHead
        eyebrow="FAQ"
        title={
          <>
            Questions worth
            <br />
            asking first.
          </>
        }
        lede="Including the ones with uncomfortable answers."
      />

      <ArcadeArt
        name="settlement"
        className="mx-auto mt-12 max-w-[50rem]"
        sizes="(min-width: 1024px) 50rem, 100vw"
      />

      <div className="mt-16 grid gap-16 lg:grid-cols-[1fr_1fr] lg:gap-20">
        <section>
          <Label>The product</Label>
          <FaqAccordion items={HOME_FAQ} className="mt-5" />
        </section>
        <section>
          <Label>Fairness and randomness</Label>
          <ArcadeArt
            name="fairness-commitment"
            className="mt-5"
            sizes="(min-width: 1024px) 45vw, 100vw"
            caption="Commitments are published before any spin can consume them."
          />
          <FaqAccordion items={FAIRNESS_FAQ} className="mt-8" />
          <p className="mt-8 text-[0.9375rem] leading-relaxed text-ink-muted">
            The full mechanism, including its residual trust assumption, is on the{' '}
            <Link href="/fairness" className="text-arc underline decoration-arc/25 underline-offset-[3px] hover:decoration-arc">
              fairness page
            </Link>
            .
          </p>
        </section>
      </div>
      </div>
    </div>
  )
}

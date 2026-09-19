import type {Metadata} from 'next'
import {ActivityFeed} from '@/components/ActivityFeed'
import {SectionHead} from '@/components/ui/Primitives'
import {ArcadeArt} from '@/components/ArcadeArt'

export const metadata: Metadata = {
  title: 'Activity',
  description:
    'Every Arcade spin, as it settles. Indexed straight from Arc — no summaries, no curation, no hidden rows.',
}

export default function ActivityPage() {
  return (
    <div className="relative iso-grid">
      <div className="shell relative py-14 md:py-20">
      <SectionHead
        eyebrow="Activity"
        title={
          <>
            Arcade never
            <br />
            hides the tape.
          </>
        }
        lede="Every spin, in order, as it settles. Read directly from Arc — nothing is filtered out and nothing is added in."
      />
      <ArcadeArt
        name="empty-tape"
        className="mx-auto mt-10 max-w-[48rem]"
        sizes="(min-width: 1024px) 48rem, 100vw"
      />

      <div className="mt-12">
        <ActivityFeed />
      </div>
      </div>
    </div>
  )
}

import Link from 'next/link'
import {Label, SectionHead} from './ui/Primitives'
import {LEGAL_DOCUMENTS, type LegalDocument} from '@/content/legal'

/** Renders a legal document in the editorial style, with cross-links to the others. */
export function LegalDocumentView({doc}: {doc: LegalDocument}) {
  return (
    <div className="shell py-14 md:py-20">
      <div className="grid gap-14 lg:grid-cols-[1fr_16rem] lg:gap-20">
        <article className="max-w-[68ch]">
          <SectionHead eyebrow="Legal" title={doc.title} lede={doc.standfirst} />
          <p className="mt-6 label text-ink-faint">Last updated {doc.updated}</p>

          <div className="mt-12 flex flex-col gap-10">
            {doc.sections.map((section) => (
              <section key={section.heading}>
                <h2 className="font-display text-[1.375rem] leading-snug text-ink">
                  {section.heading}
                </h2>
                {section.paragraphs.map((paragraph) => (
                  <p
                    key={paragraph.slice(0, 40)}
                    className="mt-3.5 text-[1rem] leading-relaxed text-ink-soft"
                  >
                    {paragraph}
                  </p>
                ))}
                {section.list ? (
                  <ul className="mt-4 flex flex-col gap-2">
                    {section.list.map((item) => (
                      <li key={item} className="flex gap-3 text-[0.9375rem] leading-relaxed text-ink-soft">
                        <span aria-hidden="true" className="mt-2.5 h-px w-4 shrink-0 bg-hairline-strong" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>

          <p className="mt-14 border-t border-hairline pt-8 text-[0.8125rem] leading-relaxed text-ink-faint">
            Arcade is an independent application built on Arc and is not affiliated with or
            endorsed by Circle or Arc. This document is a product disclosure, not legal advice.
          </p>
        </article>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Label>Also read</Label>
          <ul className="mt-4 flex flex-col gap-2.5">
            {LEGAL_DOCUMENTS.filter((d) => d.slug !== doc.slug).map((other) => (
              <li key={other.slug}>
                <Link
                  href={`/legal/${other.slug}`}
                  className="text-[0.9375rem] text-ink-muted transition-colors hover:text-ink"
                >
                  {other.title}
                </Link>
              </li>
            ))}
            <li className="mt-2 border-t border-hairline pt-3">
              <Link
                href="/fairness"
                className="text-[0.9375rem] text-arc underline decoration-arc/25 underline-offset-[3px] hover:decoration-arc"
              >
                How outcomes are decided
              </Link>
            </li>
          </ul>
        </aside>
      </div>
    </div>
  )
}

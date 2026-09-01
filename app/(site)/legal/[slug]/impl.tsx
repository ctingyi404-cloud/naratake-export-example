/* The site's legal documents, in whichever language the tree asks for.

   One route for all of them, and the text is data in site.config.json assembled
   at export time from the modules this site actually runs (see
   packages/codegen/src/legal.ts). Nothing here is written per merchant, and
   nothing here can describe a practice the build does not have — a boilerplate
   policy claiming card handling on a site with no payment module is not padding,
   it is a false statement of practice.

   The body lives here, not in page.tsx, so the second language's tree mounts the
   same implementation rather than a copy that can drift from it. */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { site } from '@/lib/site-config';
import { localePath, type SiteLocale } from '@/lib/locale-path';
import { localizeMetadata } from '@/lib/locale-seo';
import { SiteBottomChrome, SiteTopChrome } from '@/components/site-chrome';

type Params = { params: Promise<{ slug: string }> };

const docs = () => site.legalDocs ?? [];

/** zh where the document has it and the reader asked for it, English otherwise —
    a half-translated policy is worse than an English one honestly labelled. */
const pickText = (locale: SiteLocale, en: string, zh?: string) =>
  locale === 'zh' && zh ? zh : en;

export function legalRoute(locale: SiteLocale) {
  async function generateMetadata({ params }: Params): Promise<Metadata> {
    const { slug } = await params;
    const doc = docs().find((d) => d.slug === slug);
    if (!doc) return {};
    const title = pickText(locale, doc.title, doc.titleZh);
    /* localizeMetadata, like every other route: the bilingual pair has to be
       declared even for a page that declines to be indexed, or the two
       languages of the same policy read as unrelated documents. */
    return localizeMetadata(
      {
        title,
        /* A policy exists for the people who need to read it, not for search
           traffic — and indexing it competes with the pages that should rank. */
        robots: { index: false, follow: true },
        /* A BARE PATH, like every other route. localizeMetadata strips the
           locale prefix off this value to build the pair — handed an absolute
           URL it strips nothing, and both hreflangs come out pointing at the
           same address, which tells Google the two languages are one page. */
        alternates: { canonical: `/legal/${doc.slug}` },
      },
      locale,
    );
  }

  async function Page({ params }: Params) {
    const { slug } = await params;
    const doc = docs().find((d) => d.slug === slug);
    if (!doc) notFound();

    return (
      <>
      <SiteTopChrome />
      <main className="ls-container" style={{ padding: '72px 0 96px', maxWidth: 760 }}>
        <h1 style={{ fontSize: 'clamp(28px, 5vw, 40px)', marginBottom: 34, textWrap: 'balance' }}>
          {pickText(locale, doc.title, doc.titleZh)}
        </h1>
        {doc.sections.map((s, si) => (
          <section key={si} style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 18, marginBottom: 10 }}>{pickText(locale, s.h, s.hZh)}</h2>
            {(locale === 'zh' && s.bodyZh?.length ? s.bodyZh : s.body).map((p, i) =>
              p.startsWith('· ') ? (
                <p
                  key={i}
                  style={{ margin: '0 0 8px', paddingLeft: 18, position: 'relative', lineHeight: 1.75, color: 'var(--c-text-muted)' }}
                >
                  <span aria-hidden style={{ position: 'absolute', left: 0 }}>
                    ·
                  </span>
                  {p.slice(2)}
                </p>
              ) : (
                <p key={i} style={{ margin: '0 0 12px', lineHeight: 1.75, color: 'var(--c-text-muted)' }}>
                  {p}
                </p>
              ),
            )}
          </section>
        ))}
        <p
          style={{
            marginTop: 44,
            paddingTop: 20,
            borderTop: '1px solid var(--c-border)',
            fontSize: 13,
            color: 'var(--c-text-muted)',
            lineHeight: 1.65,
          }}
        >
          {locale === 'zh'
            ? '本文件由本站的實際設定組合而成，是提供給你的法律顧問審閱的起點，不構成法律意見。'
            : 'This document was assembled from this site’s actual configuration. It is a starting point for your own counsel to review, not legal advice.'}
        </p>
      </main>
      <SiteBottomChrome />
      </>
    );
  }

  return { generateMetadata, Page };
}

/** every document ships as a static page — they change when the site does */
export function legalStaticParams() {
  return docs().map((d) => ({ slug: d.slug }));
}

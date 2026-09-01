'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useSiteLang } from '@/lib/site-i18n';
import { cjkNoWrap, renderInlineMarkup } from '../richtext';

/* Tiny client island for bilingual text. Lets otherwise server-rendered text
   components (headings, paragraphs, buttons) carry a zh/es variant that flips
   live with the visitor's language toggle — without turning the whole component
   into a client component. Only rendered when a translation actually exists.
   `markup` is body copy (RtText/RtHeading): the three inline marks parse here
   too, so a bilingual paragraph keeps its bold and links after a language
   toggle. */
export function LocText({ en, zh, es, markup }: { en?: string | null; zh?: string | null; es?: string | null; markup?: boolean }) {
  const { pick } = useSiteLang();
  const s = pick(en, zh, es) ?? '';
  return <>{markup ? renderInlineMarkup(s) : cjkNoWrap(s)}</>;
}

/* Split-text twin of LocText: renders the localized string PRE-SPLIT into the
   ls-motion unit markup (.mo-unit with --ci, nowrap word groups), so kinetic
   headings animate in EVERY language. The old path let motion.tsx split the DOM
   destructively, which fought React's text node on language toggle — bilingual
   headings had to fall back to a still headline. React owning the spans fixes
   that: toggling re-renders the units and the copy stays correct.
   Markup mirrors motion.tsx splitEl exactly (parity with the engine path). */
export function SplitLocText({
  en,
  zh,
  es,
  by = 'chars',
}: {
  en?: string | null;
  zh?: string | null;
  es?: string | null;
  by?: 'chars' | 'words';
}) {
  const { pick } = useSiteLang();
  const text = pick(en, zh, es) ?? '';
  let ci = 0;
  const unit = (u: string, key: string) => {
    const s = (
      <span key={key} className="mo-unit" aria-hidden style={{ '--ci': String(ci) } as CSSProperties}>
        {u}
      </span>
    );
    ci += 1;
    return s;
  };
  const parts: ReactNode[] = [];
  text.split(/(\s+)/).forEach((w, i) => {
    if (!w) return;
    if (/^\s+$/.test(w)) {
      parts.push(w);
      return;
    }
    const hasCjk = /[\u3000-\u9fff\uff00-\uffef]/.test(w);
    // 'words' falls back to per-char for CJK runs \u2014 Chinese has no space-delimited
    // words, so a whole-sentence unit would lose the cascade entirely
    if (by === 'words' && !hasCjk) {
      parts.push(unit(w, `w${i}`));
      return;
    }
    // per-char cascade, but line breaks may only fall BETWEEN words: chars live
    // inside a group. Latin words stay whole; CJK must wrap between glyphs or a
    // long space-less title overflows a phone frame.
    const nowrap = !hasCjk;
    parts.push(
      <span key={`g${i}`} style={{ display: 'inline-block', whiteSpace: nowrap ? 'nowrap' : undefined }}>
        {[...w].map((ch, j) => unit(ch, `c${i}-${j}`))}
      </span>,
    );
  });
  // aria-label on a generic span is prohibited ARIA — a visually-hidden twin
  // carries the accessible name (and stays language-synced) instead
  return (
    <>
      <span aria-hidden>{parts}</span>
      <span
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {text}
      </span>
    </>
  );
}

/* plain localized string with NO wrapper spans — for SVG contexts (textPath)
   where HTML spans are invalid and break rendering */
export function PlainLocText({ en, zh, es }: { en?: string | null; zh?: string | null; es?: string | null }) {
  const { pick } = useSiteLang();
  return <>{pick(en, zh, es) ?? ''}</>;
}

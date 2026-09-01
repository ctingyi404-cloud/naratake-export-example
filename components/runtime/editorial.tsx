'use client';

/* Editorial chrome — the pieces a publication has and a shop does not.

   A shop's navbar is a floating pill: it gets out of the way and points at a
   menu. A publication's masthead is the opposite. It is the title of the thing,
   set at size, with the sections of the paper ruled underneath it. Trying to
   dress the pill up as one was the single loudest reason our publication pages
   read as generated.

   Nothing here needs a backend. The sections are the site's own pages, which the
   merchant already arranges, so this works on a static export as readily as on a
   database-backed one. */

import type { CSSProperties } from 'react';
import { site } from '@/lib/site-config';
import { useSiteLang } from '@/lib/site-i18n';
import { localePath } from '@/lib/locale-path';

type Sty = { className?: string; style?: CSSProperties };

/** A component asks for a ROLE, never a number. Twin of `ty` in collections.tsx. */
const ty = (role: 'display' | 'hero' | 'title' | 'heading' | 'body' | 'small' | 'micro'): CSSProperties => ({
  fontSize: `var(--t-${role})`,
  lineHeight: `var(--t-${role}-lh)`,
  letterSpacing: `var(--t-${role}-tr)`,
  fontWeight: `var(--t-${role}-w)` as unknown as number,
  fontFamily: `var(--t-${role}-f)`,
});

/** the mark: the paper's initials in a filled block, the way a masthead carries one */
function Seal({ text }: { text: string }) {
  const rows = text.length > 2 ? [text.slice(0, Math.ceil(text.length / 2)), text.slice(Math.ceil(text.length / 2))] : [text];
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-grid',
        placeItems: 'center',
        padding: '5px 6px',
        background: 'var(--c-primary)',
        color: 'var(--c-primary-fg)',
        fontFamily: 'var(--f-body)',
        fontSize: 9.5,
        fontWeight: 800,
        letterSpacing: '0.06em',
        lineHeight: 1.05,
        textTransform: 'uppercase',
        flexShrink: 0,
      }}
    >
      {rows.map((r, i) => (
        <span key={i}>{r}</span>
      ))}
    </span>
  );
}

/** A link in the section deck: what it says, and where it goes. */
export interface SectionLink {
  label: string;
  href: string;
}

export function RtMasthead({
  wordmark,
  wordmarkZh,
  seal,
  sealZh,
  actionLabel,
  actionLabelZh,
  actionHref,
  showSections = true,
  sectionLinks,
  dateline,
  datelineZh,
  className,
  style,
}: Sty & {
  wordmark?: string;
  wordmarkZh?: string;
  seal?: string;
  sealZh?: string;
  actionLabel?: string;
  actionLabelZh?: string;
  actionHref?: string;
  showSections?: boolean;
  /* The desks of the paper, when the masthead follows a content type rather
     than the site's pages. Baked by codegen from the same entries the canvas
     reads, never fetched: a nav that arrives after a round trip is a nav that
     flashes, and this one is above the fold. */
  sectionLinks?: SectionLink[];
  dateline?: string;
  datelineZh?: string;
}) {
  const { lang } = useSiteLang();
  const t3 = (en: string, zh: string, es: string) => (lang === 'es' ? es : lang === 'zh' ? zh : en);
  const name = (lang === 'zh' ? wordmarkZh || wordmark : wordmark)?.trim() || site.business.name;
  const action = (lang === 'zh' ? actionLabelZh || actionLabel : actionLabel)?.trim();
  const mark = (lang === 'zh' ? sealZh || seal : seal)?.trim();
  const line = (lang === 'zh' ? datelineZh || dateline : dateline)?.trim();
  const pages = site.pages.filter((p) => !p.hideFromNav && p.slug !== '/');
  /* Three decks, and which content lands on which is decided by one answer.
     With section links the paper's desks own the ruled row and the site's own
     pages — archive, corrections, about — move to the utility line, which is
     where a newspaper has always kept them. Without them, nothing moves. */
  const owned = (sectionLinks ?? []).filter((s) => s.label);
  const sections: SectionLink[] = !showSections
    ? []
    : owned.length > 0
      ? owned
      : pages.map((p) => ({ label: p.name, href: p.slug }));
  // a masthead's departments and its action all stay inside the reader's language
  const lp = (h?: string | null) => localePath(lang, h);
  const utility: SectionLink[] = owned.length > 0 ? pages.map((p) => ({ label: p.name, href: p.slug })) : [];

  const rule: CSSProperties = { borderBottom: '1px solid var(--c-border)' };
  const micro: CSSProperties = { ...ty('micro'), textTransform: 'uppercase', textDecoration: 'none', whiteSpace: 'nowrap' };

  return (
    <header className={className} style={{ background: 'var(--c-bg)', ...style }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '0 20px' }}>
        {(line || utility.length > 0) && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px 20px', flexWrap: 'wrap', padding: '9px 0', ...rule }}>
            {line && <span style={{ ...micro, color: 'var(--c-text-muted)' }}>{line}</span>}
            <span style={{ flex: 1 }} />
            {utility.map((x) => (
              <a key={x.href} href={lp(x.href)} style={{ ...micro, color: 'var(--c-text)' }}>
                {x.label}
              </a>
            ))}
          </div>
        )}
        {/* the title of the thing, and the one action a reader is offered */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 0 14px', flexWrap: 'wrap' }}>
          <a
            href={lp('/')}
            style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--c-text)', textDecoration: 'none', minWidth: 0 }}
          >
            {mark && <Seal text={mark} />}
            <span style={{ ...ty('title'), letterSpacing: '-0.005em' }}>{name}</span>
          </a>
          <span style={{ flex: 1 }} />
          {action && (
            <a
              href={lp(actionHref || '/contact')}
              style={{
                ...ty('micro'),
                textTransform: 'uppercase',
                padding: '9px 14px',
                border: '1px solid var(--c-primary)',
                color: 'var(--c-primary)',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              {action}
            </a>
          )}
        </div>
        {/* the sections of the paper. A thick rule over a thin one is the oldest
            masthead device there is, and it costs two borders. */}
        <div style={{ borderTop: '3px solid var(--c-text)' }} />
        {sections.length > 0 && (
          <nav
            aria-label={t3('Sections', '版面', 'Secciones')}
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0 22px', padding: '10px 0', ...rule }}
          >
            {sections.map((s) => (
              <a key={s.href || s.label} href={s.href ? lp(s.href) : undefined} style={{ ...micro, color: 'var(--c-text)' }}>
                {s.label}
              </a>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}

/* ── the elements ───────────────────────────────────────────
   Twins of the four editorial elements in defs/editorial.tsx. Small,
   composable, and each one a thing a publication has and a shop does not.
   Inside a story these jobs are done by field roles; these blocks are for the
   hand-built pages a paper also has. */

/** the reader's language, applied to a pair of strings */
function useT3() {
  const { lang } = useSiteLang();
  return (en: string, zh: string, es: string) => (lang === 'es' ? es : lang === 'zh' ? zh : en);
}

export function RtByline({
  name,
  nameZh,
  role,
  roleZh,
  place,
  placeZh,
  when,
  whenZh,
  updated,
  updatedZh,
  className,
  style,
}: Sty & {
  name?: string;
  nameZh?: string;
  role?: string;
  roleZh?: string;
  place?: string;
  placeZh?: string;
  when?: string;
  whenZh?: string;
  updated?: string;
  updatedZh?: string;
}) {
  const { lang } = useSiteLang();
  const t3 = useT3();
  const who = ((lang === 'zh' ? nameZh || name : name) ?? '').trim();
  const beat = ((lang === 'zh' ? roleZh || role : role) ?? '').trim();
  const from = ((lang === 'zh' ? placeZh || place : place) ?? '').trim();
  const at = ((lang === 'zh' ? whenZh || when : when) ?? '').trim();
  const up = ((lang === 'zh' ? updatedZh || updated : updated) ?? '').trim();
  if (!who && !at && !from) return null;
  return (
    <div className={className} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 10px', ...style }}>
      {who && (
        <span style={{ ...ty('small'), fontWeight: 700, color: 'var(--c-text)' }}>
          {t3('By', '記者', 'Por')} {who}
        </span>
      )}
      {beat && <span style={{ ...ty('small'), color: 'var(--c-muted)' }}>{beat}</span>}
      <span style={{ flexBasis: '100%', height: 0 }} />
      {from && <span style={{ ...ty('micro'), textTransform: 'uppercase', color: 'var(--c-text)' }}>{from}</span>}
      {at && <span style={{ ...ty('small'), color: 'var(--c-muted)' }}>{at}</span>}
      {/* Updated only when it is a second fact. A line repeating the publication
          time teaches readers the timestamp means nothing. */}
      {up && up !== at && (
        <span style={{ ...ty('small'), color: 'var(--c-muted)' }}>
          {t3('Updated', '更新於', 'Actualizado')} {up}
        </span>
      )}
    </div>
  );
}

export function RtPhotoCredit({
  caption,
  captionZh,
  credit,
  creditZh,
  className,
  style,
}: Sty & { caption?: string; captionZh?: string; credit?: string; creditZh?: string }) {
  const { lang } = useSiteLang();
  const text = ((lang === 'zh' ? captionZh || caption : caption) ?? '').trim();
  const by = ((lang === 'zh' ? creditZh || credit : credit) ?? '').trim();
  if (!text && !by) return null;
  return (
    <p className={className} style={{ margin: 0, paddingTop: 7, borderTop: '1px solid var(--c-border)', ...style }}>
      {text && <span style={{ ...ty('small'), color: 'var(--c-text)' }}>{text}</span>}
      {text && by && ' '}
      {by && <span style={{ ...ty('micro'), textTransform: 'uppercase', color: 'var(--c-muted)' }}>{by}</span>}
    </p>
  );
}

export function RtSponsoredLabel({
  sponsor,
  sponsorZh,
  note,
  noteZh,
  className,
  style,
}: Sty & { sponsor?: string; sponsorZh?: string; note?: string; noteZh?: string }) {
  const { lang } = useSiteLang();
  const t3 = useT3();
  const who = ((lang === 'zh' ? sponsorZh || sponsor : sponsor) ?? '').trim();
  const why = ((lang === 'zh' ? noteZh || note : note) ?? '').trim();
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        gap: '2px 10px',
        padding: '8px 12px',
        borderTop: '2px solid var(--c-text)',
        borderBottom: '1px solid var(--c-border)',
        background: 'var(--c-surface)',
        ...style,
      }}
    >
      <span style={{ ...ty('micro'), textTransform: 'uppercase', color: 'var(--c-text)', fontWeight: 800 }}>
        {t3('Paid content', '付費內容', 'Contenido pagado')}
      </span>
      {who && (
        <span style={{ ...ty('small'), color: 'var(--c-text)' }}>
          {t3('Paid for by', '出資方', 'Pagado por')} {who}
        </span>
      )}
      {why && <span style={{ ...ty('small'), color: 'var(--c-muted)' }}>{why}</span>}
    </div>
  );
}

const NOTE_KINDS: Record<string, [string, string, string]> = {
  CORRECTION: ['Correction', '更正', 'Corrección'],
  CLARIFICATION: ['Clarification', '釐清', 'Aclaración'],
  EDITORS_NOTE: ['Editor’s note', '編者按', 'Nota del editor'],
  UPDATE: ['Update', '更新', 'Actualización'],
};

export function RtCorrectionNote({
  kind,
  when,
  whenZh,
  body,
  bodyZh,
  className,
  style,
}: Sty & { kind?: string; when?: string; whenZh?: string; body?: string; bodyZh?: string }) {
  const { lang } = useSiteLang();
  const t3 = useT3();
  const text = ((lang === 'zh' ? bodyZh || body : body) ?? '').trim();
  if (!text) return null;
  const [en, zh, es] = NOTE_KINDS[kind ?? 'CORRECTION'] ?? NOTE_KINDS.CORRECTION;
  const at = ((lang === 'zh' ? whenZh || when : when) ?? '').trim();
  return (
    <div className={className} style={{ borderLeft: '3px solid var(--c-primary)', paddingLeft: 14, ...style }}>
      <span style={{ ...ty('micro'), textTransform: 'uppercase', color: 'var(--c-text)', fontWeight: 800 }}>
        {t3(en, zh, es)}
        {at && ` · ${at}`}
      </span>
      <p style={{ ...ty('body'), color: 'var(--c-text)', margin: '4px 0 0' }}>{text}</p>
    </div>
  );
}

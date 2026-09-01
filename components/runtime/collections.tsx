'use client';

/* User-defined content types (collections). ONE list and ONE detail body serve
   every content type a merchant invents — jobs, courses, case studies, docs,
   events. The shape comes from the collection definition baked into
   site.config.json; the rows come from the generic CollectionEntry table. No
   per-collection component, no per-collection migration. */

import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { apiGet } from '@/lib/client';
import { money } from '@/lib/money';
import { LIST_PAGE } from '@/lib/paging';
import { slugText, urlPath } from '@/lib/slug';
import {
  fieldRoles,
  site,
  siteCollection,
  type FieldRole,
  type SiteCollection,
  type SiteCollectionField,
} from '@/lib/site-config';
import { useSiteLang } from '@/lib/site-i18n';
import { localePath, type SiteLocale } from '@/lib/locale-path';
import { isLegacyHtml, richExcerpt, RichText } from '../richtext';
import { SITE_RICH } from './extra';

type Sty = { className?: string; style?: CSSProperties };

/* A component asks for a ROLE, never for a number. The values behind these come
   from TYPE_VOICES in schema, emitted into :root by codegen and re-tuned under
   html[lang^="zh"], so one voice restyles a whole site and Chinese gets the
   leading and tracking it actually needs. The canvas reads the same table
   through typeCss(); the render-parity gate holds the two together. */
const ty = (role: 'display' | 'hero' | 'title' | 'heading' | 'body' | 'small' | 'micro'): CSSProperties => ({
  fontSize: `var(--t-${role})`,
  lineHeight: `var(--t-${role}-lh)`,
  letterSpacing: `var(--t-${role}-tr)`,
  fontWeight: `var(--t-${role}-w)` as unknown as number,
  fontFamily: `var(--t-${role}-f)`,
});
type Kind = SiteCollectionField['kind'];

export interface CollectionEntry {
  /** which collection this row belongs to — the detail body looks up its fields */
  collection?: string;
  slug: string;
  title: string;
  data: Record<string, unknown>;
  publishedAt?: string | null;
  updatedAt?: string | null;
}

/** Everything that points AT one entry through one reference field: the back
    edge that turns /authors/maria into a real archive with no new route and no
    taxonomy table. The server that renders the detail page fills it. */
/** A published, dated, attributed change to the record. Not an edit. */
export interface EntryNote {
  id: string;
  kind: 'CORRECTION' | 'CLARIFICATION' | 'EDITORS_NOTE' | 'UPDATE';
  body: string;
  bodyZh: string | null;
  author: string | null;
  createdAt: string;
}

export interface EntryBackref {
  /** the collection whose entries point here */
  collection: string;
  /** the reference field of that collection doing the pointing */
  field: string;
  /** first page of pointing entries, in the public API's row shape */
  entries: Record<string, unknown>[];
  total: number;
}

/* ── edges between content types ───────────────────────────
   A reference field stores the TARGET ENTRY'S SLUG in the same `data` blob as
   every other value, so an author, a category or a stylist costs no join table
   and no migration. The two kinds reach a deployed site through
   site.config.json, which is typed by hand in lib/site-config.ts, so they are
   matched as plain strings rather than against that union.

   These stay private: this file is 'use client', so every export of it is a
   client reference and a server component that imported one could only render
   it, never call it. The detail route keeps its own three lines. */
/* What each kind is called for a reader. A correction and a clarification are
   different admissions and a paper that conflates them is telling on itself:
   one says we were wrong, the other says we were right and unclear. */
const NOTE_LABEL: Record<string, [string, string]> = {
  CORRECTION: ['Correction', '更正'],
  CLARIFICATION: ['Clarification', '澄清'],
  EDITORS_NOTE: ["Editors' note", '編者說明'],
  UPDATE: ['Update', '後續'],
};

/** a flag that means the story is happening now, rather than merely labelled */
/* \b is defined against [A-Za-z0-9_], so a word boundary cannot exist beside a
   CJK character: every Chinese alternative here was unreachable and 突發 always
   rendered as a quiet outline. Latin words keep their boundaries; CJK matches on
   substring, which is how Chinese reads anyway. */
const LOUD = /\b(?:breaking|live|urgent)\b|突發|直播|即時/i;

const REF_KINDS = new Set<string>(['reference', 'references']);
/** the collection a reference field points at, or '' when it is not one */
const refTargetOf = (f: SiteCollectionField) =>
  REF_KINDS.has(f.kind) ? ((f as { refCollection?: string }).refCollection ?? '') : '';
/** the slugs a reference field holds — one for `reference`, several for `references` */
const refSlugs = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [v]).filter((s): s is string => typeof s === 'string' && s.trim() !== '');
/** how a resolved reference title is keyed, so one flat map serves every field */
const refKey = (collection: string, slug: string) => `${collection}/${slug}`;

/* ── the back edge, aimed by hand ──────────────────────────────
   A section page follows an edge backwards on its own. A front page asks the
   same question of a band it composed itself — "three from City Hall" — so
   `refFilter` is that edge with the target named rather than read off the page
   you are standing on. Server data arrives already filtered (listPage runs the
   same ?ref= the archives use); the rows codegen baked in are the whole
   collection, so a statically-served band narrows them here. */
function splitRef(filter: string | undefined): { key: string; slug: string } | undefined {
  const cut = filter ? filter.indexOf(':') : -1;
  if (cut < 0) return undefined;
  const key = filter!.slice(0, cut).trim();
  const slug = filter!.slice(cut + 1).trim();
  return key && slug ? { key, slug } : undefined;
}

/** baked rows narrowed to one edge — twin of `filtered` in the canvas def */
function filterByRef(rows: Record<string, unknown>[], filter: string | undefined): Record<string, unknown>[] {
  const ref = splitRef(filter);
  if (!ref) return rows;
  return rows.filter((r) => {
    const data = (r.data && typeof r.data === 'object' ? r.data : r) as Record<string, unknown>;
    const v = data[ref.key];
    return Array.isArray(v) ? v.includes(ref.slug) : v === ref.slug;
  });
}

/** single-entry form of @localsite/schema entrySlug (the server owns dedupe) */
const slugify = (t: string) => slugText(t);

/** Baked sampleEntries arrive as flat records; the API returns { slug, title, data }. */
export function toEntry(def: SiteCollection | undefined, raw: Record<string, unknown>): CollectionEntry {
  const nested = raw.data && typeof raw.data === 'object' ? (raw.data as Record<string, unknown>) : null;
  const data = nested ?? raw;
  const t = raw.title ?? (def ? data[def.titleField] : undefined);
  const title = typeof t === 'string' && t.trim() ? t.trim() : (def?.singular ?? 'Entry');
  return {
    collection: def?.slug,
    slug: typeof raw.slug === 'string' && raw.slug ? raw.slug : slugify(title),
    title,
    data,
    publishedAt: typeof raw.publishedAt === 'string' ? raw.publishedAt : null,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
  };
}

export function sortEntries(def: SiteCollection | undefined, entries: CollectionEntry[]): CollectionEntry[] {
  if (def?.sort === 'title') return [...entries].sort((a, b) => a.title.localeCompare(b.title));
  if (def?.sort === 'newest')
    return [...entries].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
  return entries;
}

/* ── field helpers ─────────────────────────────────────────── */

const SCALAR: Kind[] = ['select', 'money', 'date', 'number', 'boolean', 'text'];
const LONG: Kind[] = ['textarea', 'richtext'];

const coverField = (def?: SiteCollection) => def?.fields.find((f) => f.kind === 'image');
const summaryField = (def?: SiteCollection) =>
  def?.fields.find((f) => LONG.includes(f.kind)) ??
  def?.fields.find((f) => f.kind === 'text' && f.key !== def.titleField);

/** photo for an entry: image field, else the first frame of a gallery field */
function photoOf(def: SiteCollection | undefined, e: CollectionEntry): string | undefined {
  for (const f of def?.fields ?? []) {
    const v = e.data[f.key];
    if (f.kind === 'image' && typeof v === 'string' && v) return v;
    if (f.kind === 'gallery') {
      const first = Array.isArray(v) ? v[0] : typeof v === 'string' ? v.split(',')[0] : null;
      if (typeof first === 'string' && first.trim()) return first.trim();
    }
  }
  return undefined;
}

function galleryOf(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  return raw.map((s) => String(s).trim()).filter(Boolean);
}

/** Long-form text, flattened. `textarea` is plain by contract, and so is any
    richtext an old editor saved as light HTML: the house never injects merchant
    markup, and a page published before the marks existed must not change. */
function paragraphs(v: unknown): string[] {
  return String(v ?? '')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A richtext field the merchant wrote with the marks — the only content that
    reaches the rich renderer. Everything else keeps the flattened path. */
const isMarked = (f: SiteCollectionField, v: unknown) =>
  f.kind === 'richtext' && !isLegacyHtml(String(v ?? ''));

/** the one line a card shows: marks removed, never shown raw */
const blurbOf = (f: SiteCollectionField | undefined, e: CollectionEntry) => {
  const v = f ? e.data[f.key] : undefined;
  return !f ? '' : isMarked(f, v) ? richExcerpt(String(v ?? '')) : (paragraphs(v)[0] ?? '');
};

function fieldText(f: SiteCollectionField, v: unknown, lang: string): string {
  if (v === null || v === undefined || v === '') return '';
  if (f.kind === 'money') return money(Math.round(Number(v) || 0));
  if (f.kind === 'date') {
    const raw = String(v);
    const d = new Date(raw);
    // A date field holds a CALENDAR date, not an instant. "2026-03-04" parses as
    // UTC midnight, so formatting it in a western timezone printed March 3 — the
    // story was dated a day before it was written. Only a value carrying a time
    // of day gets the business timezone.
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw.trim());
    return Number.isNaN(d.getTime())
      ? raw
      : new Intl.DateTimeFormat(lang === 'zh' ? 'zh-TW' : lang === 'es' ? 'es-US' : 'en-US', {
          dateStyle: 'medium',
          timeZone: dateOnly ? 'UTC' : site.business.timezone,
        }).format(d);
  }
  if (f.kind === 'boolean') return v ? (lang === 'zh' ? '是' : lang === 'es' ? 'Sí' : 'Yes') : '';
  if (f.kind === 'number') return Number(v).toLocaleString();
  return String(v);
}

/** the short facts a card or a detail header shows as chips */
function chips(def: SiteCollection | undefined, e: CollectionEntry, lang: string, skip: Set<string>) {
  return (def?.fields ?? [])
    .filter((f) => SCALAR.includes(f.kind) && !skip.has(f.key))
    .map((f) => ({ f, text: fieldText(f, e.data[f.key], lang) }))
    .filter((x) => x.text !== '');
}

/** One field flattened to the pieces a byline, a tag row or a meta line shows.
    A reference contributes the target's title linked to its own page, which is
    how a category chip doubles as the way into that category's archive. */
function chipItems(
  e: CollectionEntry,
  f: SiteCollectionField,
  lang: string,
  refTitles?: Record<string, string>,
): { text: string; href?: string }[] {
  const v = e.data[f.key];
  if (v === null || v === undefined || v === '') return [];
  if (REF_KINDS.has(f.kind)) {
    const target = siteCollection(refTargetOf(f));
    return refSlugs(v)
      .map((s) => ({
        text: refTitles?.[refKey(target?.slug ?? '', s)] ?? '',
        href: target && target.detailPage !== false ? localePath(lang as SiteLocale, urlPath(target.slug, s)) : undefined,
      }))
      .filter((x) => !!x.text);
  }
  const text = fieldText(f, v, lang);
  return text ? [{ text }] : [];
}

/** Minutes to read, the way a publication prints it. Chinese carries far more
    meaning per character than English does per letter, so the two scripts are
    counted separately rather than one rule being stretched over both. */
function readingMinutes(text: string): number {
  const plain = text.replace(/<[^>]+>/g, ' ');
  const cjk = (plain.match(/[一-鿿㐀-䶿]/g) ?? []).length;
  const words = plain.replace(/[一-鿿㐀-䶿]/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(cjk / 400 + words / 220));
}

/* An entry's address, in the language the list is being read in.

   The prefix goes on the outside of urlPath, never inside it: the slug the
   server matches against — and the slug the redirect ledger compares — is the
   one the entry actually has. */
const entryHref = (def: SiteCollection | undefined, e: CollectionEntry, lang: string) =>
  def && def.detailPage !== false ? localePath(lang as SiteLocale, urlPath(def.slug, e.slug)) : undefined;

/* ── shared bits ───────────────────────────────────────────── */

/** entry photo with a clean fallback band — a dead path never shows a broken img */
function EntryPhoto({ src, alt, ratio, height }: { src?: string; alt: string; ratio?: string; height?: number }) {
  const [broken, setBroken] = useState(false);
  const frame: CSSProperties = height ? { width: '100%', height } : { width: '100%', aspectRatio: ratio ?? '3 / 2' };
  if (src && !broken) {
    // The box is `frame` above: width:100% plus EITHER an explicit height OR an
    // aspectRatio, never neither. It is spread rather than written out because
    // the fallback band below must reserve exactly the same box — a photo that
    // fails to load may not move the page either. cls-ok
    // eslint-disable-next-line @next/next/no-img-element
    return (
      // width + (height | aspectRatio) via `frame` above: cls-ok
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
        className="ls-photo"
        style={{ ...frame, objectFit: 'cover', display: 'block' }}
      />
    );
  }
  // a span, not a div: the row layout nests this inside an <a><span> wrapper
  return (
    <span
      aria-hidden
      style={{
        ...frame,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'color-mix(in srgb, var(--c-primary) 12%, transparent)',
        color: 'var(--c-primary)',
        fontSize: 34,
        fontWeight: 800,
      }}
    >
      {(alt.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontSize: 11.5,
        fontWeight: 600,
        padding: '3px 10px',
        borderRadius: 999,
        background: 'color-mix(in srgb, var(--c-accent) 14%, transparent)',
        color: 'var(--c-text)',
      }}
    >
      {children}
    </span>
  );
}

/** The category line a publication sets above a headline: small, spaced, in the
    house accent. It links when the term has a page of its own, which is what
    makes taxonomy navigable rather than decorative. */
function Kicker({ children, href }: { children: ReactNode; href?: string }) {
  const style: CSSProperties = {
    ...ty('micro'),
    textTransform: 'uppercase',
    color: 'var(--c-primary)',
    textDecoration: 'none',
  };
  return href ? (
    <a href={href} style={style}>
      {children}
    </a>
  ) : (
    <span style={style}>{children}</span>
  );
}

/** A named band: a rule, a title in small caps, and the way out of it.

    A page that says "THE LATEST" over six stories and offers VIEW ALL is
    composed. The same six stories with no title above them are a query result,
    and a reader can tell the difference at a glance. */
function Band({ title, href, all }: { title: string; href?: string; all: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 16,
        borderTop: '2px solid var(--c-text)',
        paddingTop: 10,
        marginBottom: 18,
      }}
    >
      <h2 style={{ ...ty('micro'), textTransform: 'uppercase', margin: 0 }}>{title}</h2>
      {href && (
        <a
          href={href}
          style={{ ...ty('micro'), textTransform: 'uppercase', color: 'var(--c-primary)', textDecoration: 'none', whiteSpace: 'nowrap' }}
        >
          {all} →
        </a>
      )}
    </div>
  );
}

/* What a flag actually says.

   A boolean flag wears the field's own label: a checkbox called "Breaking" that
   is ticked means BREAKING, and printing the value ("true") would be nonsense.
   A flag with a value — the select a real newsroom uses, BREAKING / DEVELOPING /
   SPONSORED on one field — means the value, and printing the label there gave
   every flagged story a badge reading "Flag". Which one is which is answered by
   what is stored, not by what the field is called. */
export function flagWord(
  field: { label: string; labelZh?: string },
  value: unknown,
  lang: string,
): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return (lang === 'zh' ? field.labelZh || field.label : field.label) ?? '';
}

/** BREAKING. LIVE. SPONSORED. A flag is a boolean the newsroom decided was worth
    shouting, and it wears the field's own label, so a masthead invents its own
    vocabulary without asking us for code. Sponsored disclosure is a legal
    obligation in most markets, which is reason enough for this to be a role
    rather than a chip that happens to be red. */
function Flag({ children, tone }: { children: ReactNode; tone: 'live' | 'note' }) {
  return (
    <span
      style={{
        fontSize: `var(--t-micro)`,
        fontWeight: 800,
        letterSpacing: `var(--t-micro-tr)`,
        fontFamily: `var(--t-micro-f)`,
        textTransform: 'uppercase',
        padding: '2px 7px',
        background: tone === 'live' ? 'var(--c-primary)' : 'transparent',
        color: tone === 'live' ? 'var(--c-primary-fg)' : 'var(--c-text-muted)',
        border: tone === 'live' ? 'none' : '1px solid var(--c-border)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

/* A news timestamp is not a date. Within the hour a reader wants minutes; within
   the day, hours; after that the date is what carries meaning. And a story that
   was UPDATED says so, because on a running story the update is the news — but
   only when the gap is real, or every story carries a meaningless second line. */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function newsTime(iso: string | null | undefined, now: number, lang: string): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const ago = now - t;
  const zh = lang === 'zh';
  const es = lang === 'es';
  if (ago < 0 || ago >= DAY) {
    return new Intl.DateTimeFormat(zh ? 'zh-TW' : es ? 'es-US' : 'en-US', {
      dateStyle: 'medium',
      timeZone: site.business.timezone,
    }).format(new Date(t));
  }
  if (ago < MINUTE) return zh ? '剛剛' : es ? 'ahora mismo' : 'just now';
  if (ago < HOUR) {
    const m = Math.floor(ago / MINUTE);
    return zh ? `${m} 分鐘前` : es ? `hace ${m} min` : `${m} min ago`;
  }
  const h = Math.floor(ago / HOUR);
  return zh ? `${h} 小時前` : es ? `hace ${h} h` : `${h} hr ago`;
}

/** an update is worth printing only when it is meaningfully later than publication */
export const meaningfullyUpdated = (pub: string | null | undefined, upd: string | null | undefined): boolean => {
  if (!pub || !upd) return false;
  const a = new Date(pub).getTime();
  const b = new Date(upd).getTime();
  return !Number.isNaN(a) && !Number.isNaN(b) && b - a > HOUR;
};

function Empty({ text }: { text: string }) {
  return (
    <div style={{ padding: '36px 0', textAlign: 'center', color: 'var(--c-text-muted)', fontSize: 15 }}>{text}</div>
  );
}

/* ── list ──────────────────────────────────────────────────── */

/** the public route's own page size, so a server page and a client page agree */
const PAGE_SIZE = LIST_PAGE;

/** page numbers to offer around the current one; 0 marks an elided run */
function pageWindow(page: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const lo = Math.max(2, Math.min(page - 1, total - 3));
  const hi = Math.min(total - 1, Math.max(page + 1, 4));
  const mid: number[] = [];
  for (let n = lo; n <= hi; n++) mid.push(n);
  return [1, ...(lo > 2 ? [0] : []), ...mid, ...(hi < total - 1 ? [0] : []), total];
}

/** what is on screen: one server page once `live`, otherwise the baked sample */
interface ListView {
  rows: CollectionEntry[];
  total: number;
  page: number;
  live: boolean;
}

export function RtCollectionList({
  collection,
  layout = 'cards',
  limit,
  showImage = true,
  offset = 0,
  ctaLabel,
  ctaLabelZh,
  heading,
  headingZh,
  initialData,
  serverData,
  page: serverPage,
  refFilter,
  className,
  style,
}: Sty & {
  collection: string;
  layout?: 'cards' | 'rows' | 'grid' | 'lead';
  limit?: number;
  showImage?: boolean;
  /** Entries an earlier band already showed, skipped rather than re-printed.
      Server data arrives already offset (listPage takes the same number); the
      baked rows are the whole collection, so they are trimmed here. */
  offset?: number;
  ctaLabel?: string;
  ctaLabelZh?: string;
  /** Band title above the list — "THE LATEST", "VIDEO". Naming a band is what
      turns a page of query results into a composed one, and it carries its own
      "view all" into the type's list page. */
  heading?: string;
  headingZh?: string;
  initialData?: Record<string, unknown>[];
  /** The first page of LIVE entries, loaded by the server component that renders
      this block. Its presence means the content is already in the HTML — instant
      for the reader, visible to a crawler — so the client must NOT fetch on
      mount. It fetches only when the reader asks for another page. */
  serverData?: { entries: Record<string, unknown>[]; total: number; refTitles?: Record<string, string> };
  /** which page the server rendered, 1-based, from the ?<collection>=N query */
  page?: number;
  /** back edge: `fieldKey:slug`, passed to the API as ref= when paging */
  refFilter?: string;
}) {
  const { lang } = useSiteLang();
  // an unset picker means "the site's first content type" — the same fallback the
  // editor preview uses, so preview and export never disagree
  const def = collection ? siteCollection(collection) : (site.collections ?? [])[0];
  const size = limit && limit > 0 ? limit : PAGE_SIZE;
  // A site with no database has no route to page against, and its baked entries
  // are already the whole collection: it renders them all, exactly as before.
  const hasApi = (site.enabledModules ?? []).includes('collections');
  const [view, setView] = useState<ListView>(() => {
    // server data was filtered by the query that fetched it; baked rows are the
    // whole collection and are narrowed here
    const raw = serverData ? serverData.entries : filterByRef(initialData ?? [], refFilter);
    const sorted = sortEntries(def, raw.map((r) => toEntry(def, r)));
    // the server applied the offset in its query; baked rows are trimmed here
    const rows = serverData ? sorted : sorted.slice(Math.max(0, offset));
    return { rows, total: serverData?.total ?? rows.length, page: Math.max(1, serverPage ?? 1), live: !!serverData };
  });
  const rootRef = useRef<HTMLDivElement>(null);
  // one query key per list on the page: the collection, plus the field when this
  // is a back-edge archive, so two lists never fight over ?jobs=2
  const pageKey = def ? `${def.slug}${refFilter ? `_${refFilter.split(':')[0]}` : ''}` : '';

  const load = (next: number, onMount = false) => {
    if (!def) return;
    const query =
      `limit=${size}&offset=${Math.max(0, offset) + (next - 1) * size}` +
      (refFilter ? `&ref=${encodeURIComponent(refFilter)}` : '');
    apiGet<{ entries?: Record<string, unknown>[]; total?: number }>(
      `/collections/${encodeURIComponent(def.slug)}?${query}`,
    )
      .then((r) => {
        const rows = sortEntries(def, (r.entries ?? []).map((raw) => toEntry(def, raw)));
        // nothing published yet: keep the baked sample rather than blanking a
        // page that has always shown something
        if (onMount && rows.length === 0) return;
        // no `total` means no pager: a page link that leads nowhere is worse
        // than one page of rows
        setView({ rows, total: r.total ?? (next - 1) * size + rows.length, page: next, live: true });
        if (onMount) return;
        // the address bar and the scroll position move only once the rows are
        // in hand, so a failed request leaves the reader where they were
        const params = new URLSearchParams(window.location.search);
        if (next === 1) params.delete(pageKey);
        else params.set(pageKey, String(next));
        const qs = params.toString();
        window.history.pushState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
        rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (!def || !hasApi) return;
    // a reader can land on ?jobs=3 directly, and a page emitted before server
    // loading existed still has to reach live rows somehow
    const asked = Math.floor(Number(new URLSearchParams(window.location.search).get(pageKey)));
    const want = Number.isFinite(asked) && asked >= 1 ? asked : view.page;
    if (serverData && want === view.page) return; // the server already answered: no waterfall
    load(want, !serverData && want === view.page);
    // one shot per collection: paging afterwards goes through goto()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def]);

  const t3 = (en: string, zh: string, es: string) => (lang === 'es' ? es : lang === 'zh' ? zh : en);
  const name = def ? (lang === 'zh' ? def.nameZh : def.name) : collection;

  if (!def)
    return (
      <div className={className} style={style}>
        <Empty
          text={
            collection
              ? t3(
                  `The "${collection}" content type is not set up yet.`,
                  `尚未設定「${collection}」這個內容型別。`,
                  `El tipo de contenido "${collection}" aún no está configurado.`,
                )
              : t3(
                  'No content types yet. Add one (jobs, courses, case studies…) and this block lists its entries.',
                  '還沒有內容型別。先新增一個（職缺、課程、案例…），這個區塊就會列出它的項目。',
                  'Aún no hay tipos de contenido. Agrega uno y este bloque mostrará sus entradas.',
                )
          }
        />
      </div>
    );

  const shown = limit && limit > 0 ? view.rows.slice(0, limit) : view.rows;

  if (shown.length === 0)
    return (
      <div className={className} style={style}>
        <Empty
          text={t3(
            `Nothing published in ${name} yet. Add entries in the back office under ${def.name} and they appear here.`,
            `${name}還沒有已發布的內容。到後台的「${def.nameZh}」新增項目，就會出現在這裡。`,
            `Aún no hay contenido publicado en ${name}. Agrega entradas en el panel y aparecerán aquí.`,
          )}
        />
      </div>
    );

  /* Same roles the detail page reads, so a story looks like the same story in
     the list and on its own page. A type that declares nothing falls back to
     the guesses this component has always made. */
  const roles = fieldRoles(def);
  const roleOf = (f: SiteCollectionField): FieldRole => roles.get(f.key) ?? 'field';
  const of = (r: FieldRole) => def.fields.filter((f) => roleOf(f) === r);
  const cover = def.fields.find((f) => roleOf(f) === 'cover');
  const declaredSummary = of('standfirst')[0];
  const summary = declaredSummary ?? summaryField(def);
  const kickerFields = of('chip');
  const creditFields = [...of('byline'), ...of('meta')];
  const skip = new Set([def.titleField, summary?.key ?? '', cover?.key ?? '']);
  const withPhoto = showImage && !!(cover ?? def.fields.some((f) => f.kind === 'gallery'));
  /* An empty label is the DEFAULT, not a missing value: it is what lets the
     component say this in the reader's language. A non-empty English default
     shipped "View details" onto Chinese sites and made this fallback dead code. */
  const cta =
    (lang === 'zh' ? ctaLabelZh || ctaLabel : ctaLabel)?.trim() ||
    (of('body').length > 0
      ? t3('Read the story', '讀全文', 'Leer el reportaje')
      : t3('View details', '查看詳情', 'Ver detalles'));

  const Card = ({ e }: { e: CollectionEntry }) => {
    const href = entryHref(def, e, lang);
    const Tag = (href ? 'a' : 'div') as 'a';
    const facts = chips(def, e, lang, skip)
      .filter((x) => roleOf(x.f) === 'field')
      .slice(0, 3);
    const blurb = blurbOf(summary, e);
    const kickers = kickerFields.flatMap((f) => chipItems(e, f, lang, serverData?.refTitles)).slice(0, 2);
    const credits = creditFields.flatMap((f) => chipItems(e, f, lang, serverData?.refTitles)).slice(0, 2);
    return (
      <Tag
        href={href}
        className="ls-card"
        style={{ overflow: 'hidden', display: 'block', color: 'var(--c-text)', textDecoration: 'none' }}
      >
        {withPhoto && <EntryPhoto src={photoOf(def, e)} alt={e.title} />}
        <div style={{ padding: 18 }}>
          {kickers.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 7 }}>
              {kickers.map((x, i) => (
                <Kicker key={i}>{x.text}</Kicker>
              ))}
            </div>
          )}
          <strong style={{ ...ty('heading'), display: 'block' }}>{e.title}</strong>
          {facts.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 9 }}>
              {facts.map((x) => (
                <Chip key={x.f.key}>{x.text}</Chip>
              ))}
            </div>
          )}
          {blurb && (
            <p style={{ margin: '10px 0 0', ...ty('small'), color: 'var(--c-text-muted)' }}>{blurb}</p>
          )}
          {credits.length > 0 && (
            <p style={{ margin: '9px 0 0', fontSize: 12.5, color: 'var(--c-text-muted)' }}>
              {credits.map((x) => x.text).join(t3(' · ', ' · ', ' · '))}
            </p>
          )}
          {href && (
            <span style={{ display: 'inline-block', marginTop: 12, fontSize: 13, fontWeight: 700, color: 'var(--c-primary)' }}>
              {cta} →
            </span>
          )}
        </div>
      </Tag>
    );
  };

  /* The lead. One story given the room a front page gives its lead story: the
     photo large, the headline at display size, the standfirst under it. What
     makes a page editorial is not more styling, it is that somebody decided
     which story matters most — and the order the list is already in IS that
     decision, so the lead costs no new field. */
  const Lead = ({ e }: { e: CollectionEntry }) => {
    const href = entryHref(def, e, lang);
    const Tag = (href ? 'a' : 'div') as 'a';
    const shot = withPhoto ? photoOf(def, e) : undefined;
    const blurb = blurbOf(summary, e);
    const kickers = kickerFields.flatMap((f) => chipItems(e, f, lang, serverData?.refTitles)).slice(0, 2);
    const credits = creditFields.flatMap((f) => chipItems(e, f, lang, serverData?.refTitles)).slice(0, 2);
    return (
      <Tag
        href={href}
        className="grid gap-6 md:grid-cols-2 max-md:grid-cols-1"
        style={{ color: 'var(--c-text)', textDecoration: 'none', alignItems: 'center', marginBottom: 28 }}
      >
        {shot && (
          <span style={{ borderRadius: 'var(--r-lg)', overflow: 'hidden', display: 'block' }}>
            <EntryPhoto src={shot} alt={e.title} ratio="16 / 10" />
          </span>
        )}
        <span style={{ display: 'block' }}>
          {kickers.length > 0 && (
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 9 }}>
              {kickers.map((x, i) => (
                <Kicker key={i}>{x.text}</Kicker>
              ))}
            </span>
          )}
          <strong style={{ display: 'block', ...ty('title') }}>{e.title}</strong>
          {blurb && (
            <span style={{ display: 'block', margin: '11px 0 0', ...ty('small'), color: 'var(--c-text-muted)' }}>
              {blurb}
            </span>
          )}
          {credits.length > 0 && (
            <span style={{ display: 'block', margin: '11px 0 0', fontSize: 13, color: 'var(--c-text-muted)' }}>
              {credits.map((x) => x.text).join(' · ')}
            </span>
          )}
        </span>
      </Tag>
    );
  };

  /* Numbered pages, not "load more": page 3 of a publication has to be a URL a
     search engine can follow and a reader can share, and only a real ?page link
     is both. The click is intercepted so the rows swap in place, and the address
     bar is kept honest with pushState. A capped block (a homepage teaser) never
     pages — it asked for exactly N entries. */
  const totalPages = limit && limit > 0 ? 1 : view.live ? Math.max(1, Math.ceil(view.total / size)) : 1;

  const goto = (n: number) => {
    if (n >= 1 && n <= totalPages && n !== view.page) load(n);
  };

  const Step = ({ to, label, rel }: { to: number; label: string; rel: 'prev' | 'next' }) => {
    const off = to < 1 || to > totalPages;
    // an unavailable step is a span, not a dimmed link: a disabled anchor still
    // takes tab focus and still follows on Enter
    const Tag = (off ? 'span' : 'a') as 'a';
    return (
      <Tag
        href={off ? undefined : `?${pageKey}=${to}`}
        rel={off ? undefined : rel}
        aria-hidden={off || undefined}
        aria-label={rel === 'prev' ? t3('Previous page', '上一頁', 'Página anterior') : t3('Next page', '下一頁', 'Página siguiente')}
        onClick={(ev) => {
          ev.preventDefault();
          goto(to);
        }}
        style={{
          padding: '6px 12px',
          borderRadius: 'var(--r-md)',
          border: '1px solid var(--c-border)',
          color: off ? 'var(--c-text-muted)' : 'var(--c-text)',
          textDecoration: 'none',
          fontSize: 14,
          opacity: off ? 0.45 : 1,
        }}
      >
        {label}
      </Tag>
    );
  };

  const pager =
    totalPages > 1 ? (
      <nav
        aria-label={t3('Pages', '分頁', 'Páginas')}
        style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', marginTop: 26 }}
      >
        <Step to={view.page - 1} label="←" rel="prev" />
        {pageWindow(view.page, totalPages).map((n, i) =>
          n === 0 ? (
            <span key={`gap${i}`} aria-hidden style={{ color: 'var(--c-text-muted)', padding: '0 2px' }}>
              …
            </span>
          ) : (
            <a
              key={n}
              href={`?${pageKey}=${n}`}
              aria-current={n === view.page ? 'page' : undefined}
              onClick={(ev) => {
                ev.preventDefault();
                goto(n);
              }}
              style={{
                minWidth: 34,
                textAlign: 'center',
                padding: '6px 10px',
                borderRadius: 'var(--r-md)',
                border: '1px solid var(--c-border)',
                fontSize: 14,
                fontWeight: n === view.page ? 700 : 500,
                textDecoration: 'none',
                background: n === view.page ? 'var(--c-primary)' : 'transparent',
                color: n === view.page ? 'var(--c-primary-fg)' : 'var(--c-text)',
              }}
            >
              {n}
            </a>
          ),
        )}
        <Step to={view.page + 1} label="→" rel="next" />
      </nav>
    ) : null;

  /* The band goes above whatever layout follows. Its "view all" points at the
     page that lists this type, which every content type gets when it is
     created — so the link cannot point at a 404. */
  const bandTitle = (lang === 'zh' ? headingZh || heading : heading)?.trim();
  /* A filtered band's way out is the target's own page — the full version of
     precisely what the band is showing. Every entry of a type with detail pages
     has one, so this link cannot 404. */
  const aimed = splitRef(refFilter);
  const aimedField = aimed ? def.fields.find((f) => f.key === aimed.key) : undefined;
  const aimedAt = aimedField ? siteCollection(refTargetOf(aimedField)) : undefined;
  const aimedHref =
    aimed && aimedAt && aimedAt.detailPage !== false ? urlPath(aimedAt.slug, aimed.slug) : undefined;
  const bandHref = aimedHref ?? (site.pages.some((p) => p.slug === `/${def.slug}`) ? `/${def.slug}` : undefined);
  const listHref = bandHref ? localePath(lang as SiteLocale, bandHref) : undefined;
  const band = bandTitle ? (
    <Band title={bandTitle} href={listHref} all={t3('View all', '看全部', 'Ver todo')} />
  ) : null;

  if (layout === 'lead') {
    const [first, ...rest] = shown;
    return (
      <>
        <div ref={rootRef} className={className} style={style}>
          {band}
          {first && <Lead e={first} />}
          <div className="grid gap-5 md:grid-cols-3 max-md:grid-cols-1">
            {rest.map((e) => (
              <Card key={e.slug} e={e} />
            ))}
          </div>
        </div>
        {pager}
      </>
    );
  }

  if (layout === 'rows')
    return (
      <>
        <div ref={rootRef} className={className} style={style}>
          {band}
          {shown.map((e) => {
            const href = entryHref(def, e, lang);
            const Tag = (href ? 'a' : 'div') as 'a';
            const facts = chips(def, e, lang, skip).slice(0, 3);
            const blurb = blurbOf(summary, e);
            return (
              <Tag
                key={e.slug}
                href={href}
                style={{
                  display: 'flex',
                  gap: 14,
                  alignItems: 'center',
                  padding: '15px 0',
                  borderBottom: '1px solid var(--c-border)',
                  color: 'var(--c-text)',
                  textDecoration: 'none',
                }}
              >
                {withPhoto && (
                  <span style={{ width: 62, flexShrink: 0, borderRadius: 'var(--r-md)', overflow: 'hidden', display: 'block' }}>
                    <EntryPhoto src={photoOf(def, e)} alt={e.title} ratio="1 / 1" />
                  </span>
                )}
                <span style={{ flex: 1, minWidth: 0 }}>
                  <strong className="font-heading" style={{ fontSize: 16 }}>{e.title}</strong>
                  {blurb && (
                    <span
                      style={{
                        display: 'block',
                        fontSize: 13,
                        color: 'var(--c-text-muted)',
                        marginTop: 3,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {blurb}
                    </span>
                  )}
                </span>
                <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {facts.map((x) => (
                    <Chip key={x.f.key}>{x.text}</Chip>
                  ))}
                </span>
                {href && <span style={{ color: 'var(--c-primary)', fontWeight: 700, fontSize: 15 }}>→</span>}
              </Tag>
            );
          })}
        </div>
        {pager}
      </>
    );

  if (layout === 'grid')
    return (
      <>
        <div ref={rootRef} className={className} style={style}>
          {band}
          <div className="columns-1 md:columns-2 lg:columns-3 gap-5">
            {shown.map((e) => (
              <div key={e.slug} className="break-inside-avoid" style={{ marginBottom: 20 }}>
                <Card e={e} />
              </div>
            ))}
          </div>
        </div>
        {pager}
      </>
    );

  return (
    <>
      <div ref={rootRef} className={className} style={style}>
        {band}
        <div className="grid gap-5 md:grid-cols-3 max-md:grid-cols-1">
          {shown.map((e) => (
            <Card key={e.slug} e={e} />
          ))}
        </div>
      </div>
      {pager}
    </>
  );
}

/* ── detail body (rendered by /[collection]/[entry]) ───────── */

/** "Stories by Maria" reads right for a credit, "Stories in Coffee" for a
    grouping, and the name the merchant gave the field is the only signal there
    is — a credit field is called author, chef, stylist, agent. Chinese needs no
    such split, because 的 carries both. */
const CREDIT =
  /author|writer|byline|chef|stylist|instructor|teacher|coach|agent|artist|host|photographer|reporter|editor|owner|staff|作者|撰稿|講師|老師|設計師|主廚|攝影/i;

export function RtCollectionDetail({
  entry,
  backrefs,
  refTitles,
  notes,
  className,
  style,
}: Sty & {
  entry?: CollectionEntry;
  /** everything pointing AT this entry, loaded by the detail route */
  backrefs?: EntryBackref[];
  /** `collection/slug` → title for every entry this one points at. A slug that
      is missing here has no published row, and renders as nothing. */
  refTitles?: Record<string, string>;
  /** corrections and editors' notes, oldest first — the record, in order */
  notes?: EntryNote[];
}) {
  const { lang } = useSiteLang();
  const t3 = (en: string, zh: string, es: string) => (lang === 'es' ? es : lang === 'zh' ? zh : en);

  // placed on an ordinary page there is no entry to show — say so rather than
  // rendering an empty frame the merchant cannot debug
  if (!entry)
    return (
      <div className={className} style={style}>
        <Empty
          text={t3(
            'This block shows one entry, on that entry’s own page.',
            '這個區塊只在單一項目的專屬頁面上顯示該項目內容。',
            'Este bloque muestra una entrada en su propia página.',
          )}
        />
      </div>
    );

  const def = siteCollection(entry.collection ?? '');
  const fields = def?.fields ?? [];
  const roles = def ? fieldRoles(def) : new Map<string, FieldRole>();
  const roleOf = (f: SiteCollectionField): FieldRole => roles.get(f.key) ?? 'field';
  const of = (r: FieldRole) => fields.filter((f) => roleOf(f) === r);

  /* The fields sorted into the parts of a page a reader recognises. A content
     type that declares no roles lands entirely in `facts` and the field loop,
     which is the labelled rendering this component has always done — declaring
     a role is what turns "Byline: Maria Reyes" into "By Maria Reyes". */
  const cover = fields.find((f) => roleOf(f) === 'cover');
  const photo = cover ? (entry.data[cover.key] as string | undefined) : undefined;
  const items = (f: SiteCollectionField) => chipItems(entry, f, lang, refTitles);
  const standfirst = of('standfirst')
    .map((f) => blurbOf(f, entry) || fieldText(f, entry.data[f.key], lang))
    .find(Boolean);
  const bylines = of('byline').flatMap(items);
  const metas = of('meta').flatMap(items);
  const tags = of('chip').flatMap(items);
  const flags = of('flag').filter((f) => !!entry.data[f.key]);
  const body = of('body');
  const facts = of('field')
    .filter((f) => SCALAR.includes(f.kind))
    .map((f) => ({ f, text: fieldText(f, entry.data[f.key], lang) }))
    .filter((x) => x.text !== '');
  const mins = readingMinutes(body.map((f) => String(entry.data[f.key] ?? '')).join(' '));
  /* Rendered on the server against the server's clock. A relative time computed
     in the browser would differ from the HTML a crawler and a cache already hold,
     and React would warn about the mismatch on every running story. */
  const updated = meaningfullyUpdated(entry.publishedAt, entry.updatedAt)
    ? newsTime(entry.updatedAt, Date.now(), lang)
    : '';
  /* The back edge, and the whole of taxonomy: everything that points AT this
     entry is what makes /authors/maria an author page. No new route and no new
     table — the entries of another content type, filtered by the field that
     points here, paged through the same list block. Shown only when something
     actually points back. */
  const archives = (backrefs ?? [])
    .map((g) => ({ g, col: siteCollection(g.collection) }))
    .filter((x): x is { g: EntryBackref; col: SiteCollection } => !!x.col && x.g.entries.length > 0);

  return (
    <>
      <article className={className} style={style}>
        {photo && (
          <div style={{ borderRadius: 'var(--r-lg)', overflow: 'hidden', marginBottom: 22 }}>
            <EntryPhoto src={photo} alt={entry.title} ratio="16 / 8" />
          </div>
        )}
        {(tags.length > 0 || flags.length > 0) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, margin: '0 0 10px' }}>
            {flags.map((f) => {
              const word = flagWord(f, entry.data[f.key], lang);
              return (
                <Flag key={f.key} tone={LOUD.test(`${f.key} ${f.label} ${word}`) ? 'live' : 'note'}>
                  {word}
                </Flag>
              );
            })}
            {tags.map((x, i) => (
              <Kicker key={i} href={x.href}>
                {x.text}
              </Kicker>
            ))}
          </div>
        )}
        <h1 style={{ ...ty('hero'), margin: '0 0 10px' }}>{entry.title}</h1>
        {standfirst && (
          <p style={{ ...ty('heading'), color: 'var(--c-text-muted)', margin: '0 0 16px' }}>{standfirst}</p>
        )}
        {/* Credit, then the small print — one line, the way a masthead sets it.
            A byline is written "By Maria Reyes", never "Byline: Maria Reyes":
            the label belongs to the form the writer fills in, not to the page a
            reader opens. */}
        {(bylines.length > 0 || metas.length > 0 || body.length > 0) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 10px', ...ty('small'), color: 'var(--c-text-muted)', margin: '0 0 24px' }}>
            {bylines.length > 0 && (
              <span>
                {t3('By ', '文｜', 'Por ')}
                {bylines.map((x, i) => (
                  <Fragment key={i}>
                    {i > 0 && <span>{t3(', ', '、', ', ')}</span>}
                    {x.href ? (
                      <a href={x.href} style={{ color: 'inherit', fontWeight: 600, textDecoration: 'none' }}>
                        {x.text}
                      </a>
                    ) : (
                      <span style={{ fontWeight: 600 }}>{x.text}</span>
                    )}
                  </Fragment>
                ))}
              </span>
            )}
            {metas.map((x, i) => (
              <span key={i} aria-hidden={false}>
                <span aria-hidden style={{ marginRight: 10 }}>
                  ·
                </span>
                {x.text}
              </span>
            ))}
            {updated && (
              <span>
                <span aria-hidden style={{ marginRight: 10 }}>
                  ·
                </span>
                {t3('Updated ', '更新於 ', 'Actualizado ')}
                {updated}
              </span>
            )}
            {body.length > 0 && (
              <span>
                <span aria-hidden style={{ marginRight: 10 }}>
                  ·
                </span>
                {t3(`${mins} min read`, `閱讀約 ${mins} 分鐘`, `${mins} min de lectura`)}
              </span>
            )}
          </div>
        )}
        {facts.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '0 0 24px' }}>
            {facts.map((x) => (
              <Chip key={x.f.key}>
                <span style={{ color: 'var(--c-text-muted)' }}>{lang === 'zh' ? x.f.labelZh : x.f.label}: </span>
                {x.text}
              </Chip>
            ))}
          </div>
        )}
        {fields.map((f) => {
          const v = entry.data[f.key];
          const role = roleOf(f);
          // everything with a reader-facing identity is already placed above
          if (role !== 'field' && role !== 'body') return null;
          if (v === null || v === undefined || v === '') return null;
          if (LONG.includes(f.kind)) {
            // A body IS the page; printing "Story" over it is the form leaking
            // onto the page. With no label the writer's own headings become the
            // top level, so the outline stays honest either way.
            const label = role !== 'body' && f.kind === 'richtext' && (
              <h2 className="font-heading" style={{ fontSize: 18, margin: '0 0 8px' }}>
                {lang === 'zh' ? f.labelZh : f.label}
              </h2>
            );
            const level = role === 'body' ? 2 : 3;
            if (isMarked(f, v))
              return String(v).trim() ? (
                <section key={f.key} style={{ margin: '0 0 24px' }}>
                  {label}
                  <RichText text={String(v)} palette={SITE_RICH} level={level} style={{ fontSize: 16, lineHeight: 1.7 }} />
                </section>
              ) : null;
            const paras = paragraphs(v);
            if (paras.length === 0) return null;
            return (
              <section key={f.key} style={{ margin: '0 0 24px' }}>
                {label}
                {paras.map((p, i) => (
                  <p key={i} style={{ margin: '0 0 12px', fontSize: role === 'body' ? 17 : 16, lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>
                    {p}
                  </p>
                ))}
              </section>
            );
          }
          if (f.kind === 'gallery') {
            const shots = galleryOf(v);
            if (shots.length === 0) return null;
            return (
              <div key={f.key} className="grid gap-3 md:grid-cols-3 max-md:grid-cols-2" style={{ margin: '0 0 24px' }}>
                {shots.map((src, i) => (
                  <span key={i} style={{ borderRadius: 'var(--r-md)', overflow: 'hidden', display: 'block' }}>
                    <EntryPhoto src={src} alt={`${entry.title} ${i + 1}`} ratio="1 / 1" />
                  </span>
                ))}
              </div>
            );
          }
          if (f.kind === 'image')
            return (
              <div key={f.key} style={{ borderRadius: 'var(--r-md)', overflow: 'hidden', margin: '0 0 24px' }}>
                <EntryPhoto src={String(v)} alt={f.label} />
              </div>
            );
          if (f.kind === 'url' || f.kind === 'email') {
            const href = f.kind === 'email' ? `mailto:${String(v)}` : String(v);
            return (
              <p key={f.key} style={{ margin: '0 0 24px' }}>
                <a className="ls-btn" href={href}>
                  {lang === 'zh' ? f.labelZh : f.label}
                </a>
              </p>
            );
          }
          // an edge to another entry: its title, linked to its page. A slug whose
          // row is gone resolves to nothing, so the reader never meets a dead link
          if (REF_KINDS.has(f.kind)) {
            const target = siteCollection(refTargetOf(f));
            const links = refSlugs(v)
              .map((s) => ({ slug: s, title: refTitles?.[refKey(target?.slug ?? '', s)] }))
              .filter((x) => !!x.title);
            if (!target || links.length === 0) return null;
            return (
              <p key={f.key} style={{ margin: '0 0 16px', fontSize: 15, lineHeight: 1.7 }}>
                <span style={{ color: 'var(--c-text-muted)' }}>{lang === 'zh' ? f.labelZh : f.label}: </span>
                {links.map((l, i) => (
                  <Fragment key={l.slug}>
                    {i > 0 && <span style={{ color: 'var(--c-text-muted)' }}>, </span>}
                    {target.detailPage === false ? (
                      <span style={{ fontWeight: 600 }}>{l.title}</span>
                    ) : (
                      <a
                        href={localePath(lang as SiteLocale, urlPath(target.slug, l.slug))}
                        style={{ color: 'var(--c-primary)', fontWeight: 600, textDecoration: 'none' }}
                      >
                        {l.title}
                      </a>
                    )}
                  </Fragment>
                ))}
              </p>
            );
          }
          return null;
        })}
        {(notes ?? []).length > 0 && (
          <section
            aria-label={t3('Corrections and notes', '更正與編者說明', 'Correcciones y notas')}
            style={{ marginTop: 34, borderTop: '2px solid var(--c-text)', paddingTop: 14 }}
          >
            {(notes ?? []).map((n) => (
              <div key={n.id} style={{ marginBottom: 14 }}>
                <span style={{ ...ty('micro'), textTransform: 'uppercase', color: 'var(--c-primary)' }}>
                  {NOTE_LABEL[n.kind]?.[lang === 'zh' ? 1 : 0] ?? n.kind}
                </span>
                <span style={{ ...ty('small'), color: 'var(--c-text-muted)', marginLeft: 10 }}>
                  {new Intl.DateTimeFormat(lang === 'zh' ? 'zh-TW' : lang === 'es' ? 'es-US' : 'en-US', {
                    dateStyle: 'long',
                    timeStyle: 'short',
                    timeZone: site.business.timezone,
                  }).format(new Date(n.createdAt))}
                  {n.author ? ` · ${n.author}` : ''}
                </span>
                <p style={{ ...ty('body'), margin: '6px 0 0' }}>
                  {(lang === 'zh' ? n.bodyZh || n.body : n.body)}
                </p>
              </div>
            ))}
          </section>
        )}
      </article>
      {archives.map(({ g, col }) => {
        const f = col.fields.find((x) => x.key === g.field);
        const name = lang === 'zh' ? col.nameZh : col.name;
        const credit = CREDIT.test(`${g.field} ${f?.label ?? ''} ${f?.labelZh ?? ''}`);
        return (
          <section key={`${g.collection}.${g.field}`} style={{ marginTop: 46 }}>
            <h2 style={{ ...ty('title'), margin: '0 0 14px' }}>
              {t3(
                `${name} ${credit ? 'by' : 'in'} ${entry.title}`,
                `${entry.title}的${name}`,
                `${name} ${credit ? 'de' : 'en'} ${entry.title}`,
              )}
            </h2>
            {/* A section front is composed, not listed: one story leads and the
                rest follow. Editorial types get that; a directory of job posts
                or course dates is better served by rows, so the type's own body
                role decides rather than a switch nobody would find. */}
            <RtCollectionList
              collection={g.collection}
              layout={col.fields.some((x) => x.role === 'body') ? 'lead' : 'rows'}
              serverData={{ entries: g.entries, total: g.total, refTitles }}
              refFilter={`${g.field}:${entry.slug}`}
            />
          </section>
        );
      })}
    </>
  );
}

/* Whoever opens a preview link has to be told, in the page and not in the
   covering email, that this is not the published story. A source who quotes a
   draft back at a reporter has been misled by us, not by them.

   It lives here rather than in the route because the reader's language is
   client state: a server render is always English, so a banner rendered there
   would stay English for a Chinese reader while the story around it switched. */
export function RtPreviewBanner({
  status,
  publishedAt,
  timezone,
}: {
  status: string;
  publishedAt: string | null;
  timezone?: string;
}) {
  const { lang, pick } = useSiteLang();
  const when = status === 'PUBLISHED' && publishedAt ? new Date(publishedAt) : null;
  const at =
    when && !Number.isNaN(when.getTime())
      ? new Intl.DateTimeFormat(lang === 'zh' ? 'zh-TW' : lang === 'es' ? 'es-US' : 'en-US', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: timezone || 'UTC',
        }).format(when)
      : null;
  return (
    <div
      style={{
        border: '1px solid var(--c-border)',
        borderLeft: '3px solid var(--c-primary)',
        padding: '10px 14px',
        marginBottom: 24,
        fontSize: 13.5,
        lineHeight: 1.55,
        color: 'var(--c-muted)',
        background: 'var(--c-surface)',
      }}
    >
      <strong style={{ color: 'var(--c-text)' }}>
        {pick('Preview of an unpublished story', '尚未發布的預覽', 'Vista previa de un artículo sin publicar')}
      </strong>{' '}
      ·{' '}
      {at
        ? pick(`scheduled for ${at}`, `預定於 ${at} 上線`, `programado para ${at}`)
        : pick(
            'this link expires, please do not forward it',
            '此連結會過期,請勿轉寄',
            'este enlace caduca, por favor no lo reenvíe',
          )}
    </div>
  );
}

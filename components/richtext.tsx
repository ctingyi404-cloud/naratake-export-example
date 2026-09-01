/* The one long-form text renderer: the RichText block, every richtext field a
   content type defines, and the writing preview in the back office all come
   through here, so a merchant sees one set of marks and one result everywhere.

   The marks, each of which owns its own line (a blank line ends a block):
     **bold**   *italic*   [text](https://example.com)
     # Heading   ## Smaller heading   ### Smallest heading
     > Pull quote
     - Bullet
     1. Numbered step
     ![What the photo shows](https://example.com/photo.jpg)
     ---   divider

   SECURITY: every mark becomes a React ELEMENT. Nothing here assembles an HTML
   string and nothing calls dangerouslySetInnerHTML, so merchant text can never
   introduce markup — React escapes it as text. Link and image targets pass a
   scheme allowlist on top of that, which is what keeps a pasted `javascript:`
   URL from becoming a live link.

   Twin of packages/components/src/richtext.tsx, which the editor canvas renders.
   The whole file MUST stay identical below the imports — change one, change the
   other, or preview stops equalling export. The parity harness
   (apps/desktop/src/parity/verify-inline-markup.ts and verify-basics.ts)
   renders both twins over one case table and fails on any drift. */

import type { CSSProperties, ReactNode } from 'react';

/** the four colors and one font this renderer needs, named by role — the site
    passes its CSS tokens, the canvas passes theme values, the back office its
    own admin tokens, and the markup stays identical in all three */
export interface RichPalette {
  heading: string;
  border: string;
  muted: string;
  accent: string;
  radius: string | number;
}

/** Targets that cannot execute: same-page anchors, same-site paths, and the
    four schemes a merchant actually writes. Anything else is not a link. */
export function safeHref(raw: string): string | null {
  const s = raw.trim();
  if (/^(?:[#/]|\.\.?\/)/.test(s)) return s;
  return /^(?:https?|mailto|tel):/i.test(s) ? s : null;
}

/** a target that leaves this site opens in a new tab (`//host` counts) */
const leavesSite = (href: string) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href);

/* Interpolated CJK names inside Latin copy break mid-word ("…at 咖啡\n廳.");
   wrap short CJK runs in nowrap spans. Pure-CJK strings keep normal wrapping.
   Lives here because body copy (renderInlineMarkup) and long-form prose share
   the same purity rules — defs and runtime import it, never keep copies. */
export function cjkNoWrap(text: string): ReactNode {
  if (!/[A-Za-z]/.test(text)) return text;
  const parts = text.split(/([㐀-鿿]{2,8})/);
  if (parts.length === 1) return text;
  return parts.map((p, i) => (i % 2 ? <span key={i} style={{ whiteSpace: 'nowrap' }}>{p}</span> : p));
}

/** understated, theme-free dress for a link inside body copy: the same string
    renders under three CSS environments (canvas, preview, exported site) and
    an inline style is the only thing all three share — `inherit` keeps the
    link readable on any scrim or section tone */
const LINK_STYLE: CSSProperties = {
  color: 'inherit',
  textDecorationLine: 'underline',
  textDecorationThickness: 1,
  textUnderlineOffset: '0.18em',
};

/* ── inline marks ──────────────────────────────────────────── */

/** `body` is the paragraph subset Text/Heading render: an image mark stays
    literal text (a paragraph is no place for an <img>), links carry LINK_STYLE
    and — on the edit canvas (`deadLinks`) — no href, and every plain fragment
    including a mark's contents passes through cjkNoWrap AFTER parsing, so a
    nowrap span can never split a mark's syntax. Without `body`, behavior is
    the long-form renderer's, unchanged. */
export function renderInline(text: string, body?: { deadLinks?: boolean }): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /!\[([^\]]*)\]\(([^)\s]+)\)|\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  const plain = body ? cjkNoWrap : (s: string): ReactNode => s;
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(plain(text.slice(last, m.index)));
    if (body && m[1] !== undefined) {
      out.push(m[0]);
    } else if (m[1] !== undefined) {
      const src = safeHref(m[2]);
      // an unusable source still leaves the description readable, never a gap
      out.push(
        src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`m${k++}`}
            src={src}
            alt={m[1]}
            loading="lazy"
            decoding="async"
            // markdown images carry no intrinsic size, so reserve a 3:2 box
            // before load (CLS); `auto` hands layout back to the photo's real
            // ratio the moment it arrives
            style={{ width: '100%', height: 'auto', aspectRatio: 'auto 3 / 2' }}
          />
        ) : (
          m[1]
        ),
      );
    } else if (m[3] !== undefined) out.push(<strong key={`b${k++}`}>{plain(m[3])}</strong>);
    else if (m[4] !== undefined) out.push(<em key={`i${k++}`}>{plain(m[4])}</em>);
    else {
      const href = safeHref(m[6]);
      out.push(
        href ? (
          <a
            key={`a${k++}`}
            href={body?.deadLinks ? undefined : href}
            style={body ? LINK_STYLE : undefined}
            {...(!body?.deadLinks && leavesSite(href) ? { target: '_blank', rel: 'noreferrer' } : {})}
          >
            {plain(m[5])}
          </a>
        ) : (
          plain(m[5])
        ),
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(plain(text.slice(last)));
  return out;
}

/* ── body copy ─────────────────────────────────────────────
   The three marks a paragraph or heading supports: **bold**, *italic*,
   [text](url) — nothing more. One parser, three readers: the canvas
   Text/Heading defs, the exported RtText/RtHeading, and LocText's live
   bilingual re-render all call this same function, so the words can never
   drift between surfaces. A string with no marks returns exactly what
   cjkNoWrap always rendered — existing sites do not change. `deadLinks` is
   the edit canvas, where a live href would navigate the editor itself. */

export function renderInlineMarkup(text: string, deadLinks?: boolean): ReactNode {
  return renderInline(text, { deadLinks });
}

/** The words renderInlineMarkup paints, marks resolved away — the canvas
    inline editor uses this to recognize on-screen text as a prop's rendering
    (and swap in the raw source, so an edit can't silently strip the marks). */
export function inlineMarkupText(text: string): string {
  const re = /!\[([^\]]*)\]\(([^)\s]+)\)|\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out += text.slice(last, m.index) + (m[1] !== undefined ? m[0] : (m[3] ?? m[4] ?? m[5] ?? ''));
    last = m.index + m[0].length;
  }
  return out + text.slice(last);
}

/* ── blocks ────────────────────────────────────────────────── */

export type RichBlock =
  | { t: 'p' | 'quote'; text: string }
  | { t: 'ul'; items: string[] }
  | { t: 'ol'; items: string[]; start: number }
  | { t: 'h'; level: number; text: string }
  | { t: 'img'; alt: string; src: string }
  | { t: 'hr' };

const HEAD = /^(#{1,3})\s+(.+)$/;
const BULLET = /^-\s+(.+)$/;
const NUMBER = /^(\d{1,3})[.)]\s+(.+)$/;
const QUOTE = /^>\s?(.*)$/;
const RULE = /^-{3,}$/;
const IMAGE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;

/** kinds that never merge with the next line, however alike */
const SOLO = new Set(['h', 'img', 'hr']);

function kindOf(line: string): RichBlock['t'] {
  const s = line.trim();
  if (RULE.test(s)) return 'hr'; // before the bullet: "- " needs the space
  if (HEAD.test(s)) return 'h';
  if (IMAGE.test(s)) return 'img';
  if (QUOTE.test(s)) return 'quote';
  if (BULLET.test(s)) return 'ul';
  if (NUMBER.test(s)) return 'ol';
  return 'p';
}

function build(t: RichBlock['t'], lines: string[]): RichBlock {
  const body = lines.map((l) => l.trim());
  switch (t) {
    case 'ul':
      return { t, items: body.map((l) => BULLET.exec(l)![1]) };
    case 'ol':
      // the writer's own first number starts the list: a "3." after a photo
      // continues the recipe instead of silently restarting at one
      return { t, items: body.map((l) => NUMBER.exec(l)![2]), start: Number(NUMBER.exec(body[0])![1]) || 1 };
    case 'quote':
      return { t, text: body.map((l) => QUOTE.exec(l)![1]).join('\n') };
    case 'h': {
      const m = HEAD.exec(body[0])!;
      return { t, level: m[1].length, text: m[2] };
    }
    case 'img': {
      const m = IMAGE.exec(body[0])!;
      return { t, alt: m[1], src: m[2] };
    }
    case 'hr':
      return { t };
    default:
      // raw lines, not trimmed: the paragraph renders pre-wrap, so a line break
      // the writer typed is a line break the reader sees
      return { t: 'p', text: lines.join('\n') };
  }
}

/** Text to blocks. A run of like lines is one block; a blank line ends it. */
export function richBlocks(text: string): RichBlock[] {
  const out: RichBlock[] = [];
  let run: string[] = [];
  let kind: RichBlock['t'] | null = null;
  const flush = () => {
    if (kind && run.length) out.push(build(kind, run));
    run = [];
    kind = null;
  };
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) {
      flush();
      continue;
    }
    const k = kindOf(line);
    if (k !== kind || SOLO.has(k)) flush();
    kind = k;
    run.push(line);
  }
  flush();
  return out;
}

/** One plain line for a card blurb or a meta description: the marks are removed
    rather than shown, and a heading is skipped because it labels the story
    rather than telling it. */
export function richExcerpt(text: string): string {
  for (const b of richBlocks(text)) {
    const raw =
      b.t === 'p' || b.t === 'quote' ? b.text : b.t === 'ul' || b.t === 'ol' ? b.items.join(' · ') : '';
    const s = raw && stripMarks(raw);
    if (s) return s;
  }
  return '';
}

const stripMarks = (s: string) =>
  s
    .replace(/!\[([^\]]*)\]\([^)\s]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

/** Entries written before these marks existed arrived as light HTML from the
    old editor. They keep their old flattened rendering, so a page a merchant
    published years ago does not change under them today. */
export function isLegacyHtml(text: string): boolean {
  return /<\/?(?:p|div|br|h[1-6]|ul|ol|li|strong|em|b|i|a|img|blockquote|span|figure|table)\b[^>]*>/i.test(text);
}

/* ── render ────────────────────────────────────────────────── */

const LIST: CSSProperties = {
  margin: 0,
  paddingLeft: 22,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

export function RichText({
  text,
  palette,
  level = 2,
  className,
  style,
}: {
  text: string;
  palette: RichPalette;
  /** heading level the biggest `#` maps to — 2 in a page, 3 under a field label */
  level?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 14, ...style }}>
      {richBlocks(text).map((b, i) => {
        switch (b.t) {
          case 'h': {
            const Tag = `h${Math.min(6, level + b.level - 1)}` as 'h2';
            return (
              <Tag
                key={i}
                style={{
                  margin: 0,
                  fontFamily: palette.heading,
                  fontWeight: 700,
                  lineHeight: 1.25,
                  // em, so a heading scales with whatever size the block is set to
                  fontSize: b.level === 1 ? '1.5em' : b.level === 2 ? '1.25em' : '1.08em',
                }}
              >
                {renderInline(b.text)}
              </Tag>
            );
          }
          case 'quote':
            return (
              <blockquote
                key={i}
                style={{
                  margin: 0,
                  paddingLeft: 16,
                  borderLeft: `3px solid ${palette.accent}`,
                  color: palette.muted,
                  fontSize: '1.06em',
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {renderInline(b.text)}
              </blockquote>
            );
          case 'ul':
            return (
              <ul key={i} style={{ ...LIST, listStyle: 'disc' }}>
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i} start={b.start} style={{ ...LIST, listStyle: 'decimal' }}>
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it)}</li>
                ))}
              </ol>
            );
          case 'img': {
            const src = safeHref(b.src);
            return src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={src}
                alt={b.alt}
                loading="lazy"
                decoding="async"
                style={{ width: '100%', height: 'auto', display: 'block', borderRadius: palette.radius }}
              />
            ) : null;
          }
          case 'hr':
            return <hr key={i} style={{ border: 0, borderTop: `1px solid ${palette.border}`, width: '100%', margin: 0 }} />;
          default:
            return (
              <p key={i} style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                {renderInline(b.text)}
              </p>
            );
        }
      })}
    </div>
  );
}

/** the marks, written where the person typing them can read them */
export const RICH_HINT_EN =
  '**bold** · *italic* · [text](https://link) · # Heading · > Quote · - Bullet · 1. Numbered · ![photo description](url) · --- divider. Leave a blank line between blocks.';
export const RICH_HINT_ZH =
  '**粗體** · *斜體* · [文字](https://連結) · # 標題 · > 引言 · - 項目符號 · 1. 編號 · ![照片說明](網址) · --- 分隔線。段落之間空一行。';

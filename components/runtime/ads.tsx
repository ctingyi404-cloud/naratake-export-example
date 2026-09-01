'use client';

/* A sold space, as a reader meets it.

   Three rules the block will not let a publisher break. The label is always
   drawn — an ad a reader cannot tell is an ad costs a publication its readers
   once, permanently. The click leaves through the site's own route, so the
   number the publisher invoices from and the number the advertiser measures are
   the same event. And an unsold slot is never a hole: it falls back to the
   house copy the page author wrote, which is what a real paper prints when
   nobody bought the back page. */

import { useEffect, useState, type CSSProperties } from 'react';
import { apiGet } from '@/lib/client';
import { useSiteLang } from '@/lib/site-i18n';

const ty = (role: 'title' | 'heading' | 'body' | 'small' | 'micro'): CSSProperties => ({
  fontSize: `var(--t-${role})`,
  lineHeight: `var(--t-${role}-lh)`,
  letterSpacing: `var(--t-${role}-tr)`,
  fontWeight: `var(--t-${role}-w)` as unknown as number,
  fontFamily: `var(--t-${role}-f)`,
});

export interface AdCreativeView {
  id: string;
  advertiser: string;
  imageUrl: string | null;
  alt: string;
  headline: string | null;
  body: string | null;
  label: string;
}

export interface RtAdSlotProps {
  slotKey?: string;
  /** what the space says while nobody has bought it */
  houseHeadline?: string;
  houseHeadlineZh?: string;
  houseBody?: string;
  houseBodyZh?: string;
  houseLabel?: string;
  houseLabelZh?: string;
  houseHref?: string;
  /** hide the block entirely rather than print house copy */
  hideWhenUnsold?: boolean;
  className?: string;
  style?: CSSProperties;
}

function Label({ text }: { text: string }) {
  return (
    <span
      style={{
        ...ty('micro'),
        display: 'inline-block',
        textTransform: 'uppercase',
        letterSpacing: '0.14em',
        color: 'var(--c-text-muted)',
        borderBottom: '1px solid var(--c-border)',
        paddingBottom: 4,
        marginBottom: 10,
        width: '100%',
      }}
    >
      {text}
    </span>
  );
}

export function RtAdSlot(props: RtAdSlotProps) {
  const { lang } = useSiteLang();
  const zh = lang === 'zh';
  const [ad, setAd] = useState<AdCreativeView | null>(null);
  const [asked, setAsked] = useState(false);
  const key = props.slotKey ?? '';

  /* Asked for once per mount. This request IS the impression — counting it in
     the browser and posting a second beacon would double-count every reader who
     navigates back, and lose every reader who blocks the beacon. */
  useEffect(() => {
    if (!key) {
      setAsked(true);
      return;
    }
    let alive = true;
    apiGet<{ ad: AdCreativeView | null }>(`/ads/slot/${encodeURIComponent(key)}`)
      .then((r) => alive && setAd(r.ad))
      .catch(() => {})
      .finally(() => alive && setAsked(true));
    return () => {
      alive = false;
    };
  }, [key]);

  const frame: CSSProperties = {
    display: 'block',
    border: '1px solid var(--c-border)',
    background: 'var(--c-surface)',
    padding: 16,
    borderRadius: 'var(--r-md)',
    textDecoration: 'none',
    color: 'var(--c-text)',
    ...props.style,
  };

  // nothing decided yet: hold the space rather than reflow the page under a reader
  if (!asked) return <div className={props.className} style={{ ...frame, minHeight: 96, opacity: 0.5 }} aria-hidden />;

  if (!ad) {
    if (props.hideWhenUnsold) return null;
    const headline = (zh && props.houseHeadlineZh) || props.houseHeadline || '';
    const body = (zh && props.houseBodyZh) || props.houseBody || '';
    if (!headline && !body) return null;
    const label = (zh && props.houseLabelZh) || props.houseLabel || (zh ? '本刊訊息' : 'FROM US');
    const inner = (
      <>
        <Label text={label} />
        {headline && <span style={{ ...ty('heading'), display: 'block' }}>{headline}</span>}
        {body && <span style={{ ...ty('small'), display: 'block', marginTop: 6, color: 'var(--c-text-muted)' }}>{body}</span>}
      </>
    );
    return props.houseHref ? (
      <a className={props.className} style={frame} href={props.houseHref}>
        {inner}
      </a>
    ) : (
      <div className={props.className} style={frame}>
        {inner}
      </div>
    );
  }

  return (
    <a
      className={props.className}
      style={frame}
      href={`/api/v1/ads/click/${encodeURIComponent(ad.id)}`}
      /* An ad is a third party's page. `rel` keeps it out of the site's own
         search standing and denies it a handle on the window it opened from. */
      rel="sponsored noopener noreferrer"
      target="_blank"
    >
      <Label text={ad.label || (zh ? '廣告' : 'SPONSORED')} />
      {ad.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={ad.imageUrl}
          alt={ad.alt || ad.advertiser}
          style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 'var(--r-sm)' }}
          loading="lazy"
        />
      ) : (
        <>
          {ad.headline && <span style={{ ...ty('heading'), display: 'block' }}>{ad.headline}</span>}
          {ad.body && <span style={{ ...ty('small'), display: 'block', marginTop: 6, color: 'var(--c-text-muted)' }}>{ad.body}</span>}
        </>
      )}
      <span style={{ ...ty('micro'), display: 'block', marginTop: 10, color: 'var(--c-text-muted)' }}>{ad.advertiser}</span>
    </a>
  );
}

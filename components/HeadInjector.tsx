'use client';

import { useEffect } from 'react';

/** Injects operator-pasted raw head HTML (Search Console meta, extra <link>s, etc.)
    into <head> on the client. Rendered nothing on the server, so it can't corrupt the
    SSR head tree the way a wrapper <div> in <head> did (that broke hydration on every
    page). Script tags are recreated so they actually execute; other nodes are cloned. */
export function HeadInjector({ html }: { html?: string }) {
  useEffect(() => {
    if (!html) return;
    const marker = 'data-ls-head';
    if (document.head.querySelector(`[${marker}]`)) return; // idempotent across nav
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    for (const node of Array.from(tpl.content.childNodes)) {
      if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'SCRIPT') {
        const src = node as HTMLScriptElement;
        const s = document.createElement('script');
        for (const attr of Array.from(src.attributes)) s.setAttribute(attr.name, attr.value);
        s.text = src.text;
        s.setAttribute(marker, '');
        document.head.appendChild(s);
      } else {
        const el = node.cloneNode(true);
        if (el.nodeType === Node.ELEMENT_NODE) (el as Element).setAttribute(marker, '');
        document.head.appendChild(el);
      }
    }
  }, [html]);
  return null;
}

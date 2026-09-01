'use client';

/* Page-level smooth scroll (Lenis) — buttery momentum for the whole site, wired
   into GSAP's ticker so ScrollTrigger (the cinema reel/focus pins) stays in sync.
   Mounted once in the layout, renders nothing. Gated on the site motion setting:
   off under motion:'off' or prefers-reduced-motion, so it never fights a11y.
   Lenis loads lazily (code-split), same discipline as three.js / gsap. */

import { useEffect } from 'react';
import { site } from '@/lib/site-config';

export function SmoothScroll() {
  useEffect(() => {
    const mode = (site as { motion?: string }).motion ?? 'lively';
    if (mode === 'off' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let killed = false;
    let cleanup: (() => void) | undefined;

    void Promise.all([import('lenis'), import('gsap'), import('gsap/ScrollTrigger')]).then(([L, g, s]) => {
      if (killed) return;
      const Lenis = (L as { default?: unknown }).default ?? (L as { Lenis?: unknown }).Lenis;
      const gsap = (g as { gsap?: typeof import('gsap').gsap; default?: unknown }).gsap ?? (g as { default: typeof import('gsap').gsap }).default;
      const ScrollTrigger = (s as { ScrollTrigger?: { update: () => void }; default?: { update: () => void } }).ScrollTrigger ?? (s as { default: { update: () => void } }).default;
      gsap.registerPlugin(ScrollTrigger as object);

      const LenisCtor = Lenis as new (opts: object) => { raf: (t: number) => void; on: (e: string, cb: () => void) => void; destroy: () => void };
      const lenis = new LenisCtor({ duration: 1.05, smoothWheel: true });
      lenis.on('scroll', () => ScrollTrigger.update());
      const tick = (time: number) => lenis.raf(time * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);

      cleanup = () => {
        gsap.ticker.remove(tick);
        lenis.destroy();
      };
    });

    return () => {
      killed = true;
      cleanup?.();
    };
  }, []);

  return null;
}

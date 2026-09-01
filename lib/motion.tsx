'use client';

/* ls-motion v2 "Cinema" — scroll-driven animation runtime, zero dependencies.
   Everything is authored through data-attributes/classes so the editor preview
   implements the exact same spec:

     .rv / .rv-stagger          entrance reveals (styled by html[data-motion-style])
     [data-split="chars|words"] split-text reveal, per-unit cascade (--ci index)
     [data-count-to]            count-up numbers
     [data-parallax="0.2"]      viewport-centre parallax drift
     [data-depth="0.4"]         alias of parallax for layered heroes
     [data-scrub]               writes --p (0→1 scroll progress) on the element:
                                  "self" (default) over its own travel,
                                  "pin" over a sticky wrapper's scroll band
     [data-scrub-video]         scrubs video.currentTime by nearest [data-scrub] --p
                                (blob-loaded so currentTime is always seekable)
     [data-draw]                SVG path draw-on-reveal ("scrub" = draw by --p)
     [data-magnetic]            pointer-magnet hover with spring return
     [data-tilt]                pointer tilt (existing)

   Intensity: html[data-motion='subtle'|'lively'|'cinematic'] scales distance,
   duration and stagger via CSS variables. All of it collapses to no-ops without
   JS or under prefers-reduced-motion. */

import { useEffect } from 'react';
import { site } from '@/lib/site-config';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : 0 + v);

export function MotionProvider() {
  useEffect(() => {
    const mode = (site as { motion?: string }).motion ?? 'lively';
    const html = document.documentElement;

    // Reduced-motion / motion:'off' — we must NOT leave the scroll-driven
    // components in their --p=0 state, because several hide their PRIMARY content
    // there (RevealImage clips to nothing, TimelineFlow cards go opacity 0,
    // FocalShot statement hides, MenuPalace shows only chamber 1). Settle every
    // scrub var to its revealed end-state and flag `.no-motion` so CSS can un-pin
    // and flatten the walk-through components. Then skip all the animation.
    if (mode === 'off' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      html.classList.add('no-motion');
      const settle = () => {
        document.querySelectorAll<HTMLElement>('[data-scrub]').forEach((el) => {
          el.style.setProperty('--p', '1');
          el.style.setProperty('--pe', '1');
        });
        document.querySelectorAll<SVGPathElement>('[data-draw] path').forEach((p) => {
          p.style.strokeDasharray = 'none';
          p.style.strokeDashoffset = '0';
        });
      };
      settle();
      // client components hydrate late — re-settle whatever mounts after us
      const mo = new MutationObserver(settle);
      mo.observe(document.body, { childList: true, subtree: true });
      return () => mo.disconnect();
    }

    html.classList.add('js-motion');
    html.dataset.motion = mode;
    html.dataset.motionStyle = (site as { motionStyle?: string }).motionStyle ?? 'rise';

    /* ── split text: wrap chars/words in spans with a cascade index ────────
       Runs before the reveal observer so split targets reveal per-unit.
       Accessibility: original text stays readable via aria-label. */
    const splitEl = (el: HTMLElement) => {
      if (el.dataset.splitDone) return;
      el.dataset.splitDone = '1';
      const by = el.dataset.split === 'words' ? 'words' : 'chars';
      const text = el.textContent ?? '';
      el.setAttribute('aria-label', text);
      el.textContent = '';
      const frag = document.createDocumentFragment();
      let ci = 0;
      const unitSpan = (u: string) => {
        const s = document.createElement('span');
        s.className = 'mo-unit';
        s.setAttribute('aria-hidden', 'true');
        s.style.setProperty('--ci', String(ci++));
        s.textContent = u;
        return s;
      };
      for (const w of text.split(/(\s+)/)) {
        if (!w) continue;
        if (/^\s+$/.test(w)) {
          frag.appendChild(document.createTextNode(w));
          continue;
        }
        if (by === 'words') {
          frag.appendChild(unitSpan(w));
        } else {
          // per-char cascade, but line breaks may only fall BETWEEN words:
          // chars live inside a nowrap word group
          const g = document.createElement('span');
          g.style.display = 'inline-block';
          // Latin words stay whole; CJK / break-less strings must wrap between
          // glyphs or a long space-less title overflows a phone frame.
          if (!/[\u3000-\u9fff\uff00-\uffef]/.test(w)) g.style.whiteSpace = 'nowrap';
          for (const ch of [...w]) g.appendChild(unitSpan(ch));
          frag.appendChild(g);
        }
      }
      el.appendChild(frag);
      el.classList.add('rv-split');
    };
    const splitAll = () =>
      document.querySelectorAll<HTMLElement>('[data-split]:not([data-split-done])').forEach(splitEl);
    splitAll();

    /* ── reveal + stagger + split + draw(reveal) ──────────── */
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('is-in');
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0, rootMargin: '0px 0px -10% 0px' },
    );
    const REVEAL_SEL = '.rv:not(.is-in), .rv-stagger:not(.is-in), .rv-split:not(.is-in)';
    const watch = () => document.querySelectorAll(REVEAL_SEL).forEach((el) => io.observe(el));
    watch();

    const vh = () =>
      window.innerHeight || document.documentElement.clientHeight || screen.availHeight || 800;
    /* stuck-hidden safety net only — scroll-driven reveals ride the cached
       rvItems path in frame() (zero layout reads); a per-scroll-event gBCR
       sweep here would force layout on every wheel tick */
    const sweep = () => {
      const line = vh() * 0.92;
      document.querySelectorAll(REVEAL_SEL).forEach((el) => {
        if (el.getBoundingClientRect().top < line) el.classList.add('is-in');
      });
    };
    sweep();
    const sweepIv = setInterval(sweep, 900);

    /* ── SVG draw: measure path length once; reveal-draw via CSS, scrub-draw
       via the scrub loop below (offset = (1 - p) * len) ─────────────────── */
    let drawPaths: { path: SVGPathElement; len: number; scrub: HTMLElement | null }[] = [];
    const prepDraw = () => {
      // rebuild from scratch every time — effect re-runs (StrictMode, view
      // switches) must never orphan already-prepped paths into a hidden state
      drawPaths = [...document.querySelectorAll<SVGPathElement>('[data-draw] path')].map((p) => {
        const len = p.getTotalLength();
        p.style.strokeDasharray = String(len);
        if (!p.dataset.drawDone) {
          p.dataset.drawDone = '1';
          p.style.strokeDashoffset = String(len);
        }
        const host = p.closest<HTMLElement>('[data-draw]');
        const scrub = host?.dataset.draw === 'scrub' ? host.closest<HTMLElement>('[data-scrub]') : null;
        if (!scrub) p.classList.add('mo-draw-reveal');
        return { path: p, len, scrub };
      });
    };
    prepDraw();

    /* ── counters ─────────────────────────────────────────── */
    const cio = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          cio.unobserve(e.target);
          const el = e.target as HTMLElement;
          const to = parseFloat(el.dataset.countTo ?? '0');
          const suffix = el.dataset.countSuffix ?? '';
          const prefix = el.dataset.countPrefix ?? '';
          const decimals = (el.dataset.countTo ?? '').includes('.') ? 1 : 0;
          const t0 = performance.now();
          const dur = 1400;
          const tick = (t: number) => {
            const p = Math.min(1, (t - t0) / dur);
            const eased = 1 - Math.pow(1 - p, 3);
            el.textContent = `${prefix}${(to * eased).toFixed(decimals)}${suffix}`;
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.5 },
    );
    document.querySelectorAll('[data-count-to]').forEach((el) => cio.observe(el));

    /* ── the scrub loop ──────────────────────────────────────
       Jank-free: element positions are MEASURED outside the scroll path
       (on load / resize / mutations / a slow interval) into doc-space
       numbers; the per-scroll frame does ZERO layout reads — just scrollY
       plus cached math. Parallax transforms are subtracted on re-measure so
       our own writes never poison the cache. */
    interface ScrubItem { el: HTMLElement; mode: string | undefined; docTop: number; height: number }
    interface DepthItem { el: HTMLElement; speed: number; docCenter: number; applied: number }
    let scrubItems: ScrubItem[] = [];
    let depthItems: DepthItem[] = [];
    let videoEls: HTMLVideoElement[] = [];
    let rvItems: { el: HTMLElement; docTop: number }[] = [];
    const appliedShift = new WeakMap<HTMLElement, number>();

    const measure = () => {
      const y = window.scrollY;
      scrubItems = [...document.querySelectorAll<HTMLElement>('[data-scrub]')].map((el) => {
        const r = el.getBoundingClientRect();
        return { el, mode: el.dataset.scrub, docTop: r.top + y, height: r.height };
      });
      depthItems = [...document.querySelectorAll<HTMLElement>('[data-parallax], [data-depth]')].map((el) => {
        const prev = appliedShift.get(el) ?? 0;
        const r = el.getBoundingClientRect();
        return {
          el,
          speed: parseFloat(el.dataset.parallax ?? el.dataset.depth ?? '0.15'),
          docCenter: r.top + y + r.height / 2 - prev,
          applied: prev,
        };
      });
      videoEls = [...document.querySelectorAll<HTMLVideoElement>('video[data-scrub-video]')];
      rvItems = [...document.querySelectorAll<HTMLElement>(REVEAL_SEL)].map((el) => {
        const r = el.getBoundingClientRect();
        return { el, docTop: r.top + y };
      });
    };
    measure();

    /* blob-load scrub videos lazily so currentTime is always seekable even on
       hosts without byte-range support (the scroll-world technique) */
    const primeVideo = (v: HTMLVideoElement) => {
      if (v.dataset.blobbed) return;
      v.dataset.blobbed = '1';
      const src = v.currentSrc || v.src;
      if (!src || src.startsWith('blob:')) return;
      fetch(src)
        .then((r) => r.blob())
        .then((b) => {
          const t = v.currentTime;
          v.src = URL.createObjectURL(b);
          v.load();
          v.currentTime = t;
        })
        .catch(() => void 0); // keep the original src; scrubbing may still work
    };

    /* ── GSAP momentum layer ─────────────────────────────────
       The loop below tracks scroll 1:1 — correct but stiff. Once GSAP loads
       (lazily, code-split like three.js), each [data-scrub] element gets a
       ScrollTrigger scrub(0.8) tween driving the SAME --p/--pe vars, so every
       scrub component gains the catch-up momentum that reads as premium —
       with zero component changes. Until then (and under no-JS) the loop
       stands in, so nothing ever depends on GSAP arriving. */
    let gsapOn = false;
    const applyP = (el: HTMLElement, p: number) => {
      el.style.setProperty('--p', p.toFixed(4));
      // eased twin for camera moves (CSS calc can't square a var)
      el.style.setProperty('--pe', (p * p * (3 - 2 * p)).toFixed(4));
      for (const v of videoEls) {
        if (v.closest<HTMLElement>('[data-scrub]') !== el) continue;
        primeVideo(v);
        if (v.duration && !v.seeking) v.currentTime = p * Math.max(0, v.duration - 0.05);
      }
      for (const d of drawPaths) {
        if (d.scrub !== el) continue;
        const at = parseFloat(d.path.dataset.drawAt ?? '');
        const lp = Number.isNaN(at) ? p : Math.min(1, Math.max(0, (p - at) * 4));
        d.path.style.strokeDashoffset = String((1 - lp) * d.len);
      }
    };

    let raf = 0;
    const frame = () => {
      const y = window.scrollY;
      const h = vh();
      for (const it of depthItems) {
        const progress = (it.docCenter - y - h / 2) / h;
        const shift = -progress * it.speed * 100;
        if (Math.abs(shift - it.applied) < 0.3) continue; // skip sub-pixel writes
        it.applied = shift;
        appliedShift.set(it.el, shift);
        it.el.style.transform = `translate3d(0, ${shift.toFixed(1)}px, 0)`;
      }
      if (!gsapOn)
        for (const it of scrubItems) {
          const top = it.docTop - y;
          const p =
            it.mode === 'pin' && it.height > h
              ? clamp01(-top / (it.height - h))
              : clamp01((h - top) / (h + it.height));
          it.el.style.setProperty('--p', p.toFixed(4));
          // eased twin for camera moves (CSS calc can't square a var)
          it.el.style.setProperty('--pe', (p * p * (3 - 2 * p)).toFixed(4));
        }
      if (!gsapOn)
        for (const v of videoEls) {
          const host = v.closest<HTMLElement>('[data-scrub]');
          if (!host) continue;
          const it = scrubItems.find((x) => x.el === host);
          if (!it) continue;
          const top = it.docTop - y;
          if (top + it.height < -h || top > h * 2) continue; // far away — stay lazy
          primeVideo(v);
          const p = parseFloat(host.style.getPropertyValue('--p') || '0');
          if (v.duration && !v.seeking) v.currentTime = p * Math.max(0, v.duration - 0.05);
        }
      if (!gsapOn)
        for (const d of drawPaths) {
          if (!d.scrub) continue;
          const p = parseFloat(d.scrub.style.getPropertyValue('--p') || '0');
          // branches can be born mid-scroll: data-draw-at="0.4" draws over p∈[at, at+0.25]
          const at = parseFloat(d.path.dataset.drawAt ?? '');
          const lp = Number.isNaN(at) ? p : Math.min(1, Math.max(0, (p - at) * 4));
          d.path.style.strokeDashoffset = String((1 - lp) * d.len);
        }
      // reveals ride the same cached scroll path — IO is just the fast path,
      // this guarantees nothing below the fold ever stays stuck hidden
      if (rvItems.length) {
        const line = y + h * 0.92;
        rvItems = rvItems.filter((it) => {
          if (it.docTop < line) {
            it.el.classList.add('is-in');
            return false;
          }
          return true;
        });
      }
    };

    /* belt & suspenders: compute synchronously on scroll (throttled) because
       rAF is suspended in low-power modes / some embedded webviews; rAF still
       smooths the in-between frames when it IS alive. Measurement re-runs on
       resize / late layout — never inside the scroll path. */
    let lastRun = 0;
    const onScroll = () => {
      const now = performance.now();
      // watchdog: GSAP renders on its rAF ticker; if the ticker heartbeat goes
      // silent while the user is actively scrolling (rAF suspended in low-power
      // webviews), permanently hand --p back to this synchronous loop
      if (gsapOn && now - tickAt > 400) {
        gsapOn = false;
        gsapKills.forEach((k) => k());
        gsapKills.length = 0;
      }
      if (now - lastRun > 90) {
        lastRun = now;
        frame();
      }
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    };
    const onResize = () => {
      measure();
      frame();
    };
    /* build one scrub tween per [data-scrub] element — start/end reproduce the
       loop's exact geometry (pin: top top→bottom bottom; self: top bottom→
       bottom top), so GSAP only adds momentum, never changes the mapping */
    let disposed = false;
    let tickAt = 0;
    const covered = new WeakSet<HTMLElement>();
    const gsapKills: (() => void)[] = [];
    type GsapMod = typeof import('gsap').gsap;
    let gsapRt: GsapMod | null = null;
    let stRt: { refresh: () => void } | null = null;
    let lastSH = 0;
    const coverScrubEls = () => {
      if (!gsapRt) return false;
      let added = false;
      document.querySelectorAll<HTMLElement>('[data-scrub]').forEach((el) => {
        if (covered.has(el)) return;
        covered.add(el);
        added = true;
        // mirror the loop's guard: pin geometry only while the element is
        // actually taller than the viewport — cinema.css flattens pinned
        // components at ≤1024px, and a flattened (short) element must use the
        // self mapping or its progress would be wrong on touch layouts.
        // Function positions re-evaluate on every ScrollTrigger.refresh().
        const isPin = () => el.dataset.scrub === 'pin' && el.offsetHeight > vh();
        const proxy = { p: 0 };
        const tw = gsapRt!.to(proxy, {
          p: 1,
          ease: 'none',
          scrollTrigger: {
            trigger: el,
            start: () => (isPin() ? 'top top' : 'top bottom'),
            end: () => (isPin() ? 'bottom bottom' : 'bottom top'),
            scrub: 0.8,
            invalidateOnRefresh: true,
          },
          /* ScrollTrigger 把負的 start 無條件鉗成 0(_parsePosition 尾端的
             `value < 0 && (value = 0)`)。載入時已在首屏內的元素 start 本該是
             docTop−vh(負值),被鉗掉之後 y=0 的 progress 恆為 0 —— 首屏的
             RevealImage 就以「簾子全閉」首繪,要捲動才張開;會計、補習班卡上
             的白洞就是這樣來的。未鉗的原值 ST 存在 _startClamp,用它把 proxy
             的進度換回同步迴圈的映射,GSAP 才真的「只加動量、不改映射」。 */
          onUpdate: () => {
            const st = (tw as { scrollTrigger?: { start: number; end: number; _startClamp?: number | false } })
              .scrollTrigger;
            if (!st) return applyP(el, proxy.p);
            const trueStart = typeof st._startClamp === 'number' ? st._startClamp : st.start;
            const span = st.end - trueStart;
            if (span <= 0 || trueStart >= st.start) return applyP(el, proxy.p);
            const scrollEq = st.start + proxy.p * (st.end - st.start);
            applyP(el, clamp01((scrollEq - trueStart) / span));
          },
        });
        /* 首繪不等 ticker:scrub tween 要 rAF 跑起來才套用進度,rAF 被凍結時
           (無頭截圖、低電量 webview)那一刻永遠不來。先用同步迴圈的公式畫一次。 */
        const r = el.getBoundingClientRect();
        const h0 = vh();
        const p0 = isPin()
          ? clamp01(-r.top / Math.max(1, r.height - h0))
          : clamp01((h0 - r.top) / (h0 + r.height));
        applyP(el, p0);
        gsapKills.push(() => {
          (tw as { scrollTrigger?: { kill: () => void } }).scrollTrigger?.kill();
          tw.kill();
        });
      });
      return added;
    };
    const syncGsap = () => {
      if (!gsapRt || !stRt) return;
      const added = coverScrubEls();
      const sh = document.body.scrollHeight;
      if (added || sh !== lastSH) {
        lastSH = sh;
        stRt.refresh(); // layout moved — recompute every trigger's start/end
      }
      // blob-prime scrub videos a couple of viewports ahead — GSAP only calls
      // applyP once progress changes, which for a pinned host is already too
      // late for the first seek to be seekable
      if (gsapOn) {
        const h = vh();
        for (const v of videoEls) {
          const host = v.closest<HTMLElement>('[data-scrub]');
          if (!host) continue;
          const r = host.getBoundingClientRect();
          if (r.top < h * 2 && r.bottom > -h) primeVideo(v);
        }
      }
    };
    void Promise.all([import('gsap'), import('gsap/ScrollTrigger')]).then(([g, s]) => {
      if (disposed) return;
      const gsap = (g as { gsap?: GsapMod; default?: unknown }).gsap ?? (g as { default: GsapMod }).default;
      const ScrollTrigger = (s as { ScrollTrigger?: unknown; default?: unknown }).ScrollTrigger ?? (s as { default: unknown }).default;
      gsap.registerPlugin(ScrollTrigger as object);
      gsapRt = gsap;
      stRt = ScrollTrigger as { refresh: () => void };
      lastSH = document.body.scrollHeight;
      // ticker heartbeat — lets the scroll handler detect a suspended rAF
      // (low-power webviews) and fall back to the synchronous loop
      gsap.ticker.add(() => {
        tickAt = performance.now();
      });
      coverScrubEls();
      tickAt = performance.now();
      gsapOn = true;
      requestAnimationFrame(() => stRt?.refresh());
    });

    const scrubIv = setInterval(() => {
      measure(); // images/fonts landing shift layout — keep the cache honest
      frame();
      syncGsap();
    }, 1200);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    frame();

    /* ── tilt (pointer) ───────────────────────────────────── */
    const tiltHandler = (e: PointerEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tilt]');
      if (!el) return;
      const r = el.getBoundingClientRect();
      const rx = ((e.clientY - r.top) / r.height - 0.5) * -7;
      const ry = ((e.clientX - r.left) / r.width - 0.5) * 9;
      el.style.transform = `perspective(800px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
    };
    const tiltReset = (e: PointerEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tilt]');
      if (el) el.style.transform = '';
    };
    document.addEventListener('pointermove', tiltHandler, { passive: true });
    document.addEventListener('pointerout', tiltReset, { passive: true });

    /* ── magnetic hover: element leans toward the cursor, springs back ──── */
    const magHandler = (e: PointerEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-magnetic]');
      if (!el) return;
      const r = el.getBoundingClientRect();
      const strength = parseFloat(el.dataset.magnetic || '') || 14;
      const dx = ((e.clientX - r.left) / r.width - 0.5) * 2;
      const dy = ((e.clientY - r.top) / r.height - 0.5) * 2;
      el.style.setProperty('--mx', `${(dx * strength).toFixed(1)}px`);
      el.style.setProperty('--my', `${(dy * strength).toFixed(1)}px`);
    };
    const magReset = (e: PointerEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-magnetic]');
      if (el) {
        el.style.setProperty('--mx', '0px');
        el.style.setProperty('--my', '0px');
      }
    };
    document.addEventListener('pointermove', magHandler, { passive: true });
    document.addEventListener('pointerout', magReset, { passive: true });

    /* ── re-scan when client components hydrate late ─────────────────────── */
    const mo = new MutationObserver(() => {
      splitAll();
      prepDraw();
      watch();
      measure();
      syncGsap();
    });
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      disposed = true;
      gsapKills.forEach((k) => k());
      io.disconnect();
      cio.disconnect();
      mo.disconnect();
      clearInterval(sweepIv);
      clearInterval(scrubIv);
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('pointermove', tiltHandler);
      document.removeEventListener('pointerout', tiltReset);
      document.removeEventListener('pointermove', magHandler);
      document.removeEventListener('pointerout', magReset);
    };
  }, []);

  return null;
}

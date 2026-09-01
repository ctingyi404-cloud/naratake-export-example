'use client';

/* Shared admin helpers: fetch wrappers, modal, small bits. */

import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

/* ── admin language (independent of the public site) ──
   Merchants/operators switch the backoffice language here; the choice is
   persisted in an adm_lang COOKIE so the server renders the right language
   from the first byte (no en→zh flash on load), plus localStorage for
   legacy sessions. The server layout reads the cookie and provides it via
   AdmLangProvider; a tiny external store keeps every component in sync
   after the user toggles. */
export type AdmLang = 'en' | 'zh';
let _lang: AdmLang = 'en';
let _inited = false;
const _subs = new Set<() => void>();

const AdmInitialLang = createContext<AdmLang>('en');

export function AdmLangProvider({ initial, children }: { initial: AdmLang; children: ReactNode }) {
  return <AdmInitialLang.Provider value={initial}>{children}</AdmInitialLang.Provider>;
}

export function setAdmLang(l: AdmLang) {
  _lang = l;
  _inited = true;
  if (typeof window !== 'undefined') {
    localStorage.setItem('adm.lang', l);
    document.cookie = `adm_lang=${l}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = l === 'zh' ? 'zh-TW' : 'en';
  }
  _subs.forEach((f) => f());
}
function subscribe(cb: () => void) {
  _subs.add(cb);
  return () => _subs.delete(cb);
}


/* ── one stroke-icon family for the whole backoffice (1.8px, 24-box) ──
   replaces the old mixed unicode-dingbat/emoji glyphs (R12: one icon family) */
const ADM_ICONS: Record<string, ReactNode> = {
  dashboard: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
  orders: <><path d="M5 8h14l-1 12H6L5 8z" /><path d="M8.5 10V6a3.5 3.5 0 017 0v4" /></>,
  pos: <><rect x="4" y="3.5" width="16" height="17" rx="2" /><path d="M8 7.5h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" /></>,
  catalog: <><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></>,
  collections: <><path d="M12 3.2l8.5 4.3-8.5 4.3-8.5-4.3 8.5-4.3z" /><path d="M3.5 12l8.5 4.3 8.5-4.3" /><path d="M3.5 16.3l8.5 4.3 8.5-4.3" /></>,
  bookings: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  customers: <><circle cx="9" cy="8.5" r="3.5" /><path d="M3.5 20a5.5 5.5 0 0111 0M15.5 5.6a3.5 3.5 0 010 5.8M17 14.6a5.5 5.5 0 013.5 5.4" /></>,
  marketing: <><path d="M3.5 10.5v3a1 1 0 001 1H7l7 4.5v-14L7 9.5H4.5a1 1 0 00-1 1z" /><path d="M17.5 9a4 4 0 010 6" /></>,
  reports: <><path d="M4 20V4" /><path d="M4 20h16" /><path d="M8 16v-5M12 16V8M16 16v-3" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" /></>,
  bell: <><path d="M6 9.5a6 6 0 0112 0c0 5 1.5 6 1.5 6h-15S6 14.5 6 9.5z" /><path d="M10.2 19a2 2 0 003.6 0" /></>,
};

export function AdmIcon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ADM_ICONS[name] ?? ADM_ICONS.dashboard}
    </svg>
  );
}

export function useAdmLang(): { lang: AdmLang; setLang: (l: AdmLang) => void; t: (en: string, zh: string) => string } {
  // until the user toggles, the cookie-fed initial (same on server and client)
  // is the language — server HTML, hydration, and first paint all agree.
  const initial = useContext(AdmInitialLang);
  const lang = useSyncExternalStore(
    subscribe,
    () => (_inited ? _lang : initial),
    () => initial,
  );
  useEffect(() => {
    if (_inited) return;
    // legacy sessions persisted only localStorage — honor it once, which also
    // writes the cookie so the next request server-renders correctly
    const stored = localStorage.getItem('adm.lang');
    const next: AdmLang = stored === 'zh' || stored === 'en' ? stored : initial;
    if (next !== initial) setAdmLang(next);
    else {
      _inited = true;
      _lang = next;
      document.documentElement.lang = next === 'zh' ? 'zh-TW' : 'en';
    }
  }, [initial]);
  const t = useCallback((en: string, zh: string) => (lang === 'zh' ? zh : en), [lang]);
  return { lang, setLang: setAdmLang, t };
}

/* ── admin theme (Aurora light / Onyx dark / Helvetia ink-on-paper) ──
   Hand-tuned backoffice skins. The choice is a `data-admtheme` attribute
   on <html> so every `.adm` surface (panel + login) re-skins from one token
   swap; it persists in localStorage and syncs across components via a store. */
export type AdmTheme = 'aurora' | 'onyx' | 'helvetia';
let _theme: AdmTheme = 'aurora';
let _themeInit = false;
const _themeSubs = new Set<() => void>();

export function setAdmTheme(v: AdmTheme) {
  _theme = v;
  if (typeof window !== 'undefined') {
    localStorage.setItem('adm.theme', v);
    document.documentElement.setAttribute('data-admtheme', v);
  }
  _themeSubs.forEach((f) => f());
}

export function useAdmTheme(): { theme: AdmTheme; setTheme: (v: AdmTheme) => void } {
  const theme = useSyncExternalStore(
    (cb) => {
      _themeSubs.add(cb);
      return () => _themeSubs.delete(cb);
    },
    () => _theme,
    () => 'aurora' as AdmTheme,
  );
  useEffect(() => {
    if (_themeInit) return;
    _themeInit = true;
    const stored = localStorage.getItem('adm.theme');
    setAdmTheme(stored === 'onyx' || stored === 'helvetia' || stored === 'aurora' ? stored : 'aurora');
  }, []);
  return { theme, setTheme: setAdmTheme };
}

/* ── the device keeps a copy ──────────────────────────────────

   A merchant writing two thousand words holds all of it in React state until
   they click Save. A crashed tab, a dead battery, a discarded confirm: gone,
   and it is our fault.

   So while a form is dirty we mirror it into localStorage. This is deliberately
   NOT an autosave to the server: a background PATCH would publish half-written
   text over a page a reader is looking at, and after a slept-out session it
   would hit the 401 redirect above and destroy the very form it was protecting.
   The device copy has neither failure mode.

   Every access is guarded. Safari private mode throws on setItem, policy can
   disable storage entirely, and a safety net that throws is worse than none. */

const DRAFT = 'adm.draft.';
/** how long an unrecovered draft is kept. Long enough to survive a weekend. */
const KEEP_MS = 14 * 24 * 60 * 60 * 1000;

export interface Draft {
  /** the form body, exactly as it would have been sent */
  body: Record<string, unknown>;
  /** the caller's own dirty-snapshot string, so "does this differ from what is
      on screen" is one string compare against the value that already drives
      dirty tracking, rather than a second, subtly different serialization */
  snap: string;
  /** ms epoch, written by the device that owns this draft */
  at: number;
  /** the server's updatedAt for the row this was written against. A draft whose
      base no longer matches was written against an older version, so restoring
      it would silently overwrite whatever replaced it. */
  base?: string;
  /** what to call it in a recovery list, since the body's title field is generic */
  label?: string;
}

export function draftKey(user: string, scope: string, id: string): string {
  return `${DRAFT}${user}.${scope}:${id}`;
}

export function readDraft(key: string): Draft | null {
  try {
    const raw = localStorage.getItem(key);
    const d = raw ? (JSON.parse(raw) as Draft) : null;
    return d && typeof d.at === 'number' && d.body && typeof d.snap === 'string' ? d : null;
  } catch {
    return null;
  }
}

/** false means the browser refused. The caller must not claim the work is safe. */
export function writeDraft(key: string, d: Draft): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(d));
    return true;
  } catch {
    // Never make room by deleting another draft: the oldest one is precisely the
    // one most likely to be an article nobody has recovered yet. Expiring
    // drafts is the only eviction, and it is time-based, never pressure-based.
    pruneDrafts();
    try {
      localStorage.setItem(key, JSON.stringify(d));
      return true;
    } catch {
      return false;
    }
  }
}

export function dropDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing to do, and nothing worth telling the merchant */
  }
}

/** Every draft this user still holds for one scope, newest first. */
export function listDrafts(user: string, scope: string): { key: string; draft: Draft }[] {
  const prefix = `${DRAFT}${user}.${scope}:`;
  const out: { key: string; draft: Draft }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const draft = readDraft(key);
      if (draft) out.push({ key, draft });
    }
  } catch {
    return [];
  }
  return out.sort((a, b) => b.draft.at - a.draft.at);
}

export function pruneDrafts(): void {
  const now = Date.now();
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(DRAFT)) continue;
      const d = readDraft(key);
      if (!d) continue;
      const age = now - d.at;
      // A laptop with a dead clock, or a VM resumed from a snapshot, writes a
      // wild `at`. When NTP corrects it, every draft on the machine would look
      // ancient and be swept in one pass. A delta that large is a clock event,
      // not an old draft, so leave it alone.
      if (age > KEEP_MS && age < KEEP_MS * 10) dropDraft(key);
    }
  } catch {
    /* storage unavailable: nothing to prune */
  }
}

/** The signed-in admin, fetched once. Drafts are keyed by it, so a shared
    machine never offers one person's unsaved work to the next person. */
let _me: { id: string } | null = null;
export function useMe(): string | null {
  const [id, setId] = useState<string | null>(_me?.id ?? null);
  useEffect(() => {
    if (_me) return;
    admGet<{ id?: string }>('/me')
      .then((u) => {
        if (!u?.id) return;
        _me = { id: u.id };
        setId(u.id);
      })
      .catch(() => {
        /* the panel layout already gates on a session; a failure here just
           means no draft protection this load, never a broken screen */
      });
  }, []);
  return id;
}

export async function adm<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1/admin${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (res.status === 401 && !path.startsWith('/auth')) {
    window.location.href = '/admin/login';
    throw new Error('unauthorized');
  }
  const data = (await res.json()) as T & { error?: { message?: string; code?: string } };
  if (!res.ok) throw new Error(data.error?.message ?? data.error?.code ?? 'Request failed');
  return data;
}

export const admGet = <T,>(p: string) => adm<T>(p);
export const admPost = <T,>(p: string, body: unknown) =>
  adm<T>(p, { method: 'POST', body: JSON.stringify(body) });
export const admPut = <T,>(p: string, body: unknown) =>
  adm<T>(p, { method: 'PUT', body: JSON.stringify(body) });
export const admPatch = <T,>(p: string, body: unknown) =>
  adm<T>(p, { method: 'PATCH', body: JSON.stringify(body) });
export const admDelete = <T,>(p: string) => adm<T>(p, { method: 'DELETE' });

export function useLoad<T>(path: string, deps: unknown[] = []): {
  data: T | null;
  reload: () => void;
  loading: boolean;
  error: string | null;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    admGet<T>(path)
      .then((d) => alive && setData(d))
      // a failed load must NOT look like "no data" — surface it so pages can show
      // an error+retry instead of a misleading empty state
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);
  return { data, reload: () => setTick((t) => t + 1), loading, error };
}

export function Modal({
  title,
  onClose,
  dirty,
  children,
}: {
  title: string;
  onClose: () => void;
  /** Unsaved work is open. Every way out asks first, and the tab warns on unload. */
  dirty?: boolean;
  children: ReactNode;
}) {
  const { t } = useAdmLang();
  const [confirming, setConfirming] = useState(false);

  /* Three one-action ways out of a form, and none of them used to ask: the
     backdrop, Escape, and the ✕. On a short form that costs a retyped phone
     number. On a two thousand word article it costs the article. */
  const leave = useCallback(() => (dirty ? setConfirming(true) : onClose()), [dirty, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape while an IME is composing is a normal keystroke: it dismisses the
      // candidate window. Closing the form on it would delete a Chinese writer's
      // work mid-sentence, for typing.
      if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229) return;
      if (confirming) return setConfirming(false);
      leave();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [leave, confirming]);

  // the browser's own guard, for a closed tab or a followed link
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  return (
    <div className="adm-modal-backdrop" onClick={leave}>
      <div className="adm-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <strong style={{ fontSize: 16 }}>{title}</strong>
          <button className="adm-btn adm-btn-sm" onClick={leave} aria-label={t('Close', '關閉')}>
            ✕
          </button>
        </div>
        {confirming && (
          <div
            role="alertdialog"
            aria-label={t('Unsaved changes', '尚未儲存')}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 10,
              marginBottom: 16,
              padding: '10px 12px',
              borderRadius: 8,
              background: 'var(--a-warn-soft)',
              color: 'var(--a-warn)',
              fontSize: 13,
            }}
          >
            <span style={{ flex: 1, minWidth: 180 }}>
              {t('You have unsaved changes.', '你有尚未儲存的變更。')}
            </span>
            <button className="adm-btn adm-btn-sm" onClick={() => setConfirming(false)} autoFocus>
              {t('Keep editing', '繼續編輯')}
            </button>
            <button className="adm-btn adm-btn-sm" onClick={onClose}>
              {t('Discard', '捨棄')}
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/* ── loading skeletons (DESIGN: skeletons match the final layout's shape;
      no circular spinners in panel bodies) ── */

/** one shimmer bar — compose these into the shape the data will take */
export function Skel({ w = '100%', h = 12, style }: { w?: number | string; h?: number; style?: React.CSSProperties }) {
  return <span className="adm-skel" style={{ width: w, height: h, ...style }} aria-hidden />;
}

/** table-body skeleton: `rows` rows of one full-width cell with two bars,
    matching a data row's usual title+meta silhouette */
export function TableLoading({ colSpan, rows = 3 }: { colSpan: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <tr key={i}>
          <td colSpan={colSpan}>
            <Skel w={`${62 - i * 9}%`} h={13} />
            <Skel w={`${30 - i * 4}%`} h={10} style={{ marginTop: 6, display: 'block' }} />
          </td>
        </tr>
      ))}
    </>
  );
}

/* ── empty states (DESIGN: every list that can be empty says what it is and
      how to fill it, in one sentence — never a blank pane) ── */

/** the one-sentence empty state as a table row */
export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="adm-empty">{children}</td>
    </tr>
  );
}

/** the one-sentence empty state as a block (for non-table panes) */
export function Empty({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return <div className="adm-empty" style={style}>{children}</div>;
}

/* ── themed confirm (DESIGN: no window.confirm — destructive actions get the
      same skinned dialog as everything else) ──
   Promise-based so call sites stay one line: `if (!(await confirmDlg(msg))) return`.
   The host is mounted once by AdminShell; if a page somehow renders without it
   (login screen), we fall back to the native dialog rather than silently
   confirming. */
interface ConfirmReq {
  message: string;
  /** caller passes the localized label; default is Confirm/確定 */
  confirmLabel?: string;
  /** 'danger' (default) renders a filled danger CTA; 'primary' a filled primary */
  tone?: 'danger' | 'primary';
  resolve: (ok: boolean) => void;
}
let _confirmHost: ((r: ConfirmReq) => void) | null = null;

export function confirmDlg(message: string, opts?: { confirmLabel?: string; tone?: 'danger' | 'primary' }): Promise<boolean> {
  if (!_confirmHost) return Promise.resolve(window.confirm(message));
  return new Promise((resolve) => _confirmHost!({ message, ...opts, resolve }));
}

export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmReq | null>(null);
  const { t } = useAdmLang();
  useEffect(() => {
    _confirmHost = setReq;
    return () => {
      _confirmHost = null;
    };
  }, []);
  const answer = useCallback(
    (ok: boolean) => {
      req?.resolve(ok);
      setReq(null);
    },
    [req],
  );
  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      // same IME guard as Modal: Escape while composing dismisses the candidate
      // window, never the dialog
      if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229) return;
      answer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [req, answer]);
  if (!req) return null;
  return (
    <div className="adm-modal-backdrop" onClick={() => answer(false)}>
      <div
        className="adm-modal"
        style={{ width: 420 }}
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-label={req.message}
      >
        <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.6 }}>{req.message}</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          {/* the safe way out gets focus — Enter never destroys anything */}
          <button className="adm-btn" onClick={() => answer(false)} autoFocus>
            {t('Cancel', '取消')}
          </button>
          <button
            className={`adm-btn ${req.tone === 'primary' ? 'adm-btn-primary' : 'adm-btn-danger-fill'}`}
            onClick={() => answer(true)}
          >
            {req.confirmLabel ?? t('Confirm', '確定')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  // a real <label> so clicking the text focuses the input and screen readers
  // announce it (implicit association — no id wiring needed)
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <span className="adm-label">{label}</span>
      {children}
    </label>
  );
}

export function money(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export function downloadCsv(filename: string, rows: (string | number)[][]): void {
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((r) => r.map(esc).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const ORDER_TONES: Record<string, string> = {
  PENDING: 'warn',
  AWAITING_APPROVAL: 'warn',
  CONFIRMED: 'info',
  PREPARING: 'info',
  READY: 'ok',
  COMPLETED: 'muted',
  CANCELED: 'danger',
  NO_SHOW: 'danger',
  SEATED: 'info',
};

const STATUS_LABELS: Record<string, [string, string]> = {
  PENDING: ['Pending', '待處理'],
  AWAITING_APPROVAL: ['Awaiting approval', '待報價'],
  CONFIRMED: ['Confirmed', '已確認'],
  PREPARING: ['Preparing', '製作中'],
  READY: ['Ready', '待取'],
  COMPLETED: ['Completed', '已完成'],
  CANCELED: ['Canceled', '已取消'],
  NO_SHOW: ['No show', '未到'],
  SEATED: ['Seated', '已入座'],
};
export function statusLabel(status: string, lang: AdmLang): string {
  const l = STATUS_LABELS[status];
  return l ? (lang === 'zh' ? l[1] : l[0]) : status;
}

/** localized weekday short names, index 0 = Sunday */
export const WEEKDAYS_SHORT: Record<AdmLang, string[]> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  zh: ['日', '一', '二', '三', '四', '五', '六'],
};

/* A phone photo is ~4MB at 4000px. Downscale client-side so uploads are fast
   and the database stays small. 1600px long edge matches the studio's canonical
   compressImage (enough for a full-bleed section on a retina laptop). SVG passes through. */
async function compressForUpload(f: File): Promise<Blob> {
  if (f.type === 'image/svg+xml') return f;
  const url = URL.createObjectURL(f);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', 0.82));
    return blob && blob.size < f.size ? blob : f;
  } catch {
    return f;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Compress one file, store it, and hand back its url. The upload pipeline lives
    here once: ImageUpload is its single-photo face, and a screen that takes eight
    files at a time (a listing's gallery) is this same call in a loop rather than
    a second uploader. Throws with the server's own message. */
export async function uploadImage(f: File): Promise<string> {
  const fd = new FormData();
  const blob = await compressForUpload(f);
  fd.append('file', blob, blob.type === 'image/webp' ? 'photo.webp' : f.name);
  const res = await fetch('/api/v1/admin/media', { method: 'POST', body: fd });
  const data = (await res.json()) as { url?: string; error?: { message?: string } };
  // was silently ignoring a failed upload → the item saved with no photo
  if (!res.ok || !data.url) throw new Error(data.error?.message ?? 'Upload failed');
  return data.url;
}

export function ImageUpload({ value, onChange }: { value: string | null; onChange: (url: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const { t } = useAdmLang();
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="" style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--a-border)' }} />
      ) : (
        <div style={{ width: 52, height: 52, borderRadius: 8, border: '1px dashed var(--a-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--a-faint)', fontSize: 20 }}>
          +
        </div>
      )}
      <label className="adm-btn adm-btn-sm" style={{ cursor: 'pointer' }}>
        {busy ? t('Uploading…', '上傳中…') : value ? t('Replace', '更換') : t('Upload image', '上傳圖片')}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setBusy(true);
            try {
              onChange(await uploadImage(f));
            } catch (err) {
              alert(err instanceof Error ? err.message : t('Image upload failed', '圖片上傳失敗'));
            } finally {
              setBusy(false);
              e.target.value = ''; // allow re-selecting the same file after an error
            }
          }}
        />
      </label>
      {value && (
        <button className="adm-btn adm-btn-sm adm-btn-danger" onClick={() => onChange(null)}>
          {t('Remove', '移除')}
        </button>
      )}
    </div>
  );
}

'use client';

/* Floating AI concierge bubble — mounts on every page of the exported site but
   renders NOTHING until /assistant/config says the deployment has an
   ANTHROPIC_API_KEY (same "key present → feature on" pattern as Resend email).
   Answers come from the merchant's own data only (see server/assistant.ts). */

import { useEffect, useRef, useState } from 'react';
import { useSiteLang } from '@/lib/site-i18n';
import { useLiveBusiness } from '@/lib/business-client';
/* renderReply 只把「真的存在的頁面」連結化 —— 助理答出 /order 而這個網站沒有
   訂餐頁時,那串就該留成純文字。少了這一行,匯出的網站 next build 會在
   「Cannot find name 'site'」掛掉,整個交付建不起來。 */
import { site } from '@/lib/site-config';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

export function ConciergeBubble() {
  const { lang } = useSiteLang();
  // the panel header names the business; server/assistant.ts grounds the answers
  // in the same live profile, so the two cannot disagree about who is speaking
  const business = useLiveBusiness();
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/v1/assistant/config')
      .then((r) => r.json())
      .then((d) => setEnabled(!!d.enabled))
      .catch(() => {});
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [msgs, busy]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!enabled) return null;

  const t = (en: string, zh: string, es: string) => (lang === 'zh' ? zh : lang === 'es' ? es : en);

  async function send() {
    const content = input.trim();
    if (!content || busy) return;
    setErr('');
    const next: Msg[] = [...msgs, { role: 'user', content }];
    setMsgs(next);
    setInput('');
    setBusy(true);
    try {
      // the Messages API requires the first message to be a user turn — after
      // windowing, drop any leading assistant turns or the 5th+ question 400s
      let window = next.slice(-8);
      while (window.length && window[0].role !== 'user') window = window.slice(1);
      const res = await fetch('/api/v1/assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: window }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'unavailable');
      setMsgs((m) => [...m, { role: 'assistant', content: data.reply }]);
    } catch (e) {
      setErr(t('Could not reach the assistant. Please call us instead.', '助理暫時無法回應,請直接來電。', 'El asistente no está disponible. Llámanos.'));
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  /* answers may contain relative links like /order — linkify just those */
  const renderReply = (text: string) =>
    text.split(/(\/[a-z0-9-/]+)/g).map((part, i) =>
      part.startsWith('/') && site.pages.some((p) => part === p.slug || part.startsWith(p.slug + '/')) ? (
        <a key={i} href={part} style={{ color: 'var(--c-primary)', fontWeight: 600 }}>{part}</a>
      ) : (
        part
      ),
    );

  return (
    <>
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-label={t('Ask us anything', '線上小幫手', 'Pregúntanos')}
          style={{ position: 'fixed', right: 18, bottom: 84, zIndex: 90, width: 'min(360px, calc(100vw - 36px))', maxHeight: '60vh', display: 'flex', flexDirection: 'column', background: 'var(--c-surface)', color: 'var(--c-text)', border: '1px solid var(--c-border)', borderRadius: 16, boxShadow: '0 18px 50px -12px rgba(0,0,0,0.35)', overflow: 'hidden' }}
        >
          <div style={{ padding: '12px 16px', fontWeight: 700, fontSize: 14.5, borderBottom: '1px solid var(--c-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{business.name} · {t('Assistant', '小幫手', 'Asistente')}</span>
            <button onClick={() => setOpen(false)} aria-label={t('Close', '關閉', 'Cerrar')} style={{ background: 'none', border: 'none', color: 'var(--c-text-muted)', cursor: 'pointer', fontSize: 16, minWidth: 32, minHeight: 32 }}>✕</button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {msgs.length === 0 && (
              <p style={{ margin: 0, fontSize: 13.5, color: 'var(--c-text-muted)', lineHeight: 1.6 }}>
                {t('Ask about our menu, hours, or booking. I answer from this business’s real info.', '菜單、營業時間、訂位都可以問,我只根據店家的真實資訊回答。', 'Pregunta por el menú, horarios o reservas.')}
              </p>
            )}
            {msgs.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%', padding: '8px 12px', borderRadius: 12, fontSize: 14, lineHeight: 1.55, background: m.role === 'user' ? 'var(--c-primary)' : 'color-mix(in srgb, var(--c-text) 7%, transparent)', color: m.role === 'user' ? 'var(--c-primary-fg)' : 'var(--c-text)' }}>
                {m.role === 'assistant' ? renderReply(m.content) : m.content}
              </div>
            ))}
            {busy && <div style={{ alignSelf: 'flex-start', color: 'var(--c-text-muted)', fontSize: 13 }}>…</div>}
            {err && <div role="alert" style={{ color: '#d33', fontSize: 13 }}>{err}</div>}
            <div ref={endRef} />
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); void send(); }}
            style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--c-border)' }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('Type a question…', '輸入問題…', 'Escribe una pregunta…')}
              aria-label={t('Your question', '你的問題', 'Tu pregunta')}
              style={{ flex: 1, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--c-border)', background: 'var(--c-bg)', color: 'var(--c-text)', fontSize: 14 }}
            />
            <button className="ls-btn" disabled={busy || !input.trim()} style={{ padding: '9px 16px', fontSize: 13.5 }}>
              {t('Ask', '送出', 'Enviar')}
            </button>
          </form>
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={t('Chat with us', '線上小幫手', 'Chatea con nosotros')}
        style={{ position: 'fixed', right: 18, bottom: 18, zIndex: 90, width: 54, height: 54, borderRadius: 999, border: 'none', cursor: 'pointer', background: 'var(--c-primary)', color: 'var(--c-primary-fg)', boxShadow: '0 10px 30px -8px rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 11.5a8.5 8.5 0 01-8.5 8.5c-1.2 0-2.4-.25-3.4-.7L4 21l1.7-4.1A8.5 8.5 0 1121 11.5z" />
        </svg>
      </button>
    </>
  );
}

'use client';

import { useState } from 'react';
import '../admin.css';
import { admPost, useAdmLang } from '../ui';
import { site } from '@/lib/site-config';

export default function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { lang, setLang, t } = useAdmLang();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await admPost('/auth/login', { email, password });
      window.location.href = '/admin';
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Login failed', '登入失敗'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="adm" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 20 }}>
      <form onSubmit={submit} className="adm-card" style={{ width: 380, padding: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <div className="adm-lang" role="group" aria-label={t('Language', '語言')}>
            <button className="adm-lang-btn" data-active={lang === 'en'} onClick={() => setLang('en')} type="button">EN</button>
            <button className="adm-lang-btn" data-active={lang === 'zh'} onClick={() => setLang('zh')} type="button">中文</button>
          </div>
        </div>
        <div style={{ fontWeight: 800, fontSize: 18 }}>{site.business.name}</div>
        <div style={{ color: 'var(--a-dim)', fontSize: 13, marginBottom: 24 }}>{t('Merchant backoffice', '商家後台')}</div>
        <div style={{ marginBottom: 14 }}>
          <span className="adm-label">Email</span>
          <input className="adm-input" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div style={{ marginBottom: 18 }}>
          <span className="adm-label">{t('Password', '密碼')}</span>
          <input className="adm-input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && (
          <div style={{ color: 'var(--a-danger)', fontSize: 13, marginBottom: 14 }}>{error}</div>
        )}
        <button className="adm-btn adm-btn-primary" style={{ width: '100%' }} disabled={busy}>
          {busy ? t('Signing in…', '登入中…') : t('Sign in', '登入')}
        </button>
        <p style={{ color: 'var(--a-faint)', fontSize: 12, marginTop: 16, lineHeight: 1.5 }}>
          {t(
            'First time? The seeded owner login is in your project README (change the password right after).',
            '第一次登入？預設的管理員帳密在專案 README 裡（登入後請立即更改密碼）。',
          )}
        </p>
      </form>
    </div>
  );
}

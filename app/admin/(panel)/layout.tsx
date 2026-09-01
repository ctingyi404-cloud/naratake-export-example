import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifyToken } from '@/lib/auth';
import '../admin.css';
import { AdmLangProvider } from '../ui';
import { AdminShell } from './shell';

export const metadata = { title: 'Admin' };
export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const session = verifyToken(jar.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/admin/login');
  // cookie first, Accept-Language for the very first visit — the server renders
  // the operator's language from the first byte, so pages never flash English
  const c = jar.get('adm_lang')?.value;
  const accept = (await headers()).get('accept-language') ?? '';
  const lang = c === 'zh' || c === 'en' ? c : accept.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  return (
    <AdmLangProvider initial={lang}>
      <AdminShell>{children}</AdminShell>
    </AdmLangProvider>
  );
}

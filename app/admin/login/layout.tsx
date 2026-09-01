import { cookies, headers } from 'next/headers';
import '../admin.css';
import { AdmLangProvider } from '../ui';

export const metadata = { title: 'Admin login' };
export const dynamic = 'force-dynamic';

export default async function LoginLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const c = jar.get('adm_lang')?.value;
  const accept = (await headers()).get('accept-language') ?? '';
  const lang = c === 'zh' || c === 'en' ? c : accept.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  return <AdmLangProvider initial={lang}>{children}</AdmLangProvider>;
}

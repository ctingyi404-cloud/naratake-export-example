import '../globals.css';
import { SiteShell, siteMetadata } from '@/components/site-shell';
import { PRIMARY_LOCALE } from '@/lib/locale-path';

/* The primary language tree's document. `app/(site)` is a route group, so this
   is a ROOT layout — it owns <html> and <body> for every unprefixed address —
   and the second language's tree owns its own beside it. That is the only way
   `<html lang>` can differ per language without a dynamic read on every request
   turning a static brochure site into a server-rendered one. */

export const metadata = siteMetadata(PRIMARY_LOCALE);

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <SiteShell locale={PRIMARY_LOCALE}>{children}</SiteShell>;
}

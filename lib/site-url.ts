/** The site's public base URL — one source of truth for metadata, sitemap and
    robots so a deploy never mixes localhost into robots/sitemap while the page
    metadata is correct. Vercel provides VERCEL_URL (no protocol); an explicit
    NEXT_PUBLIC_SITE_URL (e.g. the custom domain) always wins. */
export function getSiteUrl(): string {
  /* Both keys, because the shipped .env.example documents APP_URL and nothing
     read it. A customer who set exactly what they were told to set still got
     links built from VERCEL_URL or from localhost — in emails, in the sitemap,
     and in the private preview link handed to a source.

     NEXT_PUBLIC_SITE_URL first: it is the one the client bundle can also see, so
     where the two disagree the browser-visible value is the site's real face. */
  const explicit = process.env.NEXT_PUBLIC_SITE_URL || process.env.APP_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

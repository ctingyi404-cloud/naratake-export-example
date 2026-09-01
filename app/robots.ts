import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/site-url';

export default function robots(): MetadataRoute.Robots {
  const base = getSiteUrl();
  return {
    // media stays crawlable — menu/catalog photos are served from /api/v1/media
    // and Google Images is real local-business traffic (longest-match allow wins)
    rules: [{ userAgent: '*', allow: ['/', '/api/v1/media/'], disallow: ['/admin', '/api'] }],
    sitemap: `${base}/sitemap.xml`,
  };
}

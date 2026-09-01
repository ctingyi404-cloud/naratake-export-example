import { site } from '@/lib/site-config';
import { SiteOpengraphImage } from '@/components/opengraph-image';

/* Branded share image for the primary language tree. It lives in this root
   segment so its relative route resolves with siteMetadata().metadataBase. */
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = site.business.name;

export default SiteOpengraphImage;

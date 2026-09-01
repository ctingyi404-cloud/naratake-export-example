/* The legal documents, in the site's primary language. The body lives in ./impl
   so the second language's tree mounts the same route rather than a copy. */

import { legalRoute, legalStaticParams } from './impl';
import { PRIMARY_LOCALE } from '@/lib/locale-path';

export const dynamic = 'force-static';

export const generateStaticParams = legalStaticParams;

const route = legalRoute(PRIMARY_LOCALE);
export const generateMetadata = route.generateMetadata;
export default route.Page;

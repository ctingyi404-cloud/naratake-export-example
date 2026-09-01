/* /llms.txt — a plain-text business summary for AI assistants, the way
   robots.txt speaks to crawlers. When someone asks ChatGPT/Claude "best pad
   thai near me", this is the page that answers on the merchant's behalf.
   The same document grounds the on-site concierge (server/assistant.ts). */

import { composeGrounding } from '@/lib/grounding';

export const dynamic = 'force-dynamic';

export async function GET() {
  return new Response(await composeGrounding(), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

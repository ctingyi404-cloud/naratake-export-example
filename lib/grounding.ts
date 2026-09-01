/* The merchant's facts as one plain-text document — served verbatim at
   /llms.txt for AI crawlers AND used as the on-site concierge's only source
   of truth (it answers from this, nothing else). */

import { db } from './db';
import { publicBusiness } from './business-db';
import { offers } from './hooks';
import './hooks-init';
import { site, addressLine } from './site-config';
import { getSiteUrl } from './site-url';
import { money } from './money';

export async function composeGrounding(): Promise<string> {
  /* The live profile, not the baked one. This document is the concierge's ONLY
     source of truth and the whole of /llms.txt, so a merchant whose number
     changed and whose config did not had an AI assistant on their own site
     confidently handing out the old one. */
  const b = await publicBusiness();
  const base = getSiteUrl();
  const lines = [
    `# ${b.name}`,
    addressLine(b.address),
    `Phone: ${b.phone}`,
    `Website: ${base}`,
  ];

  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
  const hours = b.hours as Record<string, [string, string][] | null>;
  if (hours && Object.keys(hours).length) {
    lines.push('', '## Hours');
    for (const d of days) {
      const spans = hours[d];
      lines.push(`- ${d}: ${spans?.length ? spans.map(([a, z]) => `${a}–${z}`).join(', ') : 'closed'}`);
    }
  }

  lines.push('', '## Pages', ...site.pages.map((p) => `- ${p.name}: ${base}${p.slug === '/' ? '' : p.slug}`));

  // the AI answers about whatever this site has; a site with no catalog simply
  // has no menu section, so this goes through the module's offer rather than
  // naming a table that may not exist
  const items = offers.groundingItems ? await offers.groundingItems(db).catch(() => []) : [];
  if (items.length) {
    lines.push('', '## Menu & services (highlights)');
    for (const it of items)
      lines.push(`- ${it.name} (${it.categoryName}) — ${money(it.priceCents)}${it.description ? `: ${it.description}` : ''}`);
  }

  return lines.join('\n') + '\n';
}

/* Which content types the desk commissions into.

   One rule, two readers: the desk route decides with it, and the desk screen
   asks with it. They must not drift — a screen that offers three types while
   the server accepts one is worse than either alone.

   It used to be "the first collection the merchant defined", which on a real
   newsroom is the byline list, so every commissioned story became an author.
   The obvious replacement — "anything with a body field" — is too blunt in the
   other direction: a reporter's biography and a section's description are body
   text too, and offering all three turns every commission into a question.

   What actually separates a story from a record about a person or a section is
   that a story is CREDITED and DATED. It has a byline, or a deck, or a flag the
   desk puts on it while it runs; failing all three, it is the type whose newest
   entry is the point. A biography has none of those. */

import { site } from '@/lib/site-config';

type Col = NonNullable<typeof site.collections>[number];

/** roles only a thing that gets published carries */
const STORY_MARKS = new Set(['byline', 'standfirst', 'flag']);

const hasBody = (col: Col) => col.fields.some((f) => f.role === 'body');
const isCredited = (col: Col) => col.fields.some((f) => STORY_MARKS.has(f.role ?? ''));

export function storyCollections(): Col[] {
  /* A reader page is not optional. A story filed into a type with no detail
     route is a story nobody can be sent to, which is not a story — and the
     weakest branch below already required one, so requiring it throughout is
     the consistent reading rather than a new rule. */
  const cols = (site.collections ?? []).filter((col) => col.detailPage !== false);
  const bodied = cols.filter(hasBody);
  /* Credited or chronological. Both are opt-in signals, so a site that declares
     no roles at all falls through to the weaker tests below and behaves exactly
     as it did before roles existed. */
  const stories = bodied.filter((col) => isCredited(col) || col.sort === 'newest');
  if (stories.length) return stories;
  if (bodied.length) return bodied;
  return cols;
}

'use client';

/* Render children into document.body. Every fixed-position overlay must go
   through this: scroll-reveal and GSAP leave transforms on ancestor sections,
   and a transformed ancestor traps position:fixed in its own stacking context
   — the overlay's z-index then competes only locally, and a later section's
   heading (root context) draws OVER the open dialog. Portaling to body makes
   the overlay immune to whatever animation did to its ancestors.
   Note: React events still bubble through the REACT tree, not the DOM tree —
   overlay roots keep their own stopPropagation (the try-on lesson). */

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function BodyPortal({ children }: { children: ReactNode }) {
  // first client render only — document does not exist during SSR
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return null;
  return createPortal(children, document.body);
}

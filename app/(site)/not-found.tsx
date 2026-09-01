/* The branded 404, rendered inside the primary tree's document.

   `app/not-found.tsx` is what an address matching no tree at all falls to, and
   with a root layout per language there is none to wrap it — so it is styled by
   its own stylesheet import and nothing else. A miss INSIDE this tree should
   keep the site's chrome, which is what this one-line mount is for. */
export { default } from '../not-found';

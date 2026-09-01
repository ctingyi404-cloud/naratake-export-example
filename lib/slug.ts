/* The readable part of a URL, from a title. Twin of `slugText` in
   @localsite/schema — this app is standalone and cannot import the package, so
   the rule lives here once and every caller reads it rather than carrying a
   fourth copy. verify-render-parity holds the two in step.

   Stripping everything outside [a-z0-9] assumes titles are English, and it
   failed loudly in the market this is sold into: every Chinese headline
   collapsed to the fallback, so a paper's archive read story, story-2, story-3.
   "台北101觀景台" came out as "101".

   CJK is kept. Those characters are legal in a URL, travel percent-encoded and
   display decoded in every current browser, which is what Chinese-language
   publishers actually do. Accented Latin folds to its base letter instead of
   being deleted, so "Café" is "cafe" and not "caf". */

const MARKS = /[̀-ͯ]/g;
// CJK ideographs, their extension A, kana, and Hangul syllables
const KEEP = /[^a-z0-9一-鿿㐀-䶿぀-ヿ가-힯]+/g;

export function slugText(title: string, fallback = 'entry'): string {
  return (
    title
      .normalize('NFD')
      .replace(MARKS, '')
      // recompose: NFD splits a Hangul syllable into conjoining jamo, which KEEP
      // does not cover, so Korean vanished without this
      .normalize('NFC')
      .toLowerCase()
      .replace(KEEP, '-')
      // trim AFTER the cut: slicing first can land on a separator, and a slug
      // ending in a hyphen is both ugly and no longer its own fixed point — feed
      // it back in and you get a different string, which turns a re-save into a
      // rename and a dedupe into "name--2"
      .slice(0, 60)
      .replace(/^-+|-+$/g, '') || fallback
  );
}

/** A site path with every segment percent-encoded.

    Slugs may now hold CJK, and a raw non-ASCII character in an href is
    something the browser encodes on its way out — which is fine until the
    canonical tag and the sitemap still carry the raw form. A crawler then has
    the requested address and the declared address disagreeing, which is the one
    way a working URL still costs you the ranking. Encode once, at every point a
    path is built. */
export const urlPath = (...parts: string[]) => '/' + parts.map(encodeURIComponent).join('/');

/** A dynamic route segment, as the database stores it.

    Next hands a route param through in its URL form, so a story whose address
    holds CJK arrives as "%E5%B8%82%E8%AD%B0..." and a lookup by that string
    finds nothing: the page 404s while the back office insists it is published.
    Nothing catches this in a pure test, because both halves are correct on their
    own — it only appears when a real request reaches a real row.

    Idempotent for anything we mint, because `slugText` strips '%' — so a slug can
    never contain an escape of its own to be eaten by a second decode. A
    malformed sequence is handed back untouched rather than throwing a 500. */
export function routeSlug(param: string): string {
  try {
    /* NFC, because that is the form slugText stores: it recomposes before it
       filters. A browser or a pasted link can carry the decomposed form of the
       same characters, which is a different byte string to the database and so
       a 404 on a story that is plainly there. */
    return decodeURIComponent(param).normalize('NFC');
  } catch {
    return param;
  }
}

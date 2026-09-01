/* Structured data, safely.

   JSON-LD is JSON inside a <script> element, and the HTML parser stops that
   element at the first `</script`, wherever it appears — including inside a JSON
   string. So `JSON.stringify(obj)` straight into dangerouslySetInnerHTML lets
   anything that can write merchant content close the tag and open its own.

   Every field of ours that reaches structured data is merchant-authored: the
   business name in the site-wide LocalBusiness block, a post headline, a story's
   correction text. None of it is hostile by intent and all of it is hostile by
   possibility, which is the same thing at the point where it renders on a
   reader's page.

   Escaping `<` is enough and is still valid JSON: `<` cannot begin a tag,
   cannot begin a comment, and parses back to the same string. */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/* HTML-entity escaping for untrusted strings interpolated into markup
   (notification-email HTML, reflected pages). Maps the characters that let a
   value break out of text or a double-quoted attribute. Ampersand is replaced
   first so the entities we emit are not themselves re-escaped. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* Contact values that become public URI targets, validated the same way the
   exporter validates them.

   WHY THIS IS A SECOND COPY. The exporter runs `productPublicPhone` /
   `productPublicEmail` (packages/product-contract/src/public-contact.ts) over
   the project before it writes site.config.json, so a phone Naratake cannot
   turn into a `tel:` URI arrives here as an empty string and the footer simply
   draws no link. An exported site is a standalone npm project — it cannot
   import a workspace package — so the rule has to exist here too, and the two
   copies MUST stay byte-identical in behaviour.

   The rule matters the moment the back office can change these values. Before
   that, `PATCH /settings` validated the phone as `z.string().optional()` — no
   validation at all — which was harmless only because nothing rendered the
   stored value. A DB-backed footer without this check is a way to put an
   arbitrary merchant-supplied string into an `href` on a live customer site.

   Ported verbatim from product-contract; keep the predicates in step. Only the
   two contact scalars are here: socials/URLs are not merchant-editable from the
   back office, so their (much larger) reserved-host validator is not duplicated. */

/** Returns the trimmed number only when it can form a meaningful `tel:` URI. */
export function publicPhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  const digits = value.replace(/\D/g, '');
  if (
    !value ||
    // 起頭放寬到接受 '(' —— 舊的規則要求 + 之後第一個字元必須是數字,於是
    // "(512) 555-0111" 這種美國最常見的寫法被判無效,電話直接從網站上消失。
    // 這一份必須跟 packages/product-contract/src/public-contact.ts 一字不差:
    // 兩邊分家的話,匯出時被接受的號碼會在後台被清空(反之亦然)。
    !/^(?:\+|\()?[0-9](?:[0-9().\s-]*[0-9])?$|^\((?:[0-9().\s-]*[0-9])$/.test(value) ||
    digits.length < 7 ||
    digits.length > 15 ||
    /^0+$/.test(digits)
  )
    return null;
  return value;
}

/** Returns the trimmed address only when it can form a meaningful `mailto:` URI. */
export function publicEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || value.length > 254 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const at = value.lastIndexOf('@');
  if (at <= 0 || at !== value.indexOf('@')) return null;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (
    local.length > 64 ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..') ||
    !/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)
  )
    return null;
  const labels = domain.split('.');
  if (
    labels.length < 2 ||
    labels.some((label) => !label || label.length > 63 || !/^[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?$/i.test(label)) ||
    isReservedHostname(domain)
  )
    return null;
  return value;
}

/** A public brand must contain an actual letter or number, not only spacing. */
export function publicBusinessName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().replace(/\s+/g, ' ');
  return value && /[\p{L}\p{N}]/u.test(value) ? value : null;
}

function parseIpv4(hostname: string): [number, number, number, number] | null {
  const parts = hostname.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts as [number, number, number, number];
}

function isReservedIpv4(parts: readonly number[]): boolean {
  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

/* An email domain must be a public host, not a single-label intranet name or a
   special-use namespace. IPv6 literals never appear after an `@` in the shape
   this validator accepts (no bracketed hosts), so only the v4 case is decoded. */
function isReservedHostname(rawHostname: string): boolean {
  const hostname = rawHostname.toLowerCase().replace(/\.$/, '');
  const ipv4 = parseIpv4(hostname);
  if (ipv4) return isReservedIpv4(ipv4);
  if (!hostname.includes('.')) return true;
  return [
    'localhost',
    'example',
    'example.com',
    'example.net',
    'example.org',
    'invalid',
    'test',
    'local',
    'internal',
    'lan',
    'home',
    'home.arpa',
    'arpa',
    'onion',
  ].some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
}

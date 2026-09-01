/* CSV, one file, both directions.

   The back office already offered "Download CSV" on several screens, and a
   merchant arriving with a spreadsheet from their POS had to retype it row by
   row. So the contract is a ROUND TRIP: download, edit in Excel or Sheets,
   upload the same file back. That only holds if one place owns the format, so
   `toCsv` and `parseCsv` live together and are tested against each other.

   RFC 4180, and the parts of it a merchant hits within the first ten minutes:
   a description containing a comma, an address containing a newline, a name
   containing a quote ("The Beast"), Excel's CRLF, and the UTF-8 BOM Excel needs
   to open a Chinese file without turning it into mojibake — which our own
   exporter writes, so a file that failed to parse its own output would be the
   first thing anyone tried. */

const BOM = '﻿';

/** One CSV cell: quoted only when it has to be, doubled quotes inside. */
function escapeCell(v: string | number | null | undefined): string {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows → a CSV document, BOM-prefixed so Excel opens UTF-8 correctly. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return BOM + rows.map((r) => r.map(escapeCell).join(',')).join('\r\n');
}

/** A CSV document → rows. Never throws: a malformed file yields the cells it
    could read, because a merchant is better served by "row 14 looks wrong" than
    by "import failed". */
export function parseCsv(input: string): string[][] {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        // "" inside a quoted cell is one literal quote; a lone " closes it
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else {
        cell += c;
      }
      continue;
    }
    if (c === '"' && cell === '') { quoted = true; continue; }
    if (c === ',') { row.push(cell); cell = ''; continue; }
    if (c === '\r' || c === '\n') {
      // CRLF is one break, not two empty rows
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += c;
  }
  // a file that does not end in a newline still has a last row
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  // trailing blank lines are Excel's, not the merchant's
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

/** Header row + data rows → objects keyed by header.

    Headers are matched loosely on purpose: a merchant who exported "Price" and
    typed "price " in a new column meant the same thing, and refusing the file
    over a capital letter is how an import feature goes unused. */
export function parseCsvObjects(input: string): { headers: string[]; rows: Record<string, string>[] } {
  const raw = parseCsv(input);
  if (!raw.length) return { headers: [], rows: [] };
  const headers = raw[0].map((h) => h.trim());
  const keys = headers.map(normalizeHeader);
  const rows = raw.slice(1).map((r) => {
    const o: Record<string, string> = {};
    keys.forEach((k, i) => { if (k) o[k] = (r[i] ?? '').trim(); });
    return o;
  });
  return { headers, rows };
}

/** "Price (USD)" → "price", "Sq ft" → "sqft", "名稱" → "名稱" */
export function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/\(.*?\)/g, '').replace(/[\s_-]+/g, '').trim();
}

/** Money as a person writes it — "$1,299.00", "1299", "1,299" — in cents.
    Returns null when there is no number at all, so a blank cell can mean
    "leave it alone" and a typo can be reported rather than silently zeroed. */
export function parseMoneyCents(v: string | undefined): number | null {
  if (v == null) return null;
  const cleaned = v.replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** A plain number from a cell that may carry units ("1,850 sqft", "3 bd"). */
export function parseNumber(v: string | undefined): number | null {
  if (v == null) return null;
  const cleaned = v.replace(/,/g, '').replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** A list cell: "Pool, Garage, Yard" or "Pool|Garage" → ['Pool','Garage','Yard'] */
export function parseList(v: string | undefined): string[] {
  return String(v ?? '')
    .split(/[,|;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

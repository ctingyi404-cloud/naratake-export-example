'use client';

/* Import a spreadsheet.

   A merchant does not start with an empty catalog. They start with a POS
   export, a supplier's price list, or a brokerage's inventory sheet — and the
   back office used to make them retype it row by row, which is where a website
   stops being worth the afternoon.

   The contract is a ROUND TRIP: the same screen offers "Download CSV", and the
   file that comes back out is the file this accepts. Rows are matched on a
   natural key (category + item name, or a property's title) so the second
   upload of an edited file UPDATES instead of duplicating — "fix the prices in
   Excel and send it again" has to mean what it says.

   Nothing is all-or-nothing. One bad price must not reject 199 good rows, so
   the server reports failures with line numbers and imports the rest. */

import { useRef, useState } from 'react';
import { parseCsvObjects, toCsv } from '@/lib/csv';
import { admPost, Modal, useAdmLang } from './ui';

interface ImportResult {
  created: number;
  updated: number;
  failed: { line: number; name: string; reason: string }[];
}

export function CsvImport({
  endpoint,
  headers,
  sample,
  exportHref,
  onDone,
}: {
  /** admin API path that takes { rows } and answers ImportResult */
  endpoint: string;
  /** the columns this importer writes, in order — also the template's header */
  headers: string[];
  /** one filled-in row so the template shows what a value looks like */
  sample: string[];
  /** where the matching download lives, so the round trip is one click away */
  exportHref?: string;
  onDone: () => void;
}) {
  const { t } = useAdmLang();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [fileHeaders, setFileHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const known = headers.map((h) => h.toLowerCase());
  const unmatched = fileHeaders.filter((h) => !known.includes(h.toLowerCase().replace(/\(.*?\)/g, '').replace(/[\s_-]+/g, '').trim()));

  const reset = () => { setRows(null); setFileHeaders([]); setFileName(''); setResult(null); setErr(''); };

  async function read(file: File) {
    reset();
    setFileName(file.name);
    try {
      const { headers: h, rows: r } = parseCsvObjects(await file.text());
      if (!r.length) { setErr(t('That file has a header row and nothing else.', '這個檔案只有標題列,沒有資料。')); return; }
      setFileHeaders(h);
      setRows(r);
    } catch {
      setErr(t('Could not read that file. Is it a CSV?', '讀不到這個檔案,確定是 CSV 嗎?'));
    }
  }

  return (
    <>
      <button className="adm-btn" onClick={() => { reset(); setOpen(true); }}>
        {t('Import CSV', '匯入 CSV')}
      </button>

      {open && (
        <Modal title={t('Import from a spreadsheet', '從試算表匯入')} onClose={() => { setOpen(false); if (result) onDone(); }}>
          {!result && (
            <>
              <p style={{ margin: '0 0 14px', fontSize: 13.5, color: 'var(--a-dim)', lineHeight: 1.6 }}>
                {t(
                  'Rows are matched by name — uploading an edited file updates what is already here instead of adding it twice.',
                  '以名稱比對:上傳修改過的檔案會更新既有資料,不會重複新增。',
                )}
              </p>

              <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                <button
                  className="adm-btn adm-btn-sm"
                  onClick={() => {
                    // a template beats a paragraph explaining the columns
                    const url = URL.createObjectURL(new Blob([toCsv([headers, sample])], { type: 'text/csv;charset=utf-8' }));
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'template.csv';
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  {t('Download a template', '下載範本檔')}
                </button>
                {exportHref && (
                  <a className="adm-btn adm-btn-sm" href={exportHref} style={{ textDecoration: 'none' }}>
                    {t('Download what is here now', '下載目前的資料')}
                  </a>
                )}
              </div>

              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = ''; }}
              />
              <button className="adm-btn adm-btn-primary" onClick={() => fileRef.current?.click()} style={{ width: '100%' }}>
                {fileName || t('Choose a CSV file…', '選擇 CSV 檔案…')}
              </button>

              {err && <div role="alert" style={{ marginTop: 12, color: 'var(--a-warn)', fontSize: 13.5 }}>{err}</div>}

              {rows && (
                <div style={{ marginTop: 16 }}>
                  <strong style={{ fontSize: 13.5 }}>
                    {t(`${rows.length} rows ready`, `準備匯入 ${rows.length} 列`)}
                  </strong>
                  {unmatched.length > 0 && (
                    <div style={{ marginTop: 6, fontSize: 12.5, color: 'var(--a-dim)' }}>
                      {t('Ignored columns:', '忽略的欄位:')} {unmatched.join(', ')}
                    </div>
                  )}
                  <div className="adm-card" style={{ marginTop: 10, overflowX: 'auto' }}>
                    <table className="adm-table" style={{ fontSize: 12.5 }}>
                      <thead>
                        <tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {rows.slice(0, 5).map((r, i) => (
                          <tr key={i}>
                            {headers.map((h) => (
                              <td key={h} style={{ whiteSpace: 'nowrap', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {r[h.toLowerCase()] ?? ''}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {rows.length > 5 && (
                    <div style={{ marginTop: 6, fontSize: 12.5, color: 'var(--a-faint)' }}>
                      {t(`…and ${rows.length - 5} more`, `…還有 ${rows.length - 5} 列`)}
                    </div>
                  )}
                  <button
                    className="adm-btn adm-btn-primary"
                    disabled={busy}
                    style={{ width: '100%', marginTop: 14 }}
                    onClick={async () => {
                      setBusy(true);
                      setErr('');
                      try {
                        setResult(await admPost<ImportResult>(endpoint, { rows }));
                      } catch (e) {
                        setErr(e instanceof Error ? e.message : t('Import failed.', '匯入失敗。'));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {busy ? t('Importing…', '匯入中…') : t(`Import ${rows.length} rows`, `匯入 ${rows.length} 列`)}
                  </button>
                </div>
              )}
            </>
          )}

          {result && (
            <div>
              <p style={{ margin: '0 0 10px', fontSize: 15 }}>
                ✓ {t(`${result.created} added, ${result.updated} updated`, `新增 ${result.created} 筆,更新 ${result.updated} 筆`)}
              </p>
              {result.failed.length > 0 && (
                <>
                  <strong style={{ fontSize: 13.5, color: 'var(--a-warn)' }}>
                    {t(`${result.failed.length} rows were skipped`, `有 ${result.failed.length} 列被跳過`)}
                  </strong>
                  <div className="adm-card" style={{ marginTop: 8, maxHeight: 220, overflowY: 'auto' }}>
                    <table className="adm-table" style={{ fontSize: 12.5 }}>
                      <tbody>
                        {result.failed.map((f, i) => (
                          <tr key={i}>
                            <td style={{ whiteSpace: 'nowrap' }}>{t('Row', '第')} {f.line}</td>
                            <td>{f.name}</td>
                            <td style={{ color: 'var(--a-warn)' }}>{f.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              <button className="adm-btn adm-btn-primary" style={{ width: '100%', marginTop: 14 }} onClick={() => { setOpen(false); onDone(); }}>
                {t('Done', '完成')}
              </button>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

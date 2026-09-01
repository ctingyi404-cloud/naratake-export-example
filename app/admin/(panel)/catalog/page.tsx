'use client';

import { useState } from 'react';
import { admDelete, admPatch, admPost, confirmDlg, Empty, EmptyRow, Field, ImageUpload, Modal, money, Skel, useLoad, useAdmLang, type AdmLang } from '../../ui';
import { CsvImport } from '../../CsvImport';

interface Item {
  id: string;
  categoryId: string;
  name: string;
  nameZh?: string | null;
  description?: string | null;
  descriptionZh?: string | null;
  priceCents: number;
  imageUrl?: string | null;
  available: boolean;
  taxable?: boolean;
  badges: string[];
  durationMin?: number | null;
  depositCents?: number | null;
  modifiers: { name: string; min: number; max: number; options: { name: string; priceCents: number }[] }[];
}
interface Category {
  id: string;
  name: string;
  nameZh?: string | null;
  type: string;
  items: Item[];
}

const BADGES = ['popular', 'new', 'spicy', 'vegan', 'vegetarian', 'gf'];
const BADGE_LABELS: Record<string, [string, string]> = {
  popular: ['popular', '熱門'],
  new: ['new', '新品'],
  spicy: ['spicy', '辣'],
  vegan: ['vegan', '純素'],
  vegetarian: ['vegetarian', '素食'],
  gf: ['gf', '無麩質'],
};
function badgeLabel(b: string, lang: AdmLang): string {
  const l = BADGE_LABELS[b];
  return l ? (lang === 'zh' ? l[1] : l[0]) : b;
}
const CAT_TYPE_LABELS: Record<string, [string, string]> = {
  MENU: ['Menu', '菜單'],
  PRODUCT: ['Product', '商品'],
  SERVICE: ['Service', '服務'],
};

export default function CatalogPage() {
  const { data, reload, loading } = useLoad<{ categories: Category[] }>('/catalog');
  const { lang, t } = useAdmLang();
  const [editing, setEditing] = useState<Partial<Item> | null>(null);
  const [newCat, setNewCat] = useState(false);
  const [importCat, setImportCat] = useState<Category | null>(null);
  const cats = data?.categories ?? [];
  const hasServices = cats.some((c) => c.type === 'SERVICE');

  // swap two neighbours and persist the whole order — the storefront mirrors it
  const moveItem = async (cat: Category, idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= cat.items.length) return;
    const ids = cat.items.map((i) => i.id);
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    await admPatch('/catalog/reorder', { itemIds: ids });
    reload();
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 className="adm-page-title">{t('Catalog', '目錄')}</h1>
          <p className="adm-page-sub">{t('Menu items, products, and services shown on your site.', '顯示在網站上的菜單品項、商品與服務。')}</p>
        </div>
        <a className="adm-btn" href="/api/v1/admin/catalog/export.csv" download>
          ⬇ CSV
        </a>
        {/* the other half of that download: edit the file, send it back */}
        <CsvImport
          endpoint="/catalog/import"
          headers={['category', 'name', 'nameZh', 'price', 'description', 'available']}
          sample={['Appetizers', 'Spring Rolls', '春捲', '7.95', 'Crisp, four to an order', '1']}
          exportHref="/api/v1/admin/catalog/export.csv"
          onDone={reload}
        />
        <button className="adm-btn" onClick={() => setNewCat(true)}>
          + {t('Category', '分類')}
        </button>
      </div>

      {loading && cats.length === 0 && (
        <div className="adm-card" style={{ padding: 20 }} aria-hidden>
          <Skel w={160} h={15} />
          <Skel w="70%" h={12} style={{ marginTop: 14, display: 'block' }} />
          <Skel w="52%" h={12} style={{ marginTop: 10, display: 'block' }} />
        </div>
      )}
      {!loading && cats.length === 0 && (
        <div className="adm-card">
          <Empty>
            {t(
              'Your catalog is empty — + Category creates the first section (Menu, Products, or Services), and items live inside it.',
              '目錄還是空的——用「+ 分類」建立第一個分類（菜單、商品或服務），品項都放在分類裡。',
            )}
          </Empty>
        </div>
      )}
      {cats.map((cat) => (
        <div key={cat.id} className="adm-card" style={{ marginBottom: 18 }}>
          <div style={{ padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--a-border)' }}>
            <strong style={{ fontSize: 14.5 }}>{cat.name}</strong>
            {cat.nameZh && <span style={{ color: 'var(--a-faint)', fontSize: 13 }}>{cat.nameZh}</span>}
            <span className="adm-pill" data-tone="muted">{CAT_TYPE_LABELS[cat.type] ? (lang === 'zh' ? CAT_TYPE_LABELS[cat.type][1] : CAT_TYPE_LABELS[cat.type][0]) : cat.type}</span>
            <span style={{ flex: 1 }} />
            <button className="adm-btn adm-btn-sm" onClick={() => setEditing({ categoryId: cat.id, available: true, badges: [], modifiers: [], priceCents: 0 })}>
              + {t('Item', '品項')}
            </button>
            <button className="adm-btn adm-btn-sm" onClick={() => setImportCat(cat)}>
              {t('Paste import', '貼上匯入')}
            </button>
            <button
              className="adm-btn adm-btn-sm adm-btn-danger"
              onClick={async () => {
                if (await confirmDlg(t(`Delete category "${cat.name}" and all its items?`, `要刪除分類「${cat.name}」與其所有品項嗎？`), { confirmLabel: t('Delete category', '刪除分類') })) {
                  await admDelete(`/catalog/categories/${cat.id}`);
                  reload();
                }
              }}
            >
              ✕
            </button>
          </div>
          <table className="adm-table">
            <tbody>
              {cat.items.length === 0 && (
                <EmptyRow colSpan={6}>
                  {t('No items in this category yet — + Item adds the first one.', '這個分類還沒有品項——用「+ 品項」新增第一個。')}
                </EmptyRow>
              )}
              {cat.items.map((it, idx) => (
                <tr key={it.id} style={{ opacity: it.available ? 1 : 0.5 }}>
                  <td style={{ width: 46, whiteSpace: 'nowrap' }}>
                    <button className="adm-btn adm-btn-sm" disabled={idx === 0} aria-label={t('Move up', '上移')} onClick={() => void moveItem(cat, idx, -1)}>▲</button>
                    <button className="adm-btn adm-btn-sm" disabled={idx === cat.items.length - 1} aria-label={t('Move down', '下移')} onClick={() => void moveItem(cat, idx, 1)}>▼</button>
                  </td>
                  <td style={{ width: 54 }}>
                    {it.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.imageUrl} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 8 }} />
                    ) : (
                      <div style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--a-bg)' }} />
                    )}
                  </td>
                  <td>
                    <strong>{it.name}</strong>
                    {it.nameZh && <span style={{ color: 'var(--a-faint)', marginLeft: 8 }}>{it.nameZh}</span>}
                    <div style={{ fontSize: 12, color: 'var(--a-faint)', maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {it.description}
                    </div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{money(it.priceCents)}</td>
                  <td>
                    {it.badges.map((b) => (
                      <span key={b} className="adm-pill" data-tone="info" style={{ marginRight: 4 }}>{badgeLabel(b, lang)}</span>
                    ))}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      className="adm-btn adm-btn-sm"
                      style={{ marginRight: 6 }}
                      onClick={async () => {
                        await admPatch(`/catalog/items/${it.id}`, { available: !it.available });
                        reload();
                      }}
                    >
                      {it.available ? t('Mark sold out', '標為售完') : t('Restore', '恢復供應')}
                    </button>
                    <button className="adm-btn adm-btn-sm" style={{ marginRight: 6 }} onClick={() => setEditing(it)}>
                      {t('Edit', '編輯')}
                    </button>
                    <button
                      className="adm-btn adm-btn-sm adm-btn-danger"
                      onClick={async () => {
                        if (await confirmDlg(t(`Delete "${it.name}"?`, `要刪除「${it.name}」嗎？`), { confirmLabel: t('Delete', '刪除') })) {
                          await admDelete(`/catalog/items/${it.id}`);
                          reload();
                        }
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {editing && (
        <ItemModal
          item={editing}
          isService={cats.find((c) => c.id === editing.categoryId)?.type === 'SERVICE' || (hasServices && !editing.id)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {newCat && (
        <CategoryModal
          onClose={() => setNewCat(false)}
          onSaved={() => {
            setNewCat(false);
            reload();
          }}
        />
      )}
      {importCat && (
        <PasteImportModal
          category={importCat}
          onClose={() => setImportCat(null)}
          onSaved={() => {
            setImportCat(null);
            reload();
          }}
        />
      )}
    </>
  );
}

/* One line per item: "Name 12.50" / "Name, 12.50" / a pasted CSV-export row.
   Turns a phone-photo of a menu typed into Notes into 40 items in one click. */
function parsePasteLines(text: string): { name: string; priceCents: number; description?: string }[] {
  const out: { name: string; priceCents: number; description?: string }[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('"')) {
      // CSV-export row: category,name,nameZh,price,description,available
      const cells = line.match(/"((?:[^"]|"")*)"|[^,]+/g)?.map((s) => s.replace(/^"|"$/g, '').replaceAll('""', '"').trim()) ?? [];
      const price = parseFloat(cells[3] ?? '');
      if (cells[1] && Number.isFinite(price)) out.push({ name: cells[1], priceCents: Math.round(price * 100), description: cells[4] || undefined });
      continue;
    }
    const m = /^(.+?)[\t,]?\s+\$?(\d+(?:\.\d{1,2})?)$/.exec(line);
    if (m) out.push({ name: m[1].trim(), priceCents: Math.round(parseFloat(m[2]) * 100) });
  }
  return out;
}

function PasteImportModal({ category, onClose, onSaved }: { category: Category; onClose: () => void; onSaved: () => void }) {
  const { t } = useAdmLang();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const parsed = parsePasteLines(text);
  return (
    <Modal title={`${t('Paste import', '貼上匯入')} → ${category.name}`} onClose={onClose}>
      <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--a-faint)' }}>
        {t('One item per line: "Name 12.50". Pasted CSV export rows also work.', '一行一個品項：「品名 12.50」。貼上 CSV 匯出的內容也可以。')}
      </p>
      <textarea
        className="adm-input"
        rows={10}
        style={{ width: '100%', fontFamily: 'monospace', fontSize: 13 }}
        placeholder={'Beef Noodle Soup 12.50\nDan Dan Noodles 10.90'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--a-faint)', flex: 1 }}>
          {t(`${parsed.length} item(s) recognized`, `已辨識 ${parsed.length} 個品項`)}
        </span>
        <button className="adm-btn" onClick={onClose}>{t('Cancel', '取消')}</button>
        <button
          className="adm-btn adm-btn-primary"
          disabled={busy || parsed.length === 0}
          onClick={async () => {
            setBusy(true);
            setErr('');
            try {
              await admPost('/catalog/items/bulk', { categoryId: category.id, items: parsed });
              onSaved();
            } catch (e) {
              setErr(e instanceof Error ? e.message : t('Import failed', '匯入失敗'));
              setBusy(false);
            }
          }}
        >
          {busy ? t('Importing…', '匯入中…') : t(`Import ${parsed.length}`, `匯入 ${parsed.length} 項`)}
        </button>
      </div>
      {err && <div style={{ marginTop: 8, fontSize: 13, color: 'var(--a-danger)' }}>{err}</div>}
    </Modal>
  );
}

function CategoryModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [nameZh, setNameZh] = useState('');
  const [type, setType] = useState('MENU');
  const [saving, setSaving] = useState(false);
  const { t } = useAdmLang();
  return (
    <Modal title={t('New category', '新增分類')} onClose={onClose}>
      <Field label={t('Name', '名稱')}>
        <input className="adm-input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t('Name (中文, optional)', '名稱（中文，選填）')}>
        <input className="adm-input" value={nameZh} onChange={(e) => setNameZh(e.target.value)} />
      </Field>
      <Field label={t('Type', '類型')}>
        <select className="adm-input" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="MENU">{t('Menu (food)', '菜單（餐飲）')}</option>
          <option value="PRODUCT">{t('Product', '商品')}</option>
          <option value="SERVICE">{t('Service (bookable)', '服務（可預約）')}</option>
        </select>
      </Field>
      <button
        className="adm-btn adm-btn-primary"
        disabled={!name || saving}
        onClick={async () => {
          if (saving) return;
          setSaving(true);
          try {
            await admPost('/catalog/categories', { name, nameZh: nameZh || undefined, type });
            onSaved();
          } catch (e) {
            alert(e instanceof Error ? e.message : t('Could not create. Please try again', '建立失敗,請再試一次'));
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? t('Creating…', '建立中…') : t('Create category', '建立分類')}
      </button>
    </Modal>
  );
}

function ItemModal({
  item,
  isService,
  onClose,
  onSaved,
}: {
  item: Partial<Item>;
  isService: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Partial<Item>>({ ...item });
  const [busy, setBusy] = useState(false);
  const { lang, t } = useAdmLang();
  const set = (patch: Partial<Item>) => setForm((f) => ({ ...f, ...patch }));

  async function save() {
    if (busy) return; // block double-submit → no duplicate item on a laggy tap
    setBusy(true);
    try {
      const payload = {
        categoryId: form.categoryId,
        name: form.name,
        nameZh: form.nameZh || null,
        description: form.description || null,
        descriptionZh: form.descriptionZh || null,
        priceCents: form.priceCents ?? 0,
        imageUrl: form.imageUrl ?? null,
        badges: form.badges ?? [],
        taxable: form.taxable ?? true,
        durationMin: form.durationMin ?? null,
        depositCents: form.depositCents ?? null,
        modifiers: form.modifiers ?? [],
      };
      if (form.id) await admPatch(`/catalog/items/${form.id}`, payload);
      else await admPost('/catalog/items', payload);
      onSaved();
    } catch (e) {
      // was silently leaving the modal open with no feedback on a failed save
      alert(e instanceof Error ? e.message : t('Could not save. Please try again', '儲存失敗,請再試一次'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={form.id ? t(`Edit · ${item.name}`, `編輯 · ${item.name}`) : t('New item', '新增品項')} onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label={t('Name', '名稱')}>
          <input className="adm-input" value={form.name ?? ''} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label={t('Name (中文)', '名稱（中文）')}>
          <input className="adm-input" value={form.nameZh ?? ''} onChange={(e) => set({ nameZh: e.target.value })} />
        </Field>
      </div>
      <Field label={t('Description', '說明')}>
        <textarea className="adm-input" rows={2} value={form.description ?? ''} onChange={(e) => set({ description: e.target.value })} />
      </Field>
      <Field label={t('Description (中文)', '說明（中文）')}>
        <textarea className="adm-input" rows={2} value={form.descriptionZh ?? ''} onChange={(e) => set({ descriptionZh: e.target.value })} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: isService ? '1fr 1fr 1fr' : '1fr', gap: 12 }}>
        <Field label={t('Price (USD)', '價格（美元）')}>
          <input
            className="adm-input"
            type="number"
            min="0"
            step="0.01"
            value={form.priceCents != null ? (form.priceCents / 100).toString() : ''}
            onChange={(e) => set({ priceCents: Math.round(parseFloat(e.target.value || '0') * 100) })}
          />
        </Field>
        {isService && (
          <>
            <Field label={t('Duration (min)', '時長（分鐘）')}>
              <input className="adm-input" type="number" value={form.durationMin ?? ''} onChange={(e) => set({ durationMin: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            <Field label={t('Deposit (USD)', '訂金（美元）')}>
              <input
                className="adm-input"
                type="number"
                min="0"
                step="0.01"
                value={form.depositCents != null ? (form.depositCents / 100).toString() : ''}
                onChange={(e) => set({ depositCents: e.target.value ? Math.round(parseFloat(e.target.value) * 100) : null })}
              />
            </Field>
          </>
        )}
      </div>
      <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13.5 }}>
        <input type="checkbox" checked={form.taxable ?? true} onChange={(e) => set({ taxable: e.target.checked })} />
        {t('Taxable', '需課稅')}
      </label>
      <p style={{ margin: '2px 0 14px 26px', fontSize: 12, color: 'var(--a-faint)' }}>
        {t('Uncheck for tax-exempt services', '免稅服務請取消勾選')}
      </p>
      <Field label={t('Photo', '照片')}>
        <ImageUpload value={form.imageUrl ?? null} onChange={(url) => set({ imageUrl: url })} />
      </Field>
      <Field label={t('Badges', '標籤')}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {BADGES.map((b) => {
            const on = (form.badges ?? []).includes(b);
            return (
              <button
                key={b}
                className="adm-btn adm-btn-sm"
                style={on ? { background: 'var(--a-primary-soft)', borderColor: 'var(--a-primary)', color: 'var(--a-primary)' } : undefined}
                onClick={() => set({ badges: on ? (form.badges ?? []).filter((x) => x !== b) : [...(form.badges ?? []), b] })}
              >
                {badgeLabel(b, lang)}
              </button>
            );
          })}
        </div>
      </Field>
      <ModifierEditor value={form.modifiers ?? []} onChange={(m) => set({ modifiers: m })} />
      <button className="adm-btn adm-btn-primary" disabled={busy || !form.name} onClick={save} style={{ marginTop: 8 }}>
        {busy ? t('Saving…', '儲存中…') : t('Save item', '儲存品項')}
      </button>
    </Modal>
  );
}

function ModifierEditor({
  value,
  onChange,
}: {
  value: Item['modifiers'];
  onChange: (m: Item['modifiers']) => void;
}) {
  const { t } = useAdmLang();
  return (
    <Field label={t(`Options & add-ons (${value.length} groups)`, `選項與加購（${value.length} 組）`)}>
      {value.map((g, gi) => (
        <div key={gi} style={{ border: '1px solid var(--a-border)', borderRadius: 10, padding: 12, marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input className="adm-input" placeholder={t('Group name (e.g. Size)', '群組名稱（例如：尺寸）')} value={g.name} onChange={(e) => onChange(value.map((x, i) => (i === gi ? { ...x, name: e.target.value } : x)))} />
            <select
              className="adm-input"
              style={{ width: 130 }}
              value={g.min > 0 ? 'required' : 'optional'}
              onChange={(e) => onChange(value.map((x, i) => (i === gi ? { ...x, min: e.target.value === 'required' ? 1 : 0 } : x)))}
            >
              <option value="optional">{t('Optional', '選填')}</option>
              <option value="required">{t('Required', '必填')}</option>
            </select>
            <select
              className="adm-input"
              style={{ width: 120 }}
              value={g.max}
              onChange={(e) => onChange(value.map((x, i) => (i === gi ? { ...x, max: Number(e.target.value) } : x)))}
            >
              <option value={1}>{t('Pick 1', '選 1 項')}</option>
              <option value={3}>{t('Up to 3', '最多 3 項')}</option>
              <option value={5}>{t('Up to 5', '最多 5 項')}</option>
            </select>
            <button className="adm-btn adm-btn-sm adm-btn-danger" onClick={() => onChange(value.filter((_, i) => i !== gi))}>
              ✕
            </button>
          </div>
          {g.options.map((o, oi) => (
            <div key={oi} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <input className="adm-input" placeholder={t('Option', '選項')} value={o.name} onChange={(e) => onChange(value.map((x, i) => (i === gi ? { ...x, options: x.options.map((y, j) => (j === oi ? { ...y, name: e.target.value } : y)) } : x)))} />
              <input
                className="adm-input"
                style={{ width: 110 }}
                type="number"
                step="0.01"
                placeholder="+$"
                value={o.priceCents ? (o.priceCents / 100).toString() : ''}
                onChange={(e) => onChange(value.map((x, i) => (i === gi ? { ...x, options: x.options.map((y, j) => (j === oi ? { ...y, priceCents: Math.round(parseFloat(e.target.value || '0') * 100) } : y)) } : x)))}
              />
              <button className="adm-btn adm-btn-sm" onClick={() => onChange(value.map((x, i) => (i === gi ? { ...x, options: x.options.filter((_, j) => j !== oi) } : x)))}>
                ✕
              </button>
            </div>
          ))}
          <button className="adm-btn adm-btn-sm" onClick={() => onChange(value.map((x, i) => (i === gi ? { ...x, options: [...x.options, { name: '', priceCents: 0 }] } : x)))}>
            + {t('Option', '選項')}
          </button>
        </div>
      ))}
      <button className="adm-btn adm-btn-sm" onClick={() => onChange([...value, { name: '', min: 0, max: 1, options: [{ name: '', priceCents: 0 }] }])}>
        + {t('Add option group', '新增選項群組')}
      </button>
    </Field>
  );
}

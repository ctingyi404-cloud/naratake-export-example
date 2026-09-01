'use client';

/* POS register: product grid, modifier picker, live quote, cash/terminal payment
   with terminal void safety, deposit credit from bookings, shift Z-report.

   The register survives a dead internet. It keeps a catalog snapshot on the
   device, prices carts with the SAME computeQuote the server calls, takes CASH
   ONLY while offline — lib/pos-offline.ts OFFLINE_LIMITS says exactly why each
   other tender is refused — and queues every cash sale under a client-generated
   key until the connection comes back. Nothing here re-implements money. */

import { useEffect, useRef, useState } from 'react';
import { admGet, admPatch, admPost, confirmDlg, Field, Modal, money, useLoad, useAdmLang } from '../../ui';
import {
  advance,
  browserKV,
  buildSnapshot,
  isOfflineError,
  loadQueue,
  loadSnapshot,
  makeSaleKey,
  needsLookup,
  newSale,
  offlineBlockers,
  OFFLINE_LIMITS,
  parkedSale,
  postQueuedSale,
  priceOffline,
  provisionalCode,
  pruneQueue,
  queueStatus,
  reconcileEvents,
  saleNote,
  saveQueue,
  saveSnapshot,
  sendable,
  type CatalogSnapshot,
  type OfflineLimit,
  type QueuedSale,
  type QueueStatus,
  type SnapCategory,
  type SnapItem,
  type SnapModifierGroup,
  type SnapNamed,
  type SyncEvent,
} from '@/lib/pos-offline';

/* The grid renders the live catalog and the offline snapshot interchangeably,
   so the two shapes are one shape — a snapshot that cannot drive the grid is a
   snapshot that only works until you need it. */
type ModifierGroup = SnapModifierGroup;
type Item = SnapItem;
type Category = SnapCategory;
interface Line {
  key: string;
  item: Item;
  qty: number;
  modifiers: string[];
  unitCents: number;
}
/* Money the books cannot call settled yet. The server counts it at every look
   and refuses to let it leave in silence; the register refuses to let it leave
   at all without a deliberate override (CloseShiftButton). */
interface Unresolved {
  /** payment rows with no final answer yet (processing, flagged, …) */
  pendingPayments: number;
  /** sales in the window that recorded no tender at all */
  salesWithoutPayment: number;
  count: number;
}
interface ShiftInfo {
  shift: { id: string; openedAt: string; openingCashCents: number } | null;
  live?: {
    orders: number;
    grossCents: number;
    cashCents: number;
    cardCents: number;
    /** mock-reader charges, kept OUT of cardCents — see SIM_INK */
    simulatedCardCents?: number;
    tipsCents: number;
  };
  unresolved?: Unresolved;
}
interface ZBucketRow {
  terminalId: string | null; // null = orders rung with no station picked
  name: string;
  orders: number;
  grossCents: number;
  taxCents: number;
  tipsCents: number;
  cashCents: number;
  cardCents: number;
  simulatedCardCents?: number;
}
interface ZTotals {
  orders: number;
  grossCents: number;
  taxCents: number;
  tipsCents: number;
  cashCents: number;
  cardCents: number;
  /** optional because a shift closed before this line existed stored its totals
      without it — an old Z-report must still open, just with nothing to say */
  simulatedCardCents?: number;
  giftCents: number;
  canceledOrders: number;
  canceledCashKeptCents: number;
  canceledCashRefundedCents: number;
  expectedDrawerCents: number;
  countedDrawerCents: number;
  overShortCents: number;
  byTerminal?: ZBucketRow[];
}
/** what POST /pos/shifts/close answers with */
interface CloseResult {
  totals: ZTotals;
  unresolved?: Unresolved;
  /** the server's own bilingual sentence, present only when count > 0 */
  warning?: string;
}
type TerminalRow = SnapNamed;
interface PosQuote {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  depositAppliedCents: number;
  giftAppliedCents: number;
  totalCents: number;
}
interface Receipt {
  code: string;
  totalCents: number;
  taxCents: number;
  discountCents: number;
  depositAppliedCents?: number;
  giftAppliedCents?: number;
  changeCents: number;
  lines: { name: string; qty: number; unitCents: number }[];
  method: string;
  /** taken with no server: this is a promise of an order, not an order */
  offline?: boolean;
}

/** what every /pos/terminal/* route answers with: a status, and the id of the
    one physical charge it is talking about (null only when there is nothing to
    charge — a $0 cart after a deposit or gift card) */
interface TerminalReply {
  status: string;
  externalId: string | null;
  chargedCents?: number;
  simulated?: boolean;
}

type StaffRow = SnapNamed;

/* required option groups default to their first option (the old silent default,
   made visible and editable by the picker) */
const defaultMods = (item: Item) =>
  item.modifiers.filter((g) => g.min > 0).map((g) => g.options[0]?.name).filter(Boolean) as string[];

const chosenMods = (item: Item, mods: string[]) =>
  item.modifiers.flatMap((g) => g.options).filter((o) => mods.includes(o.name));

const unitPriceWith = (item: Item, mods: string[]) =>
  item.priceCents + chosenMods(item, mods).reduce((s, o) => s + o.priceCents, 0);

type T = (en: string, zh: string) => string;

/* Why a tender is dark, in the cashier's words. WHICH limits exist lives in
   lib/pos-offline.ts OFFLINE_LIMITS, so a disabled button and its explanation
   cannot drift apart; only the wording is here, because wording is UI. */
function limitReason(l: OfflineLimit, t: T): string {
  switch (l) {
    case 'card':
      return t(
        'Card payments need the internet — the reader is authorized through our server, and a card nobody asked can still decline.',
        '刷卡需要網路 — 讀卡機是透過伺服器授權的,沒問過的卡片仍可能被拒絕。',
      );
    case 'giftcard':
      return t(
        'Gift cards need the internet — the balance lives in the database and must be deducted there, or the same card gets spent twice.',
        '禮品卡需要網路 — 餘額在資料庫,必須在那裡扣除,否則同一張卡會被重複使用。',
      );
    case 'coupon':
      return t(
        'Coupon codes need the internet to check the expiry and the redemption limit. Use the discount box — that is plain arithmetic.',
        '優惠碼需要網路才能檢查效期與使用上限;請改用折扣欄位,那只是單純算數。',
      );
    case 'loyalty':
      return t(
        'Member points need the internet — the balance is on the member record, and points spent offline cannot be deducted.',
        '會員點數需要網路 — 餘額在會員資料上,離線折抵無法真的扣點。',
      );
    case 'deposit':
      return t(
        'A booking deposit needs the internet — it can only be credited once, and only the database knows whether it already was.',
        '預約訂金需要網路 — 訂金只能折抵一次,只有資料庫知道是不是已經折抵過了。',
      );
  }
}

const shortTime = (ms: number) => new Date(ms).toLocaleTimeString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* Simulated register charges are not revenue: nothing settles and no bank will
   ever pay them out. They are SHOWN — a shift on a site with no reader takes
   real orders, and a report that says it took no card money at all is a lie in
   the other direction — but never in the same ink as money. */
const SIM_INK = { color: 'var(--a-faint)', fontStyle: 'italic' } as const;
const simNote = (t: T) =>
  t(
    'Simulated reader — training charges. Nothing settles and no bank pays them out, so they are reported apart from card revenue.',
    '模擬讀卡機 — 練習用的刷卡,不會結算也不會有銀行入帳,因此與刷卡營收分開列示。',
  );

/* The reader's window, held by the register instead of by one long request.
   The charge is STARTED, then asked about, so nothing spans the customer's
   decision and the intent id is in our hands from the first millisecond. */
const POLL_MS = 1500;
const READER_WINDOW_MS = 45_000;

/* The card charge that is on the reader RIGHT NOW, persisted exactly the way the
   offline queue persists a sale: same device storage, written before it can
   matter, and a write that fails is reported instead of assumed. Without it a
   tab that dies between "start" and "ring up" leaves a live authorisation that
   nobody can name — which is the whole reason the two-step flow exists. */
const CHARGE_KEY = 'adm.pos.charge';
interface HeldCharge {
  externalId: string;
  at: number;
}
const rememberCharge = (externalId: string) =>
  browserKV.set(CHARGE_KEY, JSON.stringify({ externalId, at: Date.now() } satisfies HeldCharge));
const forgetCharge = () => browserKV.remove(CHARGE_KEY);
function loadCharge(): HeldCharge | null {
  const raw = browserKV.get(CHARGE_KEY);
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as HeldCharge;
    return typeof c?.externalId === 'string' ? c : null;
  } catch {
    return null;
  }
}

export default function PosPage() {
  const { data: catalog, reload: reloadCatalog } = useLoad<{ categories: Category[] }>('/catalog');
  const { data: shiftData, reload: reloadShift } = useLoad<ShiftInfo>('/pos/shifts/current');
  const { data: staffData } = useLoad<{ staff: StaffRow[] }>('/staff');
  // the tax rate is the one piece of the total the catalog does not carry
  const { data: bizData, reload: reloadBiz } = useLoad<{ taxRateBp: number }>('/settings');
  const { t } = useAdmLang();
  const [snapshot, setSnapshot] = useState<CatalogSnapshot | null>(null);
  const staff = (staffData?.staff ?? snapshot?.staff ?? []).filter((s) => s.active);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [activeCat, setActiveCat] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [discount, setDiscount] = useState('');
  const [tip, setTip] = useState('');
  const [gift, setGift] = useState('');
  const [paying, setPaying] = useState<null | 'cash' | 'terminal'>(null);
  const [tendered, setTendered] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [closed, setClosed] = useState<CloseResult | null>(null);
  const [error, setError] = useState('');
  const [picking, setPicking] = useState<Item | null>(null);
  // a terminal charge that did NOT become a recorded sale — never silent.
  // `recovered` means we found it on disk at boot instead of watching it happen.
  const [voidInfo, setVoidInfo] = useState<
    { externalId: string; autoVoided: boolean; recovered?: boolean } | null
  >(null);
  // a charge waiting on the reader right now: id known, countdown running
  const [reader, setReader] = useState<
    { externalId: string; since: number; amountCents?: number; saved: boolean } | null
  >(null);
  const [abandoning, setAbandoning] = useState(false);
  const giveUp = useRef(false);
  // this device's station — persisted so the register keeps its identity
  const { data: termData } = useLoad<{ terminals: TerminalRow[] }>('/terminals');
  const terminals = (termData?.terminals ?? snapshot?.terminals ?? []).filter((tm) => tm.active);
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [pickTerm, setPickTerm] = useState(false);
  const pickTerminal = (id: string) => {
    localStorage.setItem('adm.terminal', id);
    setTerminalId(id);
    setPickTerm(false);
  };
  useEffect(() => {
    // a register that booted offline resolves its station from the snapshot —
    // waiting for /terminals would leave every offline sale unassigned
    if (!termData && !snapshot) return;
    const saved = localStorage.getItem('adm.terminal');
    if (terminals.some((tm) => tm.id === saved)) setTerminalId(saved);
    else if (terminals.length === 1) pickTerminal(terminals[0].id); // only one register — no ceremony
    else if (terminals.length > 1) setPickTerm(true); // first use: "this device is…"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termData, snapshot]);
  const terminal = terminals.find((tm) => tm.id === terminalId) ?? null;
  // appointment → checkout: /admin/pos?item=…&staff=…&appt=…&deposit=…
  const [fromAppt, setFromAppt] = useState<{ id: string; label: string; depositCents: number } | null>(null);
  const prefilled = useRef(false);

  const cats = (catalog?.categories ?? snapshot?.categories ?? []).filter((c) =>
    c.items.some((i) => i.available),
  );
  const subtotal = lines.reduce((s, l) => s + l.unitCents * l.qty, 0);
  const discountCents = Math.min(Math.round(parseFloat(discount || '0') * 100), subtotal);
  const tipCents = Math.round(parseFloat(tip || '0') * 100);

  function addLine(item: Item, mods: string[]) {
    const unit = unitPriceWith(item, mods);
    const key = `${item.id}|${[...mods].sort().join(',')}`;
    setLines((prev) => {
      const ex = prev.find((l) => l.key === key);
      if (ex) return prev.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { key, item, qty: 1, modifiers: mods, unitCents: unit }];
    });
  }

  // items with option groups open the picker; plain items ring straight in
  function tapItem(item: Item) {
    if ((item.modifiers ?? []).length === 0) addLine(item, []);
    else setPicking(item);
  }

  const cartPayload = () => ({
    items: lines.map((l) => ({ itemId: l.item.id, qty: l.qty, modifiers: l.modifiers })),
    discountCents,
    tipCents,
    giftCardCode: gift.trim() ? gift.trim().toUpperCase() : undefined,
    // bookings handoff: the already-paid deposit rides as a tender line
    depositCredit:
      fromAppt && fromAppt.depositCents > 0
        ? { appointmentId: fromAppt.id, cents: fromAppt.depositCents }
        : undefined,
  });

  /* ── connectivity ─────────────────────────────────────────────────────────
     navigator.onLine only knows whether the device has a link, not whether our
     server is behind it, so it is one of three signals: the event, a failed
     request (isOfflineError), and a probe while we believe we are down. */
  const [net, setNet] = useState<'online' | 'offline'>('online');
  const probeRef = useRef<() => void>(() => {});
  probeRef.current = () => {
    admGet('/pos/shifts/current')
      .then(() => setNet('online'))
      // the server ANSWERED — it is reachable even if it disliked the request
      .catch((e) => !isOfflineError(e) && setNet('online'));
  };
  useEffect(() => {
    // set after mount, never during render: a server-rendered "online" that
    // hydrates as "offline" is a mismatch, and this is cheap to correct
    if (!navigator.onLine) setNet('offline');
    const down = () => setNet('offline');
    const up = () => probeRef.current();
    window.addEventListener('offline', down);
    window.addEventListener('online', up);
    return () => {
      window.removeEventListener('offline', down);
      window.removeEventListener('online', up);
    };
  }, []);
  useEffect(() => {
    if (net !== 'offline') return;
    const id = setInterval(() => probeRef.current(), 10_000);
    return () => clearInterval(id);
  }, [net]);

  /* ── the queue ────────────────────────────────────────────────────────────
     queueRef mirrors the state so the sync loop reads what it just wrote
     without waiting for a render. commitQueue is the only writer, and its
     boolean is load-bearing: false means the device refused to store the sale,
     and the cashier must not be told the money is safe. */
  const [queue, setQueue] = useState<QueuedSale[]>([]);
  const queueRef = useRef<QueuedSale[]>([]);
  const [storageBroken, setStorageBroken] = useState(false);
  const commitQueue = (next: QueuedSale[]) => {
    queueRef.current = next;
    setQueue(next);
    const ok = saveQueue(browserKV, next);
    if (!ok) setStorageBroken(true);
    return ok;
  };
  const applyEvent = (key: string, e: SyncEvent) =>
    commitQueue(queueRef.current.map((s) => (s.key === key ? advance(s, e) : s)));

  /* ── catalog snapshot ─────────────────────────────────────────────────────
     Refreshed on every load that reaches the server, and only then: a register
     that booted offline must keep the last snapshot it actually confirmed. */
  const [snapStored, setSnapStored] = useState(true);
  const [queueCorrupt, setQueueCorrupt] = useState(false);
  useEffect(() => {
    const { entries, corrupt } = loadQueue(browserKV);
    const kept = pruneQueue(entries);
    queueRef.current = kept;
    setQueue(kept);
    setSnapshot(loadSnapshot(browserKV));
    setQueueCorrupt(corrupt);
    /* A card charge this device started and never finished. We do not ask what
       it became — "Void last charge" already answers that safely for every case
       (already a sale, capturable, never captured), and asking first would only
       add a way to be wrong before the cashier is even told. */
    const held = loadCharge();
    if (held) setVoidInfo({ externalId: held.externalId, autoVoided: false, recovered: true });
  }, []);
  useEffect(() => {
    if (!catalog || !bizData) return;
    const snap = buildSnapshot({
      categories: catalog.categories,
      taxRateBp: bizData.taxRateBp,
      shift: shiftData?.shift ?? null,
      staff: staffData?.staff ?? [],
      terminals: termData?.terminals ?? [],
    });
    setSnapshot(snap);
    setSnapStored(saveSnapshot(browserKV, snap));
  }, [catalog, bizData, shiftData, staffData, termData]);

  /* Keep the snapshot current: the moment the link comes back, and slowly while
     it holds. A price the owner changed at noon must not still be ringing at
     six because the register happened to load before lunch. */
  const wasOffline = useRef(false);
  useEffect(() => {
    if (net === 'offline') {
      wasOffline.current = true;
      return;
    }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    reloadCatalog();
    reloadBiz();
    reloadShift();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net]);
  useEffect(() => {
    if (net !== 'online') return;
    const id = setInterval(() => {
      reloadCatalog();
      reloadBiz();
    }, 10 * 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net]);

  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);
  const lastSyncRef = useRef(0);
  const syncRef = useRef<(force?: boolean) => void>(() => {});
  syncRef.current = (force) => void syncNow(force);

  /* `force` is the cashier pressing the button. Everything else waits out the
     cooldown: a sale the server keeps deferring (signed out, rate-limited)
     changes the queue on every pass, which re-triggers the effect below, which
     would otherwise retry as fast as the network allows. */
  async function syncNow(force = false) {
    if (syncingRef.current || net === 'offline') return;
    if (!force && Date.now() - lastSyncRef.current < 3_000) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      // sales whose fate is unknown are resolved by LOOKING first. Re-sending
      // one that already landed is how a drawer sale becomes two orders.
      if (needsLookup(queueRef.current).length > 0) {
        try {
          const PAGE = 200;
          const res = await admGet<{ orders: { code: string; notes?: string | null; totalCents: number }[] }>(
            `/orders?days=3&pageSize=${PAGE}`,
          );
          // a full page is a capped page, and a capped page cannot prove absence.
          // Concluding "not found" from one would re-send a sale that is sitting
          // just past the cut — the exact duplicate this lookup exists to stop.
          const capped = res.orders.length >= PAGE;
          for (const { key, event } of reconcileEvents(queueRef.current, res.orders)) {
            if (event.type === 'notFound' && capped) continue;
            applyEvent(key, event);
          }
        } catch (e) {
          if (isOfflineError(e)) {
            setNet('offline');
            return;
          }
          // cannot look right now: leaving them UNCERTAIN is the honest state
        }
      }
      for (const s of sendable(queueRef.current)) {
        applyEvent(s.key, { type: 'send' });
        // raw fetch, not admPost: the status code IS the decision (reject vs
        // retry vs "we do not know"), and adm() throws it away. It also means a
        // 401 mid-sync becomes a deferred sale instead of yanking the cashier
        // to the login page with a cart on screen.
        const event = await postQueuedSale(s, (url, init) => fetch(url, init));
        applyEvent(s.key, event);
        if (event.type === 'recorded' && s.apptId)
          await admPatch(`/appointments/${s.apptId}`, { status: 'COMPLETED' }).catch(() => {});
        if (event.type !== 'recorded' && event.type !== 'reject') {
          // the link is unreliable or we are signed out — stop hammering
          if (!navigator.onLine) setNet('offline');
          break;
        }
      }
      reloadShift();
    } finally {
      // measured from completion, so a slow pass does not immediately earn another
      lastSyncRef.current = Date.now();
      syncingRef.current = false;
      setSyncing(false);
    }
  }

  const pendingWork = (list: QueuedSale[]) => sendable(list).length + needsLookup(list).length;
  useEffect(() => {
    if (net === 'online' && pendingWork(queue) > 0) syncRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net, queue]);
  useEffect(() => {
    if (net !== 'online') return;
    // a deferred or half-drained queue gets another chance without a click
    const id = setInterval(() => pendingWork(queueRef.current) > 0 && syncRef.current(), 30_000);
    return () => clearInterval(id);
  }, [net]);

  const qStatus = queueStatus(queue);
  const offline = net === 'offline';

  /* ── pricing ──────────────────────────────────────────────────────────────
     Online the server prices (it alone knows gift balances and deposits).
     Offline the SAME computeQuote runs here, over the snapshot's prices. */
  const calcLines = () =>
    lines.map((l) => ({
      itemId: l.item.id,
      name: l.item.name,
      qty: l.qty,
      unitCents: l.unitCents,
      modifiers: chosenMods(l.item, l.modifiers),
      taxable: l.item.taxable,
    }));

  const localQuote = (): PosQuote | null => {
    if (!snapshot || lines.length === 0) return null;
    const q = priceOffline(calcLines(), {
      taxRateBp: snapshot.taxRateBp,
      discountCents,
      tipCents,
    });
    return {
      subtotalCents: q.subtotalCents,
      discountCents: q.discountCents,
      taxCents: q.taxCents,
      depositAppliedCents: 0, // both need the database — see blockers below
      giftAppliedCents: 0,
      totalCents: q.totalCents,
    };
  };

  const [quote, setQuote] = useState<PosQuote | null>(null);
  const [quoteErr, setQuoteErr] = useState('');
  useEffect(() => {
    if (lines.length === 0) {
      setQuote(null);
      setQuoteErr('');
      return;
    }
    if (offline) {
      const local = localQuote();
      setQuote(local);
      setQuoteErr(
        local
          ? ''
          : t(
              'No offline price list on this device. Connect once to download it.',
              '本機沒有離線價目表,請先連上網路下載一次。',
            ),
      );
      return;
    }
    let alive = true;
    const tm = setTimeout(() => {
      admPost<PosQuote>('/pos/quote', cartPayload())
        .then((q) => {
          if (!alive) return;
          setQuote(q);
          setQuoteErr('');
        })
        .catch((e) => {
          if (!alive) return;
          // the network died mid-quote: flip offline and let this effect rerun,
          // which prices the same cart locally instead of showing nothing
          if (isOfflineError(e)) {
            setNet('offline');
            return;
          }
          setQuote(null);
          setQuoteErr(e instanceof Error ? e.message : t('Quote failed', '試算失敗'));
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(tm);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, discountCents, tipCents, gift, fromAppt, offline, snapshot]);

  // what this cart cannot honestly do offline, right now
  const blockers: OfflineLimit[] = offline
    ? offlineBlockers({ giftCode: gift, depositCents: fromAppt?.depositCents })
    : [];

  // when arriving from an appointment, drop its service into the cart and
  // preselect the staff member, once the catalog has loaded
  useEffect(() => {
    if (prefilled.current || !catalog) return;
    const params = new URLSearchParams(window.location.search);
    const itemId = params.get('item');
    if (!itemId) return;
    prefilled.current = true;
    const item = catalog.categories.flatMap((c) => c.items).find((i) => i.id === itemId);
    if (item) addLine(item, defaultMods(item));
    const staffParam = params.get('staff');
    if (staffParam) setStaffId(staffParam);
    const apptId = params.get('appt');
    if (apptId)
      setFromAppt({
        id: apptId,
        label: item?.name ?? '',
        depositCents: Math.max(0, parseInt(params.get('deposit') ?? '0', 10) || 0),
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);

  function clearSale() {
    setLines([]);
    setDiscount('');
    setTip('');
    setGift('');
    setTendered('');
    setPaying(null);
  }

  // the appointment is done with either way; a queued sale closes its booking
  // when it syncs (apptId rides along), so the board never keeps a paid job
  function releaseAppt() {
    if (!fromAppt) return;
    setFromAppt(null);
    window.history.replaceState(null, '', '/admin/pos');
  }

  /* Everything a queued sale needs to be replayed and re-printed. Built from
     the quote the register DISPLAYED as due — server quote online, computeQuote
     offline — because that is the number the drawer was counted against. */
  const saleDraft = (key: string, q: PosQuote, tenderedC: number) => ({
    key,
    cart: {
      items: lines.map((l) => ({ itemId: l.item.id, qty: l.qty, modifiers: l.modifiers })),
      discountCents,
      tipCents,
      giftCardCode: gift.trim() ? gift.trim().toUpperCase() : undefined,
      depositCredit:
        fromAppt && fromAppt.depositCents > 0
          ? { appointmentId: fromAppt.id, cents: fromAppt.depositCents }
          : undefined,
    },
    staffId: staffId ?? undefined,
    terminalId: terminalId ?? undefined,
    apptId: fromAppt?.id,
    totalCents: q.totalCents,
    taxCents: q.taxCents,
    tenderedCents: tenderedC,
    changeCents: Math.max(0, tenderedC - q.totalCents),
    lines: lines.map((l) => ({ name: l.item.name, qty: l.qty, unitCents: l.unitCents })),
  });

  /* Cash with no server. The sale is only "taken" once the device has actually
     written it down — a queue write that fails is a lost sale, and the cashier
     has to hear that BEFORE they hand over the change. */
  function payOffline() {
    setError('');
    const q = localQuote();
    if (!q) {
      setError(t('No offline price list on this device.', '本機沒有離線價目表。'));
      return;
    }
    const tenderedC = Math.round(parseFloat(tendered || '0') * 100);
    if (tenderedC < q.totalCents) {
      setError(t('Not enough cash for this sale.', '現金不足以支付本筆交易。'));
      return;
    }
    const sale = newSale(saleDraft(makeSaleKey(), q, tenderedC));
    if (!commitQueue([...queueRef.current, sale])) {
      setError(
        t(
          'This device could not store the sale. Write it on paper before handing over change.',
          '本機無法儲存這筆交易,請先手寫記錄再找零。',
        ),
      );
      return;
    }
    setReceipt({
      code: provisionalCode(sale),
      totalCents: q.totalCents,
      taxCents: q.taxCents,
      discountCents: q.discountCents,
      changeCents: sale.changeCents,
      lines: sale.lines,
      method: 'cash',
      offline: true,
    });
    releaseAppt();
    clearSale();
  }

  /* ── the card-present charge ──────────────────────────────────────────────
     One physical charge, three short requests instead of one 45-second one:

       POST /pos/terminal/start  → the intent id, immediately
       GET  /pos/terminal/status → asked every POLL_MS while the customer decides
       POST /pos/terminal/abandon → the only way to give up

     Nothing here holds a connection open across a human decision, which is what
     a serverless platform is free to kill. The id exists — on screen and on this
     device — from the first millisecond, so a tab that dies mid-payment leaves a
     charge the cashier can name and void instead of an anonymous authorisation
     on the reader. `onId` publishes it to the caller for exactly that reason. */
  async function collectCard(onId: (id: string | undefined) => void): Promise<TerminalReply> {
    // the cart rides along so the reader charges the EXACT taxed total the order
    // will record (deposit credit and gift tender included)
    const started = await admPost<TerminalReply>('/pos/terminal/start', cartPayload());
    const externalId = started.externalId ?? undefined;
    let saved = false;
    if (externalId) {
      onId(externalId);
      // stored BEFORE the first poll: the only moment this id cannot be
      // re-derived is the one right after it starts existing
      saved = rememberCharge(externalId);
      if (!saved) setStorageBroken(true);
    }
    // a $0 cart and the simulated reader settle inside start — nothing to wait on
    if (started.status !== 'pending' || !externalId) return started;

    giveUp.current = false;
    setAbandoning(false);
    setReader({ externalId, since: Date.now(), amountCents: started.chargedCents, saved });
    try {
      const deadline = Date.now() + READER_WINDOW_MS;
      while (!giveUp.current && Date.now() < deadline) {
        await sleep(POLL_MS);
        // a poll that fails is a poll, not an answer: the card is on the reader
        // and the intent lives on the server, so ask again rather than conclude
        const look = await admGet<TerminalReply>(
          `/pos/terminal/status?externalId=${encodeURIComponent(externalId)}`,
        ).catch(() => null);
        if (look?.status === 'succeeded') return { ...look, externalId };
        if (look?.status === 'canceled') break;
      }
      /* Gave up, timed out, or the reader canceled. ONE route decides what the
         authorisation actually was — including "a card was tapped at the buzzer",
         which is real money and gets rung up rather than thrown away. A 402 here
         means the charge is stuck alive: it throws with the id still published,
         so the void UI below gets it. */
      setAbandoning(true);
      const out = await admPost<TerminalReply>('/pos/terminal/abandon', { externalId });
      if (out.status === 'succeeded') return { ...out, externalId };
      // nothing is authorised (or it already backs a sale): there is no charge
      // left for this register to void, and saying otherwise invites a re-ring
      onId(undefined);
      forgetCharge();
      throw new Error(
        out.status === 'recorded'
          ? t(
              'This card charge is already recorded as a sale — do not ring it up again.',
              '這筆刷卡已入帳為交易,請勿重複結帳。',
            )
          : t(
              'No card was taken — the authorisation was canceled and the customer was not charged. You can ring it up again.',
              '未完成刷卡 — 授權已取消,顧客未被扣款,可重新結帳。',
            ),
      );
    } finally {
      setReader(null);
      setAbandoning(false);
    }
  }

  async function pay(method: 'cash' | 'terminal') {
    setError('');
    setBusy(true);
    let terminalExternalId: string | undefined;
    // every cash sale carries an idempotency key, so a POST that dies in flight
    // can be resolved by looking the order up instead of guessing
    const key = method === 'cash' ? makeSaleKey() : null;
    // frozen before the await: the quote must not move under a sale in flight
    const quoteNow = quote;
    const tenderedNow = Math.round(parseFloat(tendered || '0') * 100);
    try {
      let terminalChargedCents: number | undefined;
      if (method === 'terminal') {
        const card = await collectCard((id) => {
          terminalExternalId = id;
        });
        terminalExternalId = card.externalId ?? undefined;
        terminalChargedCents = card.chargedCents;
      }
      const res = await admPost<Receipt>('/pos/orders', {
        ...cartPayload(),
        staffId: staffId ?? undefined,
        terminalId: terminalId ?? undefined,
        ...(key ? { note: saleNote({ key }) } : {}),
        payment: {
          method,
          tenderedCents: method === 'cash' ? tenderedNow : undefined,
          terminalExternalId,
          terminalChargedCents,
        },
      });
      setReceipt({ ...res, method });
      // the charge became a sale: it is the order's problem now, not the device's
      forgetCharge();
      setVoidInfo(null);
      // close out the originating appointment so it leaves the board
      if (fromAppt) await admPatch(`/appointments/${fromAppt.id}`, { status: 'COMPLETED' }).catch(() => {});
      releaseAppt();
      clearSale();
      reloadShift();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('Payment failed', '付款失敗');
      // The connection died with the drawer already open. We do not know whether
      // the server recorded this sale, so it is parked UNCERTAIN and resolved by
      // looking it up — never dropped, never blindly re-sent.
      if (key && quoteNow && isOfflineError(err)) {
        const parked = parkedSale(saleDraft(key, quoteNow, tenderedNow), msg);
        const stored = commitQueue([...queueRef.current, parked]);
        setNet('offline');
        if (stored) {
          setReceipt({
            code: provisionalCode(parked),
            totalCents: quoteNow.totalCents,
            taxCents: quoteNow.taxCents,
            discountCents: quoteNow.discountCents,
            changeCents: parked.changeCents,
            lines: parked.lines,
            method: 'cash',
            offline: true,
          });
          releaseAppt();
          clearSale();
        } else {
          setError(
            t(
              'The connection dropped and this device could not store the sale. Write it on paper and check the Orders list.',
              '連線中斷且本機無法儲存這筆交易,請手寫記錄並到訂單清單確認。',
            ),
          );
        }
        return;
      }
      setError(msg);
      // the reader charged but no sale was recorded — surface the charge state,
      // auto-voided or not, so the cashier never re-rings a live charge blind
      if (method === 'terminal' && terminalExternalId) {
        const autoVoided = msg.includes('auto-voided');
        // an auto-voided charge is finished; anything else stays on disk so a
        // reload finds it again instead of losing it with the tab
        if (autoVoided) forgetCharge();
        setVoidInfo({ externalId: terminalExternalId, autoVoided });
      }
    } finally {
      setBusy(false);
    }
  }

  async function voidLast() {
    if (!voidInfo) return;
    setBusy(true);
    try {
      const r = await admPost<{ voided: boolean; already?: string }>('/pos/terminal/void', {
        externalId: voidInfo.externalId,
      });
      if (r.voided || r.already === 'VOIDED') {
        forgetCharge();
        setVoidInfo(null);
        setError('');
      } else if (r.already === 'RECORDED') {
        forgetCharge();
        setVoidInfo(null);
        setError(t('This charge is already recorded as a sale, no void needed.', '這筆刷卡已入帳為交易,無需撤銷。'));
      } else {
        setError(t('Void failed, refund it in the Stripe dashboard.', '撤銷失敗,請至 Stripe 後台退款。'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Void failed', '撤銷失敗'));
    } finally {
      setBusy(false);
    }
  }

  /* Offline, the last shift we saw stands in. Refusing to sell because we
     cannot re-confirm the shift is the exact failure this whole feature exists
     to remove; the close-shift warning covers the drawer either way. */
  const openShift = shiftData?.shift ?? (offline ? snapshot?.shift ?? null : null);
  const due = quote?.totalCents ?? null;
  const tenderedCents = Math.round(parseFloat(tendered || '0') * 100);
  // quick tenders: exact, then the next $5 / $10 / $20 step above the due
  const quickTenders =
    due != null && due > 0
      ? [...new Set([due, Math.ceil(due / 500) * 500, Math.ceil(due / 1000) * 1000, Math.ceil(due / 2000) * 2000])]
      : [];

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 className="adm-page-title" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {t('POS register', 'POS 收銀')}
            {terminals.length > 0 && (
              <button
                className="adm-btn adm-btn-sm"
                onClick={() => setPickTerm(true)}
                title={t('Switch terminal', '切換櫃台')}
              >
                {terminal ? terminal.name : t('Pick terminal', '選擇櫃台')}
              </button>
            )}
          </h1>
          <p className="adm-page-sub">
            {openShift
              ? t(
                  `Shift open since ${new Date(openShift.openedAt).toLocaleTimeString()} · drawer started at ${money(openShift.openingCashCents)}`,
                  `本班自 ${new Date(openShift.openedAt).toLocaleTimeString()} 開始 · 開錢櫃現金 ${money(openShift.openingCashCents)}`,
                )
              : t('Open a shift to start ringing orders.', '開一個班別即可開始收銀。')}
          </p>
        </div>
        {openShift && shiftData?.live && (
          <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--a-dim)', paddingTop: 6 }}>
            <span><strong>{shiftData.live.orders}</strong> {t('orders', '筆')}</span>
            <span><strong>{money(shiftData.live.grossCents)}</strong> {t('gross', '總額')}</span>
            <span><strong>{money(shiftData.live.cashCents)}</strong> {t('cash', '現金')}</span>
            <span><strong>{money(shiftData.live.cardCents)}</strong> {t('card', '刷卡')}</span>
            {(shiftData.live.simulatedCardCents ?? 0) > 0 && (
              <span style={SIM_INK} title={simNote(t)}>
                <strong>{money(shiftData.live.simulatedCardCents!)}</strong> {t('simulated', '模擬')}
              </span>
            )}
          </div>
        )}
        {openShift && (
          <CloseShiftButton
            unsynced={qStatus}
            unresolved={shiftData?.unresolved}
            onSync={() => syncRef.current(true)}
            onRecheck={reloadShift}
            onClosed={(res) => { setClosed(res); reloadShift(); }}
          />
        )}
      </div>

      <OfflineBar
        offline={offline}
        syncing={syncing}
        status={qStatus}
        snapshotAt={snapshot?.at ?? null}
        storageBroken={storageBroken || !snapStored}
        queueCorrupt={queueCorrupt}
        onSync={() => syncRef.current(true)}
        onRetry={(key) => applyEvent(key, { type: 'retry' })}
        onAcknowledge={(key) => applyEvent(key, { type: 'acknowledge' })}
        queue={queue}
      />

      {!openShift ? (
        <OpenShiftCard onOpened={reloadShift} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr', gap: 16, alignItems: 'start' }}>
          {/* product grid */}
          <div className="adm-card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
              {cats.map((c, i) => (
                <button key={c.id} className="adm-btn adm-btn-sm" style={i === activeCat ? { background: 'var(--a-primary)', borderColor: 'var(--a-primary)', color: '#fff' } : undefined} onClick={() => setActiveCat(i)}>
                  {c.name}
                </button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
              {(cats[activeCat]?.items ?? []).filter((i) => i.available).map((it) => (
                <button
                  key={it.id}
                  onClick={() => tapItem(it)}
                  style={{ padding: '14px 12px', borderRadius: 10, border: '1px solid var(--a-border)', background: 'var(--a-surface)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}
                >
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, color: 'var(--a-text)' }}>{it.name}</div>
                  <div style={{ fontWeight: 800, color: 'var(--a-primary)' }}>{money(it.priceCents)}</div>
                  {(it.modifiers ?? []).length > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--a-faint)', marginTop: 3 }}>{t('options…', '選項…')}</div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* register cart */}
          <div className="adm-card" style={{ padding: 16, position: 'sticky', top: 20 }}>
            <strong style={{ display: 'block', marginBottom: 10 }}>{t('Current sale', '目前交易')}</strong>
            {fromAppt && (
              <div style={{ fontSize: 12, background: 'var(--a-primary-soft)', color: 'var(--a-primary)', borderRadius: 8, padding: '6px 10px', marginBottom: 10 }}>
                {t('From appointment', '來自預約')} · {fromAppt.label}
                {fromAppt.depositCents > 0 && (
                  <div style={{ marginTop: 2 }}>
                    {t(`Deposit on file: ${money(fromAppt.depositCents)} (will be credited)`, `已付訂金 ${money(fromAppt.depositCents)}（將自動折抵）`)}
                  </div>
                )}
              </div>
            )}
            {lines.length === 0 && <div style={{ color: 'var(--a-faint)', fontSize: 13, padding: '14px 0' }}>{t('Tap items to add them.', '點選品項加入。')}</div>}
            {lines.map((l) => (
              <div key={l.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--a-border)', fontSize: 13.5 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{l.item.name}</div>
                  {l.modifiers.length > 0 && <div style={{ fontSize: 11.5, color: 'var(--a-faint)' }}>{l.modifiers.join(', ')}</div>}
                </div>
                <button className="adm-btn adm-btn-sm" onClick={() => setLines((p) => p.map((x) => (x.key === l.key ? { ...x, qty: x.qty - 1 } : x)).filter((x) => x.qty > 0))}>−</button>
                <strong style={{ minWidth: 18, textAlign: 'center' }}>{l.qty}</strong>
                <button className="adm-btn adm-btn-sm" onClick={() => setLines((p) => p.map((x) => (x.key === l.key ? { ...x, qty: x.qty + 1 } : x)))}>+</button>
                <span style={{ minWidth: 62, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(l.unitCents * l.qty)}</span>
              </div>
            ))}
            {staff.length > 0 && (
              <div style={{ margin: '12px 0 0' }}>
                <span className="adm-label">{t('Served by', '服務人員')}</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  {staff.map((s) => (
                    <button
                      key={s.id}
                      className="adm-btn adm-btn-sm"
                      style={staffId === s.id ? { background: 'var(--a-primary-soft)', borderColor: 'var(--a-primary)', color: 'var(--a-primary)' } : undefined}
                      onClick={() => setStaffId(staffId === s.id ? null : s.id)}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '12px 0' }}>
              <Field label={t('Discount ($)', '折扣（$）')}>
                <input className="adm-input" type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </Field>
              <Field label={t('Tip ($)', '小費（$）')}>
                <input className="adm-input" type="number" min="0" step="0.01" value={tip} onChange={(e) => setTip(e.target.value)} />
              </Field>
            </div>
            <Field label={t('Gift card', '禮品卡')}>
              <input
                className="adm-input"
                value={gift}
                onChange={(e) => setGift(e.target.value)}
                disabled={offline}
                placeholder={
                  offline
                    ? t('Needs the internet', '需要網路')
                    : t('Card code (optional)', '卡號（選填）')
                }
                style={{ textTransform: 'uppercase' }}
              />
            </Field>
            <div style={{ fontSize: 13.5, display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--a-dim)' }}><span>{t('Subtotal', '小計')}</span><span>{money(subtotal)}</span></div>
              {discountCents > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--a-primary)' }}><span>{t('Discount', '折扣')}</span><span>−{money(discountCents)}</span></div>}
              {quote && quote.depositAppliedCents > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--a-primary)' }}><span>{t('Deposit applied', '訂金折抵')}</span><span>−{money(quote.depositAppliedCents)}</span></div>
              )}
              {quote && quote.giftAppliedCents > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--a-primary)' }}><span>{t('Gift card applied', '禮卡折抵')}</span><span>−{money(quote.giftAppliedCents)}</span></div>
              )}
              {quote && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--a-dim)' }}><span>{t('Tax', '稅額')}</span><span>{money(quote.taxCents)}</span></div>
              )}
              {quote ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 15 }}>
                  <span>{t('Total due', '應收')}</span><span>{money(quote.totalCents)}</span>
                </div>
              ) : (
                lines.length > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--a-faint)', fontSize: 12 }}>
                    <span>{quoteErr || t('Computing total…', '計算總額中…')}</span><span />
                  </div>
                )
              )}
            </div>
            {voidInfo && (
              <div style={{ fontSize: 12.5, border: '1px solid var(--a-danger)', color: 'var(--a-danger)', borderRadius: 8, padding: '8px 10px', marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {voidInfo.autoVoided ? (
                  <span>{t('Card auto-voided, re-ring when ready.', '已自動退刷,可重新結帳。')}</span>
                ) : (
                  <>
                    <span>
                      {voidInfo.recovered
                        ? t(
                            'A card charge was started on this device and never finished. It may have been taken. Settle it before ringing this customer up again:',
                            '本機曾發起一筆刷卡但沒有完成,可能已經扣款,請先處理再重新結帳:',
                          )
                        : t('Card charge NOT recorded and NOT voided yet:', '刷卡未入帳且尚未退刷:')}{' '}
                      <code style={{ fontSize: 11 }}>{voidInfo.externalId}</code>
                    </span>
                    <button className="adm-btn adm-btn-sm adm-btn-danger" disabled={busy} onClick={voidLast}>
                      {t('Void last charge', '撤銷上一筆刷卡')}
                    </button>
                  </>
                )}
                {/* dismissing is the cashier saying they have seen it — the device
                    stops nagging, and the id stays readable in Stripe */}
                <button className="adm-btn adm-btn-sm" onClick={() => { forgetCharge(); setVoidInfo(null); }}>
                  {t('Dismiss', '關閉')}
                </button>
              </div>
            )}
            {error && <div style={{ color: 'var(--a-danger)', fontSize: 13, marginBottom: 10 }}>{error}</div>}
            {blockers.length > 0 && (
              <div style={{ fontSize: 12.5, border: '1px solid var(--a-danger)', color: 'var(--a-danger)', borderRadius: 8, padding: '8px 10px', marginBottom: 10 }}>
                {blockers.map((b) => (
                  <div key={b}>{limitReason(b, t)}</div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="adm-btn adm-btn-primary"
                style={{ flex: 1 }}
                disabled={lines.length === 0 || busy || blockers.length > 0 || (offline && !quote)}
                onClick={() => setPaying('cash')}
              >
                {offline ? t('Cash (offline)', '現金（離線）') : t('Cash', '現金')}
              </button>
              <button
                className="adm-btn"
                style={{ flex: 1 }}
                disabled={lines.length === 0 || busy || offline}
                title={offline ? limitReason('card', t) : undefined}
                onClick={() => pay('terminal')}
              >
                {busy ? t('Reader…', '讀卡中…') : t('Card (terminal)', '刷卡（讀卡機）')}
              </button>
            </div>
            <p style={{ fontSize: 11.5, color: offline ? 'var(--a-danger)' : 'var(--a-faint)', marginTop: 8 }}>
              {offline
                ? limitReason('card', t)
                : t(
                    'No reader configured? Card payments run on the simulated reader, perfect for training.',
                    '尚未設定讀卡機？刷卡會走模擬讀卡機,很適合用來教育訓練。',
                  )}
            </p>
          </div>
        </div>
      )}

      {picking && (
        <ModifierPicker
          item={picking}
          onClose={() => setPicking(null)}
          onAdd={(mods) => {
            addLine(picking, mods);
            setPicking(null);
          }}
        />
      )}

      {pickTerm && terminals.length > 0 && (
        <Modal title={t('This device is…', '本機是哪個櫃台?')} onClose={() => setPickTerm(false)}>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--a-dim)' }}>
            {t('Sales rung on this device count toward the picked terminal on Z-reports.', '在這台裝置結帳的交易,會計入所選櫃台的 Z 報表。')}
          </p>
          <div style={{ display: 'grid', gap: 8 }}>
            {terminals.map((tm) => (
              <button
                key={tm.id}
                className="adm-btn"
                style={terminalId === tm.id ? { background: 'var(--a-primary-soft)', borderColor: 'var(--a-primary)', color: 'var(--a-primary)' } : undefined}
                onClick={() => pickTerminal(tm.id)}
              >
                {tm.name}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {paying === 'cash' && (
        <Modal title={offline ? t('Cash payment · offline', '現金付款 · 離線') : t('Cash payment', '現金付款')} onClose={() => setPaying(null)}>
          {offline && (
            <div style={{ fontSize: 12.5, background: 'var(--a-primary-soft)', borderRadius: 8, padding: '8px 10px', marginBottom: 12, lineHeight: 1.6 }}>
              {t(
                'Priced on this device from the last downloaded price list. The sale is stored here and sent to the books when the connection returns.',
                '本筆由本機以最後下載的價目表計價,交易先存在本機,連線恢復後才會送進帳。',
              )}
            </div>
          )}
          {due != null ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 16, marginBottom: 12 }}>
              <span>{t('Total due', '應收')}</span><span>{money(due)}</span>
            </div>
          ) : (
            <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--a-faint)' }}>
              {quoteErr || t('Computing total…', '計算總額中…')}
            </p>
          )}
          <Field label={t('Cash received ($)', '收到現金（$）')}>
            <input className="adm-input" autoFocus type="number" min="0" step="0.01" value={tendered} onChange={(e) => setTendered(e.target.value)} />
          </Field>
          <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
            {(quickTenders.length > 0 ? quickTenders : [2000, 5000, 10000]).map((v) => (
              <button key={v} className="adm-btn adm-btn-sm" onClick={() => setTendered((v / 100).toFixed(2))}>
                {v === due ? t(`Exact ${money(v)}`, `剛好 ${money(v)}`) : money(v)}
              </button>
            ))}
          </div>
          {due != null && tenderedCents >= due && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, marginBottom: 12 }}>
              <span>{t('Change', '找零')}</span><span>{money(tenderedCents - due)}</span>
            </div>
          )}
          <button
            className="adm-btn adm-btn-primary"
            disabled={busy || due == null || tenderedCents < due}
            onClick={() => (offline ? payOffline() : pay('cash'))}
          >
            {busy
              ? t('Recording…', '記錄中…')
              : offline
                ? t('Take cash & queue', '收現並排入待同步')
                : t('Complete sale', '完成交易')}
          </button>
        </Modal>
      )}

      {reader && (
        <ReaderWait
          externalId={reader.externalId}
          since={reader.since}
          amountCents={reader.amountCents}
          saved={reader.saved}
          abandoning={abandoning}
          onGiveUp={() => {
            giveUp.current = true;
            setAbandoning(true);
          }}
        />
      )}

      {receipt && (
        <Modal title={t(`Receipt — ${receipt.code}`, `收據 — ${receipt.code}`)} onClose={() => setReceipt(null)}>
          {receipt.offline && (
            <div style={{ fontSize: 12.5, border: '1px solid var(--a-danger)', color: 'var(--a-danger)', borderRadius: 8, padding: '8px 10px', marginBottom: 12, lineHeight: 1.6 }}>
              {t(
                'Not recorded yet — this reference is this device’s, not an order number. It becomes a real order when the connection returns.',
                '尚未入帳 — 這組編號只是本機的參考碼,不是訂單號;連線恢復後才會成為正式訂單。',
              )}
            </div>
          )}
          <div id="pos-receipt" style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, lineHeight: 1.7 }}>
            {receipt.lines.map((l, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{l.qty} × {l.name}</span>
                <span>{money(l.unitCents * l.qty)}</span>
              </div>
            ))}
            {receipt.discountCents > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('Discount', '折扣')}</span><span>−{money(receipt.discountCents)}</span></div>
            )}
            {(receipt.depositAppliedCents ?? 0) > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('Deposit applied', '訂金折抵')}</span><span>−{money(receipt.depositAppliedCents!)}</span></div>
            )}
            {(receipt.giftAppliedCents ?? 0) > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('Gift card applied', '禮卡折抵')}</span><span>−{money(receipt.giftAppliedCents!)}</span></div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('Tax', '稅額')}</span><span>{money(receipt.taxCents)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, borderTop: '1px dashed #999', marginTop: 6, paddingTop: 6 }}>
              <span>{t('TOTAL', '總計')}</span><span>{money(receipt.totalCents)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('Paid', '已付')} ({receipt.method})</span><span>{money(receipt.totalCents + receipt.changeCents)}</span></div>
            {receipt.changeCents > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}><span>{t('CHANGE', '找零')}</span><span>{money(receipt.changeCents)}</span></div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="adm-btn" onClick={() => window.print()}>{t('Print', '列印')}</button>
            <button className="adm-btn adm-btn-primary" onClick={() => setReceipt(null)}>{t('New sale', '新交易')}</button>
          </div>
        </Modal>
      )}

      {closed && <ZReportModal report={closed} onClose={() => setClosed(null)} />}
    </>
  );
}

/* What the cashier watches while a card is on the reader. The charge already has
   an id — on screen and on this device from the moment it was dispatched — so
   giving up is a deliberate, recoverable act instead of a closed tab, and the
   countdown is the register's own window rather than a request timing out. */
function ReaderWait({
  externalId,
  since,
  amountCents,
  saved,
  abandoning,
  onGiveUp,
}: {
  externalId: string;
  since: number;
  amountCents?: number;
  /** did the device actually manage to write the id down? */
  saved: boolean;
  abandoning: boolean;
  onGiveUp: () => void;
}) {
  const { t } = useAdmLang();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, Math.ceil((since + READER_WINDOW_MS - now) / 1000));
  return (
    // every way out of this modal means "give up", and giving up is one request
    // that decides what the authorisation was — never a silent close
    <Modal title={t('Card on the reader', '請在讀卡機上刷卡')} onClose={onGiveUp}>
      {amountCents != null && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 16, marginBottom: 12 }}>
          <span>{t('Charging', '刷卡金額')}</span><span>{money(amountCents)}</span>
        </div>
      )}
      <p style={{ margin: '0 0 10px', fontSize: 13.5, lineHeight: 1.6 }}>
        {abandoning
          ? t('Canceling at the reader…', '正在取消讀卡機上的交易…')
          : t(
              `Waiting for the customer to present a card — ${left}s left before the register gives up on its own.`,
              `等待顧客刷卡 — 還有 ${left} 秒,逾時後收銀台會自動放棄。`,
            )}
      </p>
      <p style={{ margin: '0 0 14px', fontSize: 12, color: saved ? 'var(--a-dim)' : 'var(--a-danger)', lineHeight: 1.6 }}>
        {t('Charge', '刷卡編號')} <code style={{ fontSize: 11 }}>{externalId}</code>
        <br />
        {saved
          ? t(
              'Saved on this device: if this tab closes now, the register finds this charge again and can void it.',
              '已存在本機:即使現在關掉分頁,收銀台仍能找回這筆刷卡並撤銷。',
            )
          : t(
              'This device could NOT store the charge id. Write it down before you close this tab — it is the only way to void the charge afterwards.',
              '本機無法儲存這組刷卡編號,關掉分頁前請先抄下來 — 事後只能靠它撤銷這筆刷卡。',
            )}
      </p>
      <button className="adm-btn adm-btn-danger" disabled={abandoning} onClick={onGiveUp}>
        {abandoning ? t('Canceling…', '取消中…') : t('Give up on this card', '放棄這筆刷卡')}
      </button>
    </Modal>
  );
}

/* The Z-report. Two things it must never do: pass simulated charges off as card
   revenue, and let money that is still in flight leave the screen unmentioned. */
function ZReportModal({ report, onClose }: { report: CloseResult; onClose: () => void }) {
  const { t } = useAdmLang();
  const [filter, setFilter] = useState('all');
  const z = report.totals;
  const sim = z.simulatedCardCents ?? 0;
  const buckets = z.byTerminal ?? [];
  const simByTerminal = buckets.some((b) => (b.simulatedCardCents ?? 0) > 0);
  return (
    <Modal title={t('Z-Report · shift closed', 'Z 報表 · 班別已結束')} onClose={onClose}>
      {report.warning && (
        <div style={{ border: '1px solid var(--a-danger)', color: 'var(--a-danger)', borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: 12.5, lineHeight: 1.7 }}>
          {report.warning}
        </div>
      )}
      <table className="adm-table" style={{ fontSize: 13.5 }}>
        <tbody>
          <tr><td>{t('Orders', '訂單數')}</td><td style={{ textAlign: 'right' }}>{z.orders}</td></tr>
          <tr><td>{t('Gross sales', '銷售總額')}</td><td style={{ textAlign: 'right' }}>{money(z.grossCents)}</td></tr>
          <tr><td>{t('Tax collected', '收取稅額')}</td><td style={{ textAlign: 'right' }}>{money(z.taxCents)}</td></tr>
          <tr><td>{t('Tips', '小費')}</td><td style={{ textAlign: 'right' }}>{money(z.tipsCents)}</td></tr>
          <tr><td>{t('Cash payments', '現金收款')}</td><td style={{ textAlign: 'right' }}>{money(z.cashCents)}</td></tr>
          <tr><td>{t('Card payments', '刷卡收款')}</td><td style={{ textAlign: 'right' }}>{money(z.cardCents)}</td></tr>
          {sim > 0 && (
            <tr>
              <td style={SIM_INK}>{t('Simulated card (not real money)', '模擬刷卡（非真實收款）')}</td>
              <td style={{ textAlign: 'right', ...SIM_INK }}>{money(sim)}</td>
            </tr>
          )}
          <tr><td>{t('Gift cards redeemed', '禮卡折抵')}</td><td style={{ textAlign: 'right' }}>{money(z.giftCents ?? 0)}</td></tr>
          {(z.canceledOrders ?? 0) > 0 && (
            <tr>
              <td>{t(`Canceled sales (${z.canceledOrders})`, `取消交易（${z.canceledOrders} 筆）`)}</td>
              <td style={{ textAlign: 'right' }}>
                {t(
                  `cash kept ${money(z.canceledCashKeptCents ?? 0)} · refunded ${money(z.canceledCashRefundedCents ?? 0)}`,
                  `現金留櫃 ${money(z.canceledCashKeptCents ?? 0)} · 已退現 ${money(z.canceledCashRefundedCents ?? 0)}`,
                )}
              </td>
            </tr>
          )}
          <tr><td>{t('Expected drawer', '預期錢櫃金額')}</td><td style={{ textAlign: 'right' }}>{money(z.expectedDrawerCents)}</td></tr>
          <tr><td>{t('Counted drawer', '實際點算金額')}</td><td style={{ textAlign: 'right' }}>{money(z.countedDrawerCents)}</td></tr>
          <tr>
            <td style={{ fontWeight: 800 }}>{t('Over / short', '溢收 / 短收')}</td>
            <td style={{ textAlign: 'right', fontWeight: 800, color: z.overShortCents === 0 ? 'var(--a-primary)' : 'var(--a-danger)' }}>
              {money(z.overShortCents)}
            </td>
          </tr>
        </tbody>
      </table>
      {sim > 0 && (
        <p style={{ margin: '8px 0 0', fontSize: 12, lineHeight: 1.6, ...SIM_INK }}>{simNote(t)}</p>
      )}
      {buckets.length > 1 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '16px 0 8px' }}>
            <strong style={{ fontSize: 13 }}>{t('By terminal', '各櫃台')}</strong>
            <select className="adm-input" style={{ width: 'auto' }} value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">{t('All terminals', '全部櫃台')}</option>
              {buckets.map((b) => (
                <option key={b.terminalId ?? 'unassigned'} value={b.terminalId ?? 'unassigned'}>
                  {b.terminalId ? b.name : t('Unassigned', '未指定')}
                </option>
              ))}
            </select>
          </div>
          <table className="adm-table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>{t('Terminal', '櫃台')}</th>
                <th style={{ textAlign: 'right' }}>{t('Orders', '筆數')}</th>
                <th style={{ textAlign: 'right' }}>{t('Gross', '總額')}</th>
                <th style={{ textAlign: 'right' }}>{t('Cash', '現金')}</th>
                <th style={{ textAlign: 'right' }}>{t('Card', '刷卡')}</th>
                {/* the column appears only where there is simulated money to own */}
                {simByTerminal && <th style={{ textAlign: 'right', ...SIM_INK }}>{t('Simulated', '模擬')}</th>}
              </tr>
            </thead>
            <tbody>
              {buckets
                .filter((b) => filter === 'all' || (b.terminalId ?? 'unassigned') === filter)
                .map((b) => (
                  <tr key={b.terminalId ?? 'unassigned'}>
                    <td>{b.terminalId ? b.name : t('Unassigned', '未指定')}</td>
                    <td style={{ textAlign: 'right' }}>{b.orders}</td>
                    <td style={{ textAlign: 'right' }}>{money(b.grossCents)}</td>
                    <td style={{ textAlign: 'right' }}>{money(b.cashCents)}</td>
                    <td style={{ textAlign: 'right' }}>{money(b.cardCents)}</td>
                    {simByTerminal && (
                      <td style={{ textAlign: 'right', ...SIM_INK }}>
                        {(b.simulatedCardCents ?? 0) > 0 ? money(b.simulatedCardCents!) : '—'}
                      </td>
                    )}
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}
      <button className="adm-btn" style={{ marginTop: 14 }} onClick={() => window.print()}>{t('Print report', '列印報表')}</button>
    </Modal>
  );
}

/* The register's honesty strip. It says three things a cashier must never have
   to infer: whether the till can reach the books, how much money is sitting on
   this device that the books cannot see, and what offline refuses to do.
   Silent only when there is genuinely nothing to say. */
function OfflineBar({
  offline,
  syncing,
  status,
  snapshotAt,
  storageBroken,
  queueCorrupt,
  queue,
  onSync,
  onRetry,
  onAcknowledge,
}: {
  offline: boolean;
  syncing: boolean;
  status: QueueStatus;
  snapshotAt: number | null;
  storageBroken: boolean;
  queueCorrupt: boolean;
  queue: QueuedSale[];
  onSync: () => void;
  onRetry: (key: string) => void;
  onAcknowledge: (key: string) => void;
}) {
  const { t } = useAdmLang();
  const [open, setOpen] = useState(false);
  if (!offline && status.pending === 0 && !storageBroken && !queueCorrupt) return null;

  const alarm =
    offline || storageBroken || queueCorrupt || status.failed > 0 || status.drift > 0 || status.uncertain > 0;
  const tone = alarm ? 'var(--a-danger)' : 'var(--a-primary)';
  const attention = queue.filter((s) => s.state === 'FAILED' || s.state === 'DRIFT' || s.state === 'UNCERTAIN');

  return (
    <div
      className="adm-card"
      style={{ padding: '12px 14px', margin: '0 0 14px', borderColor: tone, display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: tone, flex: '0 0 auto' }} />
        <strong style={{ color: tone, fontSize: 13.5 }}>
          {offline
            ? t('OFFLINE · cash only', '離線中 · 只收現金')
            : syncing
              ? t('Syncing…', '同步中…')
              : t('Back online', '已恢復連線')}
        </strong>
        {status.pending > 0 && (
          <span style={{ fontSize: 13 }}>
            {t(
              `${status.pending} sale${status.pending === 1 ? '' : 's'} waiting to sync`,
              `${status.pending} 筆交易待同步`,
            )}
            {status.unrecordedCashCents > 0 && (
              <> · <strong>{money(status.unrecordedCashCents)}</strong> {t('not in the books yet', '尚未進帳')}</>
            )}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {!offline && status.pending > 0 && (
          <button className="adm-btn adm-btn-sm" disabled={syncing} onClick={onSync}>
            {t('Sync now', '立即同步')}
          </button>
        )}
        <button className="adm-btn adm-btn-sm" onClick={() => setOpen(!open)}>
          {open ? t('Hide detail', '收起明細') : t('Detail', '明細')}
        </button>
      </div>

      {storageBroken && (
        <div style={{ fontSize: 12.5, color: 'var(--a-danger)', fontWeight: 600 }}>
          {t(
            'This device cannot save offline sales (storage is full or blocked). Write sales on paper until it is fixed.',
            '本機無法儲存離線交易(儲存空間已滿或被封鎖),修好之前請以紙本記錄。',
          )}
        </div>
      )}

      {queueCorrupt && (
        <div style={{ fontSize: 12.5, color: 'var(--a-danger)', fontWeight: 600 }}>
          {t(
            'Stored offline sales on this device could not be read. The raw data is kept aside — check the Orders list before assuming they were recorded.',
            '本機儲存的離線交易無法讀取,原始資料已另外保留;請先到訂單清單確認,不要假設已經入帳。',
          )}
        </div>
      )}

      {attention.map((s) => (
        <div
          key={s.key}
          style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--a-danger)' }}
        >
          <code style={{ fontSize: 11 }}>{provisionalCode(s)}</code>
          <span>{money(s.totalCents)}</span>
          <span style={{ flex: 1 }}>
            {s.state === 'DRIFT'
              ? t(
                  `Recorded as ${s.orderCode} for ${money(s.serverTotalCents ?? 0)} — the drawer took ${money(s.totalCents)}. Prices moved while you were offline; settle it in Orders.`,
                  `已入帳為 ${s.orderCode},金額 ${money(s.serverTotalCents ?? 0)},但實收 ${money(s.totalCents)};離線期間價格有變動,請到訂單頁處理。`,
                )
              : s.state === 'UNCERTAIN'
                ? t(
                    'Sent, but we never got an answer. It will be matched against the Orders list — do not re-ring it.',
                    '已送出但沒收到回應,系統會比對訂單清單,請勿重複結帳。',
                  )
                : (s.message ?? t('The server refused this sale.', '伺服器拒絕了這筆交易。'))}
          </span>
          {s.state === 'FAILED' && (
            <button className="adm-btn adm-btn-sm" onClick={() => onRetry(s.key)}>
              {t('Try again', '重試')}
            </button>
          )}
          {s.state === 'DRIFT' && (
            <button className="adm-btn adm-btn-sm" onClick={() => onAcknowledge(s.key)}>
              {t('Settled', '已處理')}
            </button>
          )}
        </div>
      ))}

      {open && (
        <div style={{ fontSize: 12, color: 'var(--a-dim)', lineHeight: 1.7, borderTop: '1px solid var(--a-border)', paddingTop: 8 }}>
          <div style={{ marginBottom: 6 }}>
            {snapshotAt
              ? t(
                  `Offline price list downloaded ${new Date(snapshotAt).toLocaleString()}. Anything changed since then prices at the old amount and is flagged when it syncs.`,
                  `離線價目表下載於 ${new Date(snapshotAt).toLocaleString()};之後改過的價格會以舊價計算,同步時會標示出來。`,
                )
              : t(
                  'No offline price list on this device yet — connect once and it downloads automatically.',
                  '本機還沒有離線價目表 — 連上一次網路就會自動下載。',
                )}
          </div>
          {status.oldestAt != null && (
            <div style={{ marginBottom: 6 }}>
              {t(`Oldest waiting sale: ${shortTime(status.oldestAt)}`, `最早的待同步交易:${shortTime(status.oldestAt)}`)}
            </div>
          )}
          <strong style={{ color: 'var(--a-text)' }}>{t('What offline cannot do', '離線時做不到的事')}</strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {OFFLINE_LIMITS.map((l) => (
              <li key={l.id}>{limitReason(l.id, t)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* Compact modifier picker — same group semantics as the storefront ItemModal:
   max=1 groups are exclusive, multi groups cap at max, every group must reach
   its min. Required groups preselect their first option so the fast path stays
   one tap, but the choice is visible and editable instead of silently locked. */
function ModifierPicker({ item, onClose, onAdd }: { item: Item; onClose: () => void; onAdd: (mods: string[]) => void }) {
  const { t } = useAdmLang();
  const groups = item.modifiers ?? [];
  const [chosen, setChosen] = useState<string[]>(defaultMods(item));
  const inGroup = (g: ModifierGroup) => chosen.filter((c) => g.options.some((o) => o.name === c));
  const valid = groups.every((g) => inGroup(g).length >= g.min);
  const unit = unitPriceWith(item, chosen);

  function toggle(g: ModifierGroup, name: string) {
    const cur = inGroup(g);
    if (g.max === 1) {
      setChosen([...chosen.filter((c) => !g.options.some((o) => o.name === c)), name]);
    } else if (cur.includes(name)) {
      setChosen(chosen.filter((c) => c !== name));
    } else if (cur.length < g.max) {
      setChosen([...chosen, name]);
    }
  }

  return (
    <Modal title={item.name} onClose={onClose}>
      {groups.map((g) => (
        <div key={g.name} style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span className="adm-label">{g.name}</span>
            <span style={{ fontSize: 11.5, color: 'var(--a-faint)' }}>
              {g.min > 0 ? t('required', '必選') : t('optional', '可選')}
              {g.max > 1 ? ` · max ${g.max}` : ''}
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {g.options.map((o) => {
              const on = chosen.includes(o.name);
              return (
                <button
                  key={o.name}
                  className="adm-btn adm-btn-sm"
                  style={on ? { background: 'var(--a-primary-soft)', borderColor: 'var(--a-primary)', color: 'var(--a-primary)' } : undefined}
                  onClick={() => toggle(g, o.name)}
                >
                  {o.name}
                  {o.priceCents > 0 ? ` +${money(o.priceCents)}` : ''}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <button className="adm-btn adm-btn-primary" style={{ width: '100%' }} disabled={!valid} onClick={() => onAdd(chosen)}>
        {t('Add to sale', '加入交易')} · {money(unit)}
      </button>
    </Modal>
  );
}

function OpenShiftCard({ onOpened }: { onOpened: () => void }) {
  const [cash, setCash] = useState('200');
  const [busy, setBusy] = useState(false);
  const { t } = useAdmLang();
  return (
    <div className="adm-card" style={{ padding: 24, maxWidth: 420 }}>
      <strong style={{ display: 'block', marginBottom: 14 }}>{t('Open a shift', '開始一個班別')}</strong>
      <Field label={t('Opening drawer cash ($)', '開班錢櫃現金（$）')}>
        <input className="adm-input" type="number" min="0" step="0.01" value={cash} onChange={(e) => setCash(e.target.value)} />
      </Field>
      <button
        className="adm-btn adm-btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await admPost('/pos/shifts/open', { openingCashCents: Math.round(parseFloat(cash || '0') * 100) });
            onOpened();
          } finally {
            setBusy(false);
          }
        }}
      >
        {t('Open shift', '開班')}
      </button>
    </div>
  );
}

function CloseShiftButton({
  unsynced,
  unresolved,
  onSync,
  onRecheck,
  onClosed,
}: {
  unsynced: QueueStatus;
  unresolved?: Unresolved;
  onSync: () => void;
  onRecheck: () => void;
  onClosed: (res: CloseResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [counted, setCounted] = useState('');
  const [busy, setBusy] = useState(false);
  const { t } = useAdmLang();
  /* A Z-report run over sales the server has never seen is a report that is
     wrong by exactly that much, and the over/short line will blame the cashier
     for it. Say the number out loud, offer to sync first, and make closing
     anyway a deliberate act. */
  const short = unsynced.unrecordedCashCents;
  /* Same problem from the server's side of the wire: a payment with no final
     answer settles in seconds or minutes, and one that lands after the close is
     money this Z-report will never show. So closing is BLOCKED while any exist —
     but a shop has to be able to go home, so there is a second, uglier door. */
  const stuck = unresolved?.count ?? 0;
  const blocked = stuck > 0;

  async function close(override: boolean) {
    if (
      unsynced.pending > 0 &&
      !(await confirmDlg(
        t(
          `${unsynced.pending} sale(s) worth ${money(short)} are still only on this device. Closing now produces a Z-report that does not include them. Close anyway?`,
          `還有 ${unsynced.pending} 筆共 ${money(short)} 只存在本機,現在結班產生的 Z 報表不會包含這些交易。仍要結班嗎?`,
        ),
        { confirmLabel: t('Close anyway', '仍要結班'), tone: 'danger' },
      ))
    )
      return;
    if (
      override &&
      !(await confirmDlg(
        t(
          `${stuck} payment(s) have not settled. Closing over them books today's card total as final while money is still moving — anything that lands after this close will not be in this Z-report, and correcting it is a manual job. Close with ${stuck} unresolved?`,
          `還有 ${stuck} 筆款項尚未結清。現在結班等於在錢還在流動時就把今天的卡款當成定案 — 結班之後才入帳的款項不會出現在這份 Z 報表裡,事後只能人工更正。仍要在 ${stuck} 筆未結清的情況下結班嗎?`,
        ),
        { confirmLabel: t(`Close with ${stuck} unresolved`, `仍要結班（${stuck} 筆未結清）`), tone: 'danger' },
      ))
    )
      return;
    setBusy(true);
    try {
      const res = await admPost<CloseResult>('/pos/shifts/close', {
        closingCashCents: Math.round(parseFloat(counted) * 100),
        /* The server REFUSES to close over money in flight unless the count is
           acknowledged explicitly, and it checks this against its own live
           count — so an acknowledgement of two cannot cover a third that
           arrived while this dialog was open. Sent only on the override path;
           a normal close omits it and the server's own gate stands. */
        ...(override ? { acknowledgedUnresolved: stuck } : {}),
      });
      setOpen(false);
      onClosed(res);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        className="adm-btn"
        style={unsynced.pending > 0 || blocked ? { borderColor: 'var(--a-danger)', color: 'var(--a-danger)' } : undefined}
        onClick={() => {
          // the count is only as fresh as the last load, and these clear on their
          // own — ask again on the way in rather than block on a stale number
          onRecheck();
          setOpen(true);
        }}
      >
        {t('Close shift', '結束班別')}
        {unsynced.pending > 0 ? ` (${unsynced.pending})` : ''}
      </button>
      {open && (
        <Modal title={t('Close shift', '結束班別')} onClose={() => setOpen(false)}>
          {unsynced.pending > 0 && (
            <div style={{ border: '1px solid var(--a-danger)', color: 'var(--a-danger)', borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: 13, lineHeight: 1.65 }}>
              <strong style={{ display: 'block', marginBottom: 4 }}>
                {t(
                  `${unsynced.pending} sale${unsynced.pending === 1 ? '' : 's'} have not reached the books`,
                  `有 ${unsynced.pending} 筆交易尚未進帳`,
                )}
              </strong>
              {short > 0 &&
                t(
                  `The Z-report cannot see ${money(short)} of drawer cash, so it will report that much as short.`,
                  `Z 報表看不到錢櫃裡的 ${money(short)},會把這筆金額算成短收。`,
                )}
              {unsynced.drift > 0 && (
                <div>
                  {t(
                    `${unsynced.drift} sale(s) were recorded at a different price than the drawer took (${money(unsynced.driftCents)} apart).`,
                    `有 ${unsynced.drift} 筆的入帳金額與實收不同(差 ${money(unsynced.driftCents)})。`,
                  )}
                </div>
              )}
              <button className="adm-btn adm-btn-sm" style={{ marginTop: 8 }} onClick={onSync}>
                {t('Sync first', '先同步')}
              </button>
            </div>
          )}
          {blocked && (
            <div style={{ border: '1px solid var(--a-danger)', color: 'var(--a-danger)', borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: 13, lineHeight: 1.65 }}>
              <strong style={{ display: 'block', marginBottom: 4 }}>
                {t(
                  `${stuck} payment${stuck === 1 ? '' : 's'} not settled yet — closing is blocked`,
                  `有 ${stuck} 筆款項尚未結清 — 暫時無法結班`,
                )}
              </strong>
              {(unresolved?.pendingPayments ?? 0) > 0 && (
                <div>
                  {t(
                    `${unresolved!.pendingPayments} card payment(s) with no final answer yet — these usually finish within a minute, so wait and check again.`,
                    `${unresolved!.pendingPayments} 筆刷卡尚未有最終結果 — 通常一分鐘內就會完成,請稍候再檢查一次。`,
                  )}
                </div>
              )}
              {(unresolved?.salesWithoutPayment ?? 0) > 0 && (
                <div>
                  {t(
                    `${unresolved!.salesWithoutPayment} sale(s) recorded no tender at all — waiting will not fix these, find them in Orders.`,
                    `${unresolved!.salesWithoutPayment} 筆交易完全沒有付款紀錄 — 等下去不會改變,請到訂單清單處理。`,
                  )}
                </div>
              )}
              <div style={{ marginTop: 4 }}>
                {t(
                  'Anything that lands after the close will not be in this Z-report, and correcting it afterwards is a manual job.',
                  '結班之後才入帳的款項不會出現在這份 Z 報表裡,事後只能人工更正。',
                )}
              </div>
              <button className="adm-btn adm-btn-sm" style={{ marginTop: 8 }} onClick={onRecheck}>
                {t('Check again', '重新檢查')}
              </button>
            </div>
          )}
          <Field label={t('Counted drawer cash ($)', '點算後錢櫃現金（$）')}>
            <input className="adm-input" autoFocus type="number" min="0" step="0.01" value={counted} onChange={(e) => setCounted(e.target.value)} />
          </Field>
          <button className="adm-btn adm-btn-primary" disabled={busy || counted === '' || blocked} onClick={() => close(false)}>
            {busy ? t('Closing…', '結算中…') : t('Close & run Z-report', '結班並產生 Z 報表')}
          </button>
          {blocked && (
            /* The way home when the money will not settle. Deliberately not the
               primary button, deliberately named after the number it is stepping
               over, and it still has to pass the danger confirm. */
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--a-border)' }}>
              <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--a-dim)', lineHeight: 1.6 }}>
                {t(
                  'Have to lock up anyway? Closing over unsettled payments is an override, not a normal close — the card total on this Z-report will not be the final word.',
                  '真的必須關店?在款項未結清時結班屬於強制放行,不是正常結班 — 這份 Z 報表上的卡款不會是最終數字。',
                )}
              </p>
              <button className="adm-btn adm-btn-danger" disabled={busy || counted === ''} onClick={() => close(true)}>
                {t(`Override — close with ${stuck} unresolved`, `強制結班 — 仍有 ${stuck} 筆未結清`)}
              </button>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

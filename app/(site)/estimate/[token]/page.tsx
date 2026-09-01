'use client';

/* The customer's estimate page (REVENUE_MASTER_PLAN §5.4) — reached from the
   estimate email via the order's accessToken. Accept / decline, then (when the
   payments module is on) put the deposit down with the same Payment Element
   sheet checkout uses. Keyless sites auto-succeed the mock intent, so the flow
   is demo-able end to end without a Stripe key. */

import { use, useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/client';
import { collectStripePayment, siteStripeOrNull } from '@/components/runtime/stripe-sheet';

interface EstimateView {
  code: string;
  status: string;
  contactName: string;
  estimatedCents: number | null;
  note: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
  depositCents: number;
  depositPaid: boolean;
}

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

export default function EstimatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [est, setEst] = useState<EstimateView | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = () =>
    apiGet<EstimateView>(`/estimate/${token}`).then(setEst).catch(() => setErr('This estimate link is not valid.'));
  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [token]);

  async function act(path: 'accept' | 'decline') {
    setBusy(true);
    try {
      await apiPost(`/estimate/${token}/${path}`, {});
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function payDeposit() {
    setBusy(true);
    setErr('');
    try {
      const stripe = await siteStripeOrNull('en');
      const intent = await apiPost<{ clientSecret: string; externalId: string; provider: string }>(
        `/estimate/${token}/deposit-intent`, {},
      );
      if (stripe && intent.provider === 'STRIPE') {
        const paid = await collectStripePayment(stripe, intent.clientSecret);
        if (!paid) { setBusy(false); return; }
      }
      await apiPost(`/estimate/${token}/deposit-confirm`, { externalId: intent.externalId });
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (err && !est) return <main className="mx-auto max-w-lg px-6 py-24 text-center text-neutral-600">{err}</main>;
  if (!est) return <main className="mx-auto max-w-lg px-6 py-24 text-center text-neutral-400">Loading…</main>;

  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <p className="text-sm uppercase tracking-wide text-neutral-500">Estimate {est.code}</p>
      <h1 className="mt-1 text-3xl font-semibold">
        {est.estimatedCents != null ? usd(est.estimatedCents) : 'Being prepared'}
      </h1>
      {est.note && <p className="mt-3 whitespace-pre-wrap text-neutral-700">{est.note}</p>}

      {est.declinedAt ? (
        <p className="mt-8 rounded-xl bg-neutral-100 p-4 text-neutral-600">
          You declined this estimate. Changed your mind? Just reply to our message and we&apos;ll requote.
        </p>
      ) : !est.acceptedAt ? (
        est.sentAt && (
          <div className="mt-8 flex gap-3">
            <button disabled={busy} onClick={() => void act('accept')}
              className="flex-1 rounded-xl bg-neutral-900 px-6 py-3 font-medium text-white disabled:opacity-50">
              Accept estimate
            </button>
            <button disabled={busy} onClick={() => void act('decline')}
              className="rounded-xl border border-neutral-300 px-6 py-3 text-neutral-600 disabled:opacity-50">
              Decline
            </button>
          </div>
        )
      ) : (
        <div className="mt-8 rounded-xl bg-emerald-50 p-4">
          <p className="font-medium text-emerald-800">Accepted ✓</p>
          {est.depositCents > 0 && !est.depositPaid && (
            <>
              <p className="mt-2 text-sm text-emerald-900">
                A {usd(est.depositCents)} deposit locks in your spot on the schedule.
              </p>
              <button disabled={busy} onClick={() => void payDeposit()}
                className="mt-3 rounded-xl bg-emerald-700 px-6 py-3 font-medium text-white disabled:opacity-50">
                {busy ? 'Processing…' : `Pay ${usd(est.depositCents)} deposit`}
              </button>
            </>
          )}
          {est.depositPaid && <p className="mt-2 text-sm text-emerald-900">Deposit received — we&apos;ll be in touch to schedule.</p>}
          {est.depositCents === 0 && <p className="mt-2 text-sm text-emerald-900">We&apos;ll be in touch to arrange the details.</p>}
        </div>
      )}
      {err && <p className="mt-4 text-sm text-red-600">{err}</p>}
    </main>
  );
}

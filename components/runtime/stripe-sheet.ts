'use client';

/* Minimal Stripe Payment Element sheet. Resolves true on successful payment. */

import type { Stripe } from '@stripe/stripe-js';
import { apiGet } from '@/lib/client';

/* Stripe.js for this site, or null when the site runs keyless (mock) payments.
   Throws a sentence the CUSTOMER can act on when cards are supposed to work and
   cannot.

   Call this BEFORE minting the payment intent. Every checkout used to mint the
   intent first and then reach for the publishable key with a `!`, so a site
   deployed with STRIPE_SECRET_KEY but no NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY —
   the commonest half-configured state, since they are two separate fields —
   charged nobody, left an uncaptured intent in the merchant's dashboard, and
   showed the customer Stripe.js's own crash: "Cannot read properties of null
   (reading 'match')". The merchant's own warning lives in /admin → Settings. */
export function cardUnavailable(lang: 'en' | 'zh' | 'es'): Error {
  return new Error(
    lang === 'es'
      ? 'El pago con tarjeta no está disponible ahora. Elige pagar en la tienda o llámanos.'
      : lang === 'zh'
        ? '線上刷卡目前無法使用,請改選到店付款或直接聯絡店家。'
        : "Card payment isn't available right now — choose pay at the store, or call us.",
  );
}

export async function siteStripeOrNull(lang: 'en' | 'zh' | 'es'): Promise<Stripe | null> {
  const cfg = await apiGet<{ provider: string; publishableKey: string | null }>('/payments/config');
  if (cfg.provider !== 'stripe') return null; // keyless demo: the mock intent auto-succeeds
  if (!cfg.publishableKey) throw cardUnavailable(lang);
  const { loadStripe } = await import('@stripe/stripe-js');
  const stripe = await loadStripe(cfg.publishableKey);
  if (!stripe) throw cardUnavailable(lang);
  return stripe;
}

export async function collectStripePayment(stripe: Stripe, clientSecret: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:120;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:18px';
    const box = document.createElement('div');
    box.style.cssText =
      'background:var(--c-surface,#fff);border-radius:14px;padding:22px;width:420px;max-width:100%;display:flex;flex-direction:column;gap:14px';
    const mount = document.createElement('div');
    const btn = document.createElement('button');
    btn.textContent = 'Pay now';
    btn.className = 'ls-btn';
    btn.style.justifyContent = 'center';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.className = 'ls-btn ls-btn-ghost';
    cancel.style.justifyContent = 'center';
    box.append(mount, btn, cancel);
    overlay.append(box);
    document.body.append(overlay);

    const elements = stripe.elements({ clientSecret });
    const pe = elements.create('payment');
    pe.mount(mount);

    cancel.onclick = () => {
      overlay.remove();
      resolve(false);
    };
    btn.onclick = async () => {
      btn.textContent = 'Processing…';
      btn.setAttribute('disabled', 'true');
      const { error } = await stripe.confirmPayment({ elements, redirect: 'if_required' });
      if (error) {
        btn.textContent = 'Pay now';
        btn.removeAttribute('disabled');
        alert(error.message);
        return;
      }
      overlay.remove();
      resolve(true);
    };
  });
}

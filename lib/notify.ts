/* Email/SMS notifications. With RESEND_API_KEY / TWILIO_* set, real messages
   are sent via their REST APIs; otherwise everything is logged to the
   NotificationLog table (mock mode) so flows stay fully testable. */

import { db } from './db';
import { publicBusiness } from './business-db';
import { signData } from './auth';
import { getSiteUrl } from './site-url';
import { escapeHtml } from './escape';

/** Which channels can actually deliver right now.

    Confirmation screens must promise only what is wired. They used to key that
    promise off the Stripe config, so a site with card payments but no Resend key
    told every customer "a confirmation text & email are on the way" while the
    messages were written to NotificationLog as MOCKED and dropped. sendEmail
    deliberately returns true in mock mode (broadcast counts depend on it), so the
    send result cannot answer this question — the env is the only honest source. */
export function notifyChannels(): { email: boolean; sms: boolean } {
  return {
    email: !!process.env.RESEND_API_KEY,
    sms: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER),
  };
}

/** The owner's copy. Every money event (order, booking, lead) must land in the
    business inbox — customers getting confirmations while the owner hears
    nothing is how orders get missed. OWNER_EMAIL overrides the site config. */
export async function notifyOwner(subject: string, html: string): Promise<void> {
  // the live address, so changing it in Settings actually redirects the copy —
  // env still wins, because a deployment secret outranks a form
  const to = process.env.OWNER_EMAIL || (await publicBusiness()).email;
  if (to) await sendEmail(to, subject, html);
}

/** Returns whether the message was delivered (or mocked) — broadcasts count on it. */
export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'onboarding@resend.dev';
  if (!key) {
    await db.notificationLog.create({
      data: { channel: 'EMAIL', recipient: to, subject, body: html, status: 'MOCKED' },
    });
    console.log(`[mock email] to=${to} subject=${subject}`);
    return true;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html }),
    });
    await db.notificationLog.create({
      data: {
        channel: 'EMAIL',
        recipient: to,
        subject,
        body: html,
        status: res.ok ? 'SENT' : 'FAILED',
      },
    });
    return res.ok;
  } catch (err) {
    console.error('email failed', err);
    await db.notificationLog.create({
      data: { channel: 'EMAIL', recipient: to, subject, body: html, status: 'FAILED' },
    });
    return false;
  }
}

export async function sendSms(to: string, body: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) {
    await db.notificationLog.create({
      data: { channel: 'SMS', recipient: to, subject: '', body, status: 'MOCKED' },
    });
    console.log(`[mock sms] to=${to}: ${body}`);
    return;
  }
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    });
    await db.notificationLog.create({
      data: { channel: 'SMS', recipient: to, subject: '', body, status: res.ok ? 'SENT' : 'FAILED' },
    });
  } catch (err) {
    console.error('sms failed', err);
  }
}

/** Marketing variant of emailShell: appends the CAN-SPAM unsubscribe link,
    signed so the public route can flip marketingOptIn without a login. */
export function marketingShell(businessName: string, heading: string, rows: string[], to: string): string {
  const url = `${getSiteUrl()}/api/v1/unsubscribe?email=${encodeURIComponent(to)}&sig=${signData(`unsub:${to}`)}`;
  return emailShell(businessName, heading, [
    ...rows,
    `<a href="${url}" style="color:#9a9a96;font-size:12px">Unsubscribe from these emails</a>`,
  ]);
}

// businessName and heading are plain-text values (never intentional markup), so
// we escape them here. rows are HTML fragments assembled by callers (some carry
// intentional <strong>/<a> markup) — callers must escape any customer-supplied
// value (order notes, contact name, review text, …) with escapeHtml before
// placing it into a row; escaping the whole row here would break that markup.
export function emailShell(businessName: string, heading: string, rows: string[]): string {
  return `<!doctype html><body style="font-family:system-ui,sans-serif;background:#f4f4f2;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e3dd">
    <h2 style="margin:0 0 4px;font-size:18px">${escapeHtml(businessName)}</h2>
    <h1 style="margin:0 0 20px;font-size:22px">${escapeHtml(heading)}</h1>
    ${rows.map((r) => `<p style="margin:0 0 10px;font-size:14.5px;color:#3a3a37;line-height:1.6">${r}</p>`).join('')}
  </div></body>`;
}

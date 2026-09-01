/* On-site AI concierge — answers menu/hours/booking questions from the
   merchant's OWN data (the same grounding document served at /llms.txt) and
   deep-links to /order and /book. Enabled only when ANTHROPIC_API_KEY is set
   on the deployment; without it the widget never renders (same env-gated
   pattern as Resend notifications). */

import { Hono } from 'hono';
import { z } from 'zod';
import { composeGrounding } from '@/lib/grounding';
import { publicBusiness } from '@/lib/business-db';
// the shared limiter, keyed by an IP the client cannot forge — this file used to
// carry its own copy keyed by the RAW x-forwarded-for header, which an attacker
// refreshes per request by rotating a spoofed leading value
import { clientIp, limited } from './shared';

export const assistantRoutes = new Hono();

const KEY = process.env.ANTHROPIC_API_KEY;

assistantRoutes.get('/assistant/config', (c) => c.json({ enabled: !!KEY }));

const Ask = z.object({
  messages: z
    // user turns are typed (cap tight); assistant turns are our own prior replies
    // (max_tokens 400 ≈ up to ~1600 chars) so they must accept more than the user cap
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(12)
    .refine((m) => m.every((x) => x.role === 'assistant' || x.content.length <= 1000), {
      message: 'question too long',
    }),
});

assistantRoutes.post('/assistant', async (c) => {
  if (!KEY) return c.json({ error: { code: 'DISABLED' } }, 404);
  const ip = clientIp(c);
  if (await limited(`ai:${ip}`)) return c.json({ error: { code: 'RATE_LIMITED' } }, 429);
  const body = Ask.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION' } }, 400);

  const grounding = await composeGrounding();
  // same live profile the grounding document is built from: the prompt telling
  // the customer which number to call must not disagree with the facts below it
  const business = await publicBusiness();
  const system = [
    `You are the friendly front-desk assistant for ${business.name}. Answer ONLY from the business facts below — if the answer isn't there, say you're not sure and suggest calling ${business.phone}.`,
    `Keep answers to 1–3 short sentences. When relevant, point to pages as plain relative links (e.g. /order to order, /book to book a table). Never invent prices, hours, or policies. Reply in the language the customer writes in.`,
    '',
    grounding,
  ].join('\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system,
      messages: body.data.messages,
    }),
  });
  if (!res.ok) {
    console.error('assistant upstream', res.status, (await res.text()).slice(0, 200));
    return c.json({ error: { code: 'UPSTREAM', message: 'Assistant is unavailable right now.' } }, 502);
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  return c.json({ reply: text || '…' });
});

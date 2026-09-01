/* payments — public routes.

   Only the provider handshake lives here. Creating an intent FOR something is
   that something's business: the order intent is in orders, the booking deposit
   intent is in appointments. Keeping them here made payments import the order
   quote, which welded the two modules together. */

import { Hono } from 'hono';
import { paymentsConfig } from '@/lib/payments';

export const routes = new Hono();

routes.get('/payments/config', (c) => c.json(paymentsConfig()));

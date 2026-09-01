/* Short human codes (R-3F2A9C) and opaque cancel tokens — shared by the public
   storefront routes and the admin phone-in booking routes. */

import { randomBytes } from 'node:crypto';

export const tok = () => randomBytes(20).toString('hex');
export const shortCode = (prefix: string) => `${prefix}-${randomBytes(3).toString('hex').toUpperCase()}`;

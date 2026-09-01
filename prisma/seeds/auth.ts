/* auth — the OWNER admin account. */

import { scryptSync, randomBytes } from 'node:crypto';
import type { SeedStep } from './types';

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

/* what the runner's banner prints. Resolved inside run(), never at import:
   resolving it can throw (production without ADMIN_PASSWORD) and warns once. */
let printed = '';
export const seededAdminPassword = (): string => printed;

export const seed: SeedStep = {
  // the admin is upserted, never wiped — a dev reseed must not lock the owner out
  wipe: () => [],

  async run(prisma, data) {
    // deploy injects a strong ADMIN_PASSWORD env. In production (NODE_ENV=production,
    // e.g. the Docker image) we refuse to seed a guessable, source-published admin:
    // ADMIN_PASSWORD must be set and >=7 chars. In local dev we fall back to
    // 'admin1234' (with a loud warning) so `npm run setup`, the e2e harness and
    // money-fix-smoke.sh — none of which set NODE_ENV=production — still log in.
    const envPassword = process.env.ADMIN_PASSWORD;
    if (process.env.NODE_ENV === 'production' && (!envPassword || envPassword.length < 7)) {
      throw new Error(
        'ADMIN_PASSWORD must be set to at least 7 characters to seed the admin in production. ' +
          'Refusing to create an OWNER account with the default/guessable password.',
      );
    }
    const adminPassword = envPassword || 'admin1234';
    if (!envPassword) {
      console.warn(
        "⚠  ADMIN_PASSWORD not set — seeding the OWNER admin with the dev default 'admin1234'. " +
          'Set a strong ADMIN_PASSWORD before deploying to production.',
      );
    }
    /* The runner's banner goes to stdout, and on a hosted deploy the seed
       runs inside the BUILD step — everything printed here lands in the
       provider's build log. A real (env-supplied) password must never ride
       that channel; only the dev fallback, a published constant rather than
       a secret, is ever shown in the clear. */
    printed = envPassword
      ? '(set via the ADMIN_PASSWORD env — not shown here)'
      : adminPassword;
    /* Belt and braces with adminEmailFor(): sign-in looks the account up by
       `email.toLowerCase()`, so an address stored with a capital is an account
       that exists and can never be used. Settle it on the way in, here too. */
    const adminEmail = data.adminEmail.toLowerCase();
    await prisma.adminUser.upsert({
      where: { email: adminEmail },
      update: {},
      create: {
        email: adminEmail,
        passwordHash: hashPassword(adminPassword),
        name: 'Owner',
        role: 'OWNER',
      },
    });
  },
};

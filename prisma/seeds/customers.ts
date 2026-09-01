/* customers — nothing to seed: customer records are earned, never seeded — a demo customer would pollute the merchant's audience list.
   The step exists so the registry can name every module uniformly. */

import type { SeedStep } from './types';

export const seed: SeedStep = {
  wipe: () => [],
  async run() {},
};

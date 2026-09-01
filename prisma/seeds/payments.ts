/* payments — nothing to seed: Payment/GiftCard rows are created by real checkouts.
   The step exists so the registry can name every module uniformly. */

import type { SeedStep } from './types';

export const seed: SeedStep = {
  wipe: () => [],
  async run() {},
};

/* media — nothing to seed: admin photo uploads live in MediaAsset, created at upload time.
   The step exists so the registry can name every module uniformly. */

import type { SeedStep } from './types';

export const seed: SeedStep = {
  wipe: () => [],
  async run() {},
};

/* The contract every module's seed step implements.

   Each module owns prisma/seeds/<module>.ts and default-exports nothing but a
   `seed` step, so Naratake can regenerate prisma/seed.ts with only the
   modules a site enabled — a disabled module's seed code never ships, and the
   runner never names a model that left the schema. */

import type { Prisma, PrismaClient } from '@prisma/client';

/* prisma/seed-data.json as JSON.parse hands it over. Deliberately untyped:
   the studio writes it, and every step reads only its own slice. */
export interface SeedData {
  business: any;
  seed: any;
  adminEmail: string;
  collections?: any;
}

/* production (SEED_IF_EMPTY=1) guard: true only when the group a step is about
   to CREATE is still empty, so re-seeding a live site never duplicates or
   overwrites merchant data. Always true in dev, where the wipe just ran. */
export type Empty = (count: () => Promise<number>) => Promise<boolean>;

export interface SeedStep {
  /* dev-only wipe. Returns delete ops in FK-safe order WITHIN this module
     (ClassEnrollment before ClassSession, Item before Category); the runner
     concatenates the modules back-to-front and runs one transaction. */
  wipe(prisma: PrismaClient): Prisma.PrismaPromise<unknown>[];
  run(prisma: PrismaClient, data: SeedData, empty: Empty): Promise<void>;
}

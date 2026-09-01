/* customers — scheduled jobs. */

import { db } from '@/lib/db';
import type { CronModule } from '../cron';

export const jobs: CronModule = {
  /* who win-back is allowed to mail: opted in, and reachable by email */
  subscribers: () =>
    db.customer.findMany({
      where: { marketingOptIn: true, email: { not: null } },
      select: { id: true, email: true, name: true },
    }),
};

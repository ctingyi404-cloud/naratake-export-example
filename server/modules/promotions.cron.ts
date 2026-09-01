/* promotions — scheduled jobs. */

import { db } from '@/lib/db';
import type { CronModule } from '../cron';

export const jobs: CronModule = {
  /* the house signup reward, when one is live — win-back offers it if it is
     there and mails a plain "come see what's new" if it is not */
  signupReward: () =>
    db.coupon.findFirst({
      where: { signupReward: true, active: true, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
    }),
};

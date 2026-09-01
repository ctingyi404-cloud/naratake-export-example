/* catalog — categories and the items inside them. */

import type { SeedStep } from './types';

export const seed: SeedStep = {
  // Item before Category: items carry the FK
  wipe: (prisma) => [prisma.item.deleteMany(), prisma.category.deleteMany()],

  async run(prisma, data, empty) {
    let sort = 0;
    // guard on the entity this block CREATES (categories), not items — else a merchant
    // who cleared their items but kept categories would get the seed categories again
    if (await empty(() => prisma.category.count()))
    for (const cat of data.seed.categories ?? []) {
      await prisma.category.create({
        data: {
          name: cat.name,
          nameZh: cat.nameZh ?? null,
          type: cat.type,
          sort: sort++,
          items: {
            create: cat.items.map((it: Record<string, unknown>, i: number) => ({
              name: it.name as string,
              nameZh: (it.nameZh as string) ?? null,
              description: (it.description as string) ?? null,
              descriptionZh: (it.descriptionZh as string) ?? null,
              priceCents: it.priceCents as number,
              // a studio-uploaded photo ships an explicit imageUrl; else derive the
              // generated illustration from imageKey
              imageUrl: (it.imageUrl as string) ?? (it.imageKey ? `/images/${it.imageKey}.svg` : null),
              badges: it.badges ?? [],
              durationMin: (it.durationMin as number) ?? null,
              depositCents: (it.depositCents as number) ?? null,
              available: it.soldOut === true ? false : true,
              modifiers: it.modifiers ?? [],
              sort: i,
            })),
          },
        },
      });
    }
  },
};

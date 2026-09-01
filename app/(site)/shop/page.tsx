import type { Metadata } from 'next';
import { RtCouponBanner, RtFooter, RtHeading, RtNavbar, RtOrderingWidget, RtSection, RtText } from '@/components/runtime';
import { localizeMetadata } from '@/lib/locale-seo';

export const metadata: Metadata = localizeMetadata({
  title: "Shop · {{business.name}}",
  alternates: { canonical: "/shop" },
}, "en");

export default function Page() {
  return (
    <>
    <RtNavbar brand={"{{business.name}}"} ctaLabel={"Order ahead"} ctaPageSlug={"/shop"} />
      <main>
      <RtSection className="pt-[48px] pr-[18px] pb-[48px] pl-[18px] md:pt-[64px] md:pr-[24px] md:pb-[24px] md:pl-[24px]" contentWidth={1160}>
        <RtText className="text-[13px] font-bold tracking-[0.14em] uppercase break-keep text-[var(--c-primary)]" text={"Pre-order"} />
        <RtHeading className="font-heading text-[29px] font-bold text-[var(--c-text)] md:text-[46px]" text={"Reserve your bake"} level={"h1"} />
        <RtText className="text-[16px] leading-[1.65] text-[var(--c-text-muted)]" text={"Order by 8pm for next-morning pickup."} />
      </RtSection>
      <RtSection className="pt-[48px] pr-[18px] pb-[48px] pl-[18px] md:pt-[72px] md:pr-[24px] md:pb-[72px] md:pl-[24px]" contentWidth={1160}>
        <RtOrderingWidget allowDelivery={false} allowTips={true} initialData={[{"name":"Breads","items":[{"id":"seed-country-sourdough","name":"Country Sourdough","description":"36-hour ferment, blistered crust. Baked at 7am.","priceCents":850,"imageUrl":"https://images.unsplash.com/photo-1586444248902-2f64eddc13df?w=900&h=675&q=80&auto=format&fit=crop","badges":["popular"],"modifiers":[]},{"id":"seed-seeded-rye","name":"Seeded Rye","description":"Caraway and toasted seeds, dense and fragrant.","priceCents":900,"imageUrl":"https://images.unsplash.com/photo-1534620808146-d33bb39128b2?w=900&h=675&q=80&auto=format&fit=crop","badges":[],"modifiers":[]},{"id":"seed-rosemary-focaccia","name":"Rosemary Focaccia","description":"Olive-oil rich, flaky salt, whole sheet or half.","priceCents":750,"imageUrl":"https://images.unsplash.com/photo-1593629718888-9009c55e6cad?w=900&h=675&q=80&auto=format&fit=crop","badges":["vegan"],"modifiers":[{"name":"Size","min":1,"max":1,"options":[{"name":"Half sheet","priceCents":0},{"name":"Whole sheet","priceCents":600}]}]}]},{"name":"Pastry Case","items":[{"id":"seed-almond-croissant","name":"Almond Croissant","description":"Twice-baked, frangipane center.","priceCents":525,"imageUrl":"https://images.unsplash.com/photo-1625425404751-19b16c027511?w=900&h=675&q=80&auto=format&fit=crop","badges":["popular"],"modifiers":[]},{"id":"seed-morning-bun","name":"Morning Bun","description":"Cardamom sugar, croissant dough.","priceCents":475,"imageUrl":"https://images.unsplash.com/photo-1623334044303-241021148842?w=900&h=675&q=80&auto=format&fit=crop","badges":[],"modifiers":[]},{"id":"seed-canel","name":"Canelé","description":"Custard heart, caramelized shell.","priceCents":425,"imageUrl":"https://images.unsplash.com/photo-1488477181946-6428a0291777?w=900&h=675&q=80&auto=format&fit=crop","badges":[],"modifiers":[]},{"id":"seed-seasonal-fruit-danish","name":"Seasonal Fruit Danish","description":"Ask what the orchard sent this week.","priceCents":495,"imageUrl":"https://images.unsplash.com/photo-1635348965813-fa7d0dfb99d2?w=900&h=675&q=80&auto=format&fit=crop","badges":["new"],"modifiers":[]}]},{"name":"Whole Cakes (48h notice)","items":[{"id":"seed-6-celebration-cake","name":"6\" Celebration Cake","description":"Vanilla chiffon, seasonal fruit, mascarpone. Feeds 8.","priceCents":5200,"imageUrl":"https://images.unsplash.com/photo-1747576660180-f3b789cb0f7a?w=900&h=675&q=80&auto=format&fit=crop","badges":[],"modifiers":[{"name":"Inscription","min":0,"max":1,"options":[{"name":"Add hand-piped message","priceCents":500}]}]},{"id":"seed-8-chocolate-torte","name":"8\" Chocolate Torte","description":"Flourless, bittersweet, gold leaf. Feeds 12.","priceCents":6800,"imageUrl":"https://images.unsplash.com/photo-1785517607370-4fa07d35027f?w=900&h=675&q=80&auto=format&fit=crop","badges":["gf"],"modifiers":[]}]}]} catalogKind={"PRODUCT"} />
      </RtSection>
      <RtSection className="pt-[48px] pr-[18px] pb-[48px] pl-[18px] bg-[var(--c-surface)] md:pt-[72px] md:pr-[24px] md:pb-[72px] md:pl-[24px]" toneVars={{"--fx-ink":"0 0 0","--fx-strength":"1.27"}} contentWidth={1160}>
        <RtCouponBanner heading={"First pre-order?"} code={"CRUMB10"} description={"10% off orders over $25"} />
      </RtSection>
      </main>
    <RtFooter blurb={"A small bakehouse with a big oven. Everything naturally leavened, nothing held over."} />
    </>
  );
}

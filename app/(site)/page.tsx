import type { Metadata } from 'next';
import { RtBusinessHours, RtButton, RtCTASection, RtChapterCard, RtColumns, RtContainer, RtCountdown, RtFooter, RtHeading, RtKineticHeading, RtMapCard, RtMenuList, RtMenuPalace, RtNavbar, RtSection, RtSpotlight, RtTestimonials, RtText, RtTimelineFlow } from '@/components/runtime';
import { localizeMetadata } from '@/lib/locale-seo';

export const metadata: Metadata = localizeMetadata({
  title: "{{business.name}} · Bakery in {{business.city}}",
  description: "Naturally leavened breads and pastry. Pre-order online, custom cakes with 48h notice.",
  alternates: { canonical: "/" },
}, "en");

export default function Page() {
  return (
    <>
    <RtNavbar brand={"{{business.name}}"} ctaLabel={"Order ahead"} ctaPageSlug={"/shop"} />
      <main>
      <RtSection className="min-h-[clamp(400px,60vh,520px)] pt-[64px] pr-[20px] pb-[64px] pl-[20px] md:min-h-[clamp(520px,78vh,820px)] md:pt-[128px] md:pr-[24px] md:pb-[128px] md:pl-[24px]" toneVars={{"--fx-ink":"255 255 255","--fx-strength":"1"}} contentWidth={1160} bgImage={"https://images.unsplash.com/photo-1511018556340-d16986a1c194?w=2000&h=1200&q=80&auto=format&fit=crop"} imageFit={"cover"} lcp={true}>
        <RtText className="text-[13px] font-bold tracking-[0.14em] uppercase [text-shadow:0_0_7px_color-mix(in_srgb,#0a0a0a_60%,transparent),0_0_20px_color-mix(in_srgb,#0a0a0a_60%,transparent),0_0_42px_color-mix(in_srgb,#0a0a0a_60%,transparent)] break-keep text-[var(--c-accent)]" text={"Naturally leavened · baked daily"} textZh={"天然發酵 · 每日現烤"} />
        <RtKineticHeading text={"Get it before it sells out"} size={"display"} splitBy={"words"} textZh={"麵包不等人，賣完就沒"} level={"h1"} />
        <RtText className="max-w-[46ch] text-[18px] leading-[1.65] text-[#ece4d6]" text={"Sourdough at 7, case empty by noon. Pre-order online and yours is set aside."} textZh={"酸種麵包早上七點出爐，甜點櫃過了中午就見底。線上先訂，我們替你留好一份。"} />
        <RtContainer className="flex flex-row items-center flex-wrap gap-[12px]">
          <RtButton label={"Order ahead"} labelZh={"先訂先留"} variant={"solid"} size={"lg"} arrow={true} href={"/shop"} />
          <RtButton className="text-[#ffffff]" label={"Custom cakes"} variant={"outline"} size={"lg"} href={"/custom-cakes"} />
        </RtContainer>
      </RtSection>
      <RtSection className="pt-[48px] pr-[18px] pb-[48px] pl-[18px] md:pt-[0px] md:pr-[0px] md:pb-[0px] md:pl-[0px]" contentWidth={3000}>
        <RtMenuPalace heading={"Walk the menu"} sub={"Scroll to move through the chambers"} ctaLabel={"Order ahead"} href={"/shop"} initialData={[{"name":"Breads","items":[{"id":"seed-country-sourdough","name":"Country Sourdough","description":"36-hour ferment, blistered crust. Baked at 7am.","priceCents":850,"imageUrl":"https://images.unsplash.com/photo-1586444248902-2f64eddc13df?w=900&h=675&q=80&auto=format&fit=crop","badges":["popular"],"modifiers":[]},{"id":"seed-seeded-rye","name":"Seeded Rye","description":"Caraway and toasted seeds, dense and fragrant.","priceCents":900,"imageUrl":"https://images.unsplash.com/photo-1534620808146-d33bb39128b2?w=900&h=675&q=80&auto=format&fit=crop","badges":[],"modifiers":[]},{"id":"seed-rosemary-focaccia","name":"Rosemary Focaccia","description":"Olive-oil rich, flaky salt, whole sheet or half.","priceCents":750,"imageUrl":"https://images.unsplash.com/photo-1593629718888-9009c55e6cad?w=900&h=675&q=80&auto=format&fit=crop","badges":["vegan"],"modifiers":[{"name":"Size","min":1,"max":1,"options":[{"name":"Half sheet","priceCents":0},{"name":"Whole sheet","priceCents":600}]}]}]},{"name":"Pastry Case","items":[{"id":"seed-almond-croissant","name":"Almond Croissant","description":"Twice-baked, frangipane center.","priceCents":525,"imageUrl":"https://images.unsplash.com/photo-1625425404751-19b16c027511?w=900&h=675&q=80&auto=format&fit=crop","badges":["popular"],"modifiers":[]},{"id":"seed-morning-bun","name":"Morning Bun","description":"Cardamom sugar, croissant dough.","priceCents":475,"imageUrl":"https://images.unsplash.com/photo-1623334044303-241021148842?w=900&h=675&q=80&auto=format&fit=crop","badges":[],"modifiers":[]},{"id":"seed-canel","name":"Canelé","description":"Custard heart, caramelized shell.","priceCents":425,"imageUrl":"https://images.unsplash.com/photo-1488477181946-6428a0291777?w=900&h=675&q=80&auto=format&fit=crop","badges":[],"modifiers":[]},{"id":"seed-seasonal-fruit-danish","name":"Seasonal Fruit Danish","description":"Ask what the orchard sent this week.","priceCents":495,"imageUrl":"https://images.unsplash.com/photo-1635348965813-fa7d0dfb99d2?w=900&h=675&q=80&auto=format&fit=crop","badges":["new"],"modifiers":[]}]},{"name":"Whole Cakes (48h notice)","items":[{"id":"seed-6-celebration-cake","name":"6\" Celebration Cake","description":"Vanilla chiffon, seasonal fruit, mascarpone. Feeds 8.","priceCents":5200,"imageUrl":"https://images.unsplash.com/photo-1747576660180-f3b789cb0f7a?w=900&h=675&q=80&auto=format&fit=crop","badges":[],"modifiers":[{"name":"Inscription","min":0,"max":1,"options":[{"name":"Add hand-piped message","priceCents":500}]}]},{"id":"seed-8-chocolate-torte","name":"8\" Chocolate Torte","description":"Flourless, bittersweet, gold leaf. Feeds 12.","priceCents":6800,"imageUrl":"https://images.unsplash.com/photo-1785517607370-4fa07d35027f?w=900&h=675&q=80&auto=format&fit=crop","badges":["gf"],"modifiers":[]}]}]} />
      </RtSection>
      <RtSection className="pt-[48px] pr-[18px] pb-[48px] pl-[18px] bg-[var(--c-surface)] md:pt-[72px] md:pr-[24px] md:pb-[72px] md:pl-[24px]" toneVars={{"--fx-ink":"0 0 0","--fx-strength":"1.27"}} contentWidth={1160}>
        <RtContainer className="flex flex-col items-center gap-[12px]">
          <RtHeading className="font-heading text-[38px] font-bold text-center text-[var(--c-text)]" text={"Today’s case"} level={"h2"} />
          <RtText className="max-w-[60ch] text-[16px] leading-[1.65] text-center text-[var(--c-text-muted)]" text={"We bake to sell out, not to hold over. Pre-order for pickup."} />
        </RtContainer>
        <RtMenuList showImages={true} initialData={[{"name":"Breads","items":[{"id":"seed-country-sourdough","name":"Country Sourdough","description":"36-hour ferment, blistered crust. Baked at 7am.","priceCents":850,"imageUrl":"https://images.unsplash.com/photo-1586444248902-2f64eddc13df?w=900&h=675&q=80&auto=format&fit=crop","badges":["popular"],"modifiers":[]},{"id":"seed-seeded-rye","name":"Seeded Rye","description":"Caraway and toasted seeds, dense and fragrant.","priceCents":900,"imageUrl":"https://images.unsplash.com/photo-1534620808146-d33bb39128b2?w=900&h=675&q=80&auto=format&fit=crop","badges":[],"modifiers":[]},{"id":"seed-rosemary-focaccia","name":"Rosemary Focaccia","description":"Olive-oil rich, flaky salt, whole sheet or half.","priceCents":750,"imageUrl":"https://images.unsplash.com/photo-1593629718888-9009c55e6cad?w=900&h=675&q=80&auto=format&fit=crop","badges":["vegan"],"modifiers":[{"name":"Size","min":1,"max":1,"options":[{"name":"Half sheet","priceCents":0},{"name":"Whole sheet","priceCents":600}]}]}]},{"name":"Pastry Case","items":[{"id":"seed-almond-croissant","name":"Almond Croissant","description":"Twice-baked, frangipane center.","priceCents":525,"imageUrl":"https://images.unsplash.com/photo-1625425404751-19b16c027511?w=900&h=675&q=80&auto=format&fit=crop","badges":["popular"],"modifiers":[]},{"id":"seed-morning-bun","name":"Morning Bun","description":"Cardamom sugar, croissant dough.","priceCents":475,"imageUrl":"https://images.unsplash.com/photo-1623334044303-241021148842?w=900&h=675&q=80&auto=format&fit=crop","badges":[],"modifiers":[]},{"id":"seed-canel","name":"Canelé","description":"Custard heart, caramelized shell.","priceCents":425,"imageUrl":"https://images.unsplash.com/photo-1488477181946-6428a0291777?w=900&h=675&q=80&auto=format&fit=crop","badges":[],"modifiers":[]},{"id":"seed-seasonal-fruit-danish","name":"Seasonal Fruit Danish","description":"Ask what the orchard sent this week.","priceCents":495,"imageUrl":"https://images.unsplash.com/photo-1635348965813-fa7d0dfb99d2?w=900&h=675&q=80&auto=format&fit=crop","badges":["new"],"modifiers":[]}]},{"name":"Whole Cakes (48h notice)","items":[{"id":"seed-6-celebration-cake","name":"6\" Celebration Cake","description":"Vanilla chiffon, seasonal fruit, mascarpone. Feeds 8.","priceCents":5200,"imageUrl":"https://images.unsplash.com/photo-1747576660180-f3b789cb0f7a?w=900&h=675&q=80&auto=format&fit=crop","badges":[],"modifiers":[{"name":"Inscription","min":0,"max":1,"options":[{"name":"Add hand-piped message","priceCents":500}]}]},{"id":"seed-8-chocolate-torte","name":"8\" Chocolate Torte","description":"Flourless, bittersweet, gold leaf. Feeds 12.","priceCents":6800,"imageUrl":"https://images.unsplash.com/photo-1785517607370-4fa07d35027f?w=900&h=675&q=80&auto=format&fit=crop","badges":["gf"],"modifiers":[]}]}]} />
        <RtContainer className="flex flex-row justify-center items-center flex-wrap gap-[14px]">
          <RtButton label={"See the full menu"} variant={"outline"} size={"lg"} href={"/shop"} />
        </RtContainer>
      </RtSection>
      <RtSection className="pt-[48px] pr-[18px] pb-[48px] pl-[18px] md:pt-[72px] md:pr-[24px] md:pb-[72px] md:pl-[24px]" contentWidth={1160}>
        <RtCountdown target={"2026-11-25T18:00:00"} heading={"Thanksgiving pre-orders close"} headingZh={"感恩節預訂即將截止"} sub={"Pies, rolls, and bread for the table. When the clock runs out, the list is full."} subZh={"派、餐包和上桌的麵包。時間一到，名單就滿了。"} expired={"The holiday list is closed. Ask at the counter about the next one."} expiredZh={"節慶名單已截止，下一檔請到櫃檯詢問。"} />
      </RtSection>
      <RtSection className="pt-[48px] pr-[18px] pb-[48px] pl-[18px] bg-[var(--c-surface)] md:pt-[72px] md:pr-[24px] md:pb-[72px] md:pl-[24px]" toneVars={{"--fx-ink":"0 0 0","--fx-strength":"1.27"}} contentWidth={1160}>
        <RtContainer className="flex flex-col items-center gap-[12px]">
          <RtHeading className="font-heading text-[38px] font-bold text-center text-[var(--c-text)]" text={"Regulars plan their Saturdays around us"} level={"h2"} />
        </RtContainer>
        <RtTestimonials items={[{"author":"Priya K.","text":"The sourdough is worth planning your Saturday around. Order ahead, it sells out by 10.","rating":5},{"author":"Daniel R.","text":"Ordered a birthday cake through the quote form with a photo of what we wanted. They nailed it.","rating":5},{"author":"Meg W.","text":"Almond croissant supremacy. That is all.","rating":5}]} />
      </RtSection>
      <RtSection className="pt-[48px] pr-[18px] pb-[48px] pl-[18px] md:pt-[72px] md:pr-[24px] md:pb-[72px] md:pl-[24px]" contentWidth={1160}>
        <RtColumns className="gap-[56px]" ratio={"1:1"} align={"stretch"}>
          <RtContainer className="flex flex-col gap-[20px]">
            <RtBusinessHours />
          </RtContainer>
          <RtContainer className="flex flex-col gap-[20px]">
            <RtMapCard />
          </RtContainer>
        </RtColumns>
      </RtSection>
      <RtSection className="pt-[48px] pr-[18px] pb-[48px] pl-[18px] bg-[var(--c-surface)] md:pt-[72px] md:pr-[24px] md:pb-[72px] md:pl-[24px]" toneVars={{"--fx-ink":"0 0 0","--fx-strength":"1.27"}} contentWidth={1160}>
        <RtCTASection heading={"Tomorrow’s loaf, spoken for"} sub={"Order by 8pm tonight and walk past the line at pickup."} buttonLabel={"Reserve your bake"} href={"/shop"} />
      </RtSection>
      <RtSection className="pt-[48px] pr-[18px] pb-[48px] pl-[18px] md:pt-[0px] md:pr-[0px] md:pb-[0px] md:pl-[0px]" contentWidth={3000}>
        <RtChapterCard act={"OUR STORY"} title={"Proofed overnight, gone by noon"} />
      </RtSection>
      <RtSection className="pt-[48px] pr-[18px] pb-[48px] pl-[18px] md:pt-[72px] md:pr-[24px] md:pb-[72px] md:pl-[24px]" contentWidth={1160}>
        <RtTimelineFlow steps={[{"tag":"4 AM","title":"The ovens wake first","body":"Starter fed, dough shaped in the quiet."},{"tag":"7 AM","title":"First trays out","body":"Butter, steam, and the day’s first regulars."},{"tag":"NOON","title":"The case empties","body":"What you see is today’s, never yesterday’s."},{"tag":"TODAY","title":"Order ahead","body":"Your favorites, boxed and waiting."}]} />
      </RtSection>
      <RtSection className="pt-[48px] pr-[18px] pb-[48px] pl-[18px] bg-[var(--c-surface)] md:pt-[72px] md:pr-[24px] md:pb-[72px] md:pl-[24px]" toneVars={{"--fx-ink":"0 0 0","--fx-strength":"1.27"}} contentWidth={1160}>
        <RtSpotlight eyebrow={"Custom orders"} statement={"The best birthdays start at a bakery counter."} sub={"Cakes, towers, and tray bakes made to order. Tell us the occasion a week ahead."} />
      </RtSection>
      </main>
    <RtFooter blurb={"A small bakehouse with a big oven. Everything naturally leavened, nothing held over."} />
    </>
  );
}

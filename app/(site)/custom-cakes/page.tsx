import type { Metadata } from 'next';
import { RtBusinessHours, RtColumns, RtContainer, RtCouponBanner, RtFooter, RtGallery, RtHeading, RtNavbar, RtQuoteRequestForm, RtSection, RtText } from '@/components/runtime';
import { localizeMetadata } from '@/lib/locale-seo';

export const metadata: Metadata = localizeMetadata({
  title: "Custom Cakes · {{business.name}}",
  alternates: { canonical: "/custom-cakes" },
}, "en");

export default function Page() {
  return (
    <>
    <RtNavbar brand={"{{business.name}}"} ctaLabel={"Order ahead"} ctaPageSlug={"/shop"} />
      <main>
      <RtSection className="pt-[48px] pr-[18px] pb-[48px] pl-[18px] md:pt-[64px] md:pr-[24px] md:pb-[24px] md:pl-[24px]" contentWidth={1160}>
        <RtText className="text-[13px] font-bold tracking-[0.14em] uppercase break-keep text-[var(--c-primary)]" text={"Made to order"} />
        <RtHeading className="font-heading text-[29px] font-bold text-[var(--c-text)] md:text-[46px]" text={"Custom cakes & large orders"} level={"h1"} />
        <RtText className="text-[16px] leading-[1.65] text-[var(--c-text-muted)]" text={"Tell us the occasion, size, and flavors. Attach inspiration photos and we’ll reply with a quote within a day."} />
      </RtSection>
      <RtSection className="pt-[48px] pr-[18px] pb-[48px] pl-[18px] md:pt-[72px] md:pr-[24px] md:pb-[72px] md:pl-[24px]" contentWidth={1160}>
        <RtColumns className="gap-[56px]" ratio={"3:2"} align={"start"}>
          <RtContainer className="flex flex-col gap-[20px]">
            <RtQuoteRequestForm heading={"Request a custom cake"} detailLabel={"Occasion, servings, flavors, and any inspiration"} vehicle={false} estimator={false} />
          </RtContainer>
          <RtContainer className="flex flex-col gap-[20px]">
            <RtBusinessHours />
            <RtCouponBanner heading={"New customer?"} code={"CRUMB10"} description={"10% off orders over $25"} />
          </RtContainer>
        </RtColumns>
      </RtSection>
      <RtSection className="pt-[48px] pr-[18px] pb-[48px] pl-[18px] bg-[var(--c-surface)] md:pt-[72px] md:pr-[24px] md:pb-[72px] md:pl-[24px]" toneVars={{"--fx-ink":"0 0 0","--fx-strength":"1.27"}} contentWidth={1160}>
        <RtContainer className="flex flex-col items-center gap-[12px]">
          <RtHeading className="font-heading text-[38px] font-bold text-center text-[var(--c-text)]" text={"Cakes we’ve sent home"} level={"h2"} />
        </RtContainer>
        <RtGallery cols={3} images={[{"src":"https://images.unsplash.com/photo-1747576660180-f3b789cb0f7a?w=1200&h=900&q=80&auto=format&fit=crop","caption":""},{"src":"https://images.unsplash.com/photo-1533134242443-d4fd215305ad?w=1200&h=900&q=80&auto=format&fit=crop","caption":""},{"src":"https://images.unsplash.com/photo-1519915028121-7d3463d20b13?w=1200&h=900&q=80&auto=format&fit=crop","caption":""},{"src":"https://images.unsplash.com/photo-1488477181946-6428a0291777?w=1200&h=900&q=80&auto=format&fit=crop","caption":""},{"src":"https://images.unsplash.com/photo-1499636136210-6f4ee915583e?w=1200&h=900&q=80&auto=format&fit=crop","caption":""},{"src":"https://images.unsplash.com/photo-1785517607370-4fa07d35027f?w=1200&h=900&q=80&auto=format&fit=crop","caption":""}]} />
      </RtSection>
      </main>
    <RtFooter blurb={"A small bakehouse with a big oven. Everything naturally leavened, nothing held over."} />
    </>
  );
}

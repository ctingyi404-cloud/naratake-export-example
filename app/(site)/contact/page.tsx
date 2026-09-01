import type { Metadata } from 'next';
import { RtBusinessHours, RtColumns, RtContactForm, RtContainer, RtFooter, RtHeading, RtMapCard, RtNavbar, RtSection, RtSocialLinks, RtSpacer, RtText } from '@/components/runtime';
import { localizeMetadata } from '@/lib/locale-seo';

export const metadata: Metadata = localizeMetadata({
  title: "Contact · {{business.name}}",
  alternates: { canonical: "/contact" },
}, "en");

export default function Page() {
  return (
    <>
    <RtNavbar brand={"{{business.name}}"} ctaLabel={"Order ahead"} ctaPageSlug={"/shop"} />
      <main>
      <RtSection className="pt-[48px] pr-[18px] pb-[48px] pl-[18px] md:pt-[64px] md:pr-[24px] md:pb-[88px] md:pl-[24px]" contentWidth={1160}>
        <RtText className="text-[13px] font-bold tracking-[0.14em] uppercase break-keep text-[var(--c-primary)]" text={"Contact"} />
        <RtHeading className="font-heading text-[29px] font-bold text-[var(--c-text)] md:text-[46px]" text={"Find us"} level={"h1"} />
        <RtSpacer size={10} />
        <RtColumns className="gap-[56px]" ratio={"1:1"} align={"stretch"}>
          <RtContainer className="flex flex-col gap-[20px]">
            <RtBusinessHours />
          </RtContainer>
          <RtContainer className="flex flex-col gap-[20px]">
            <RtMapCard />
          </RtContainer>
        </RtColumns>
        <RtContactForm heading={"Send us a message"} buttonLabel={"Send message"} />
        <RtContainer className="flex flex-row justify-center items-center flex-wrap gap-[14px]">
          <RtSocialLinks />
        </RtContainer>
      </RtSection>
      </main>
    <RtFooter blurb={"A small bakehouse with a big oven. Everything naturally leavened, nothing held over."} />
    </>
  );
}

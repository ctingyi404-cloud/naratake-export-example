/* The nav bar and footer for routes that ship in the base tree.

   The editor's own pages carry Navbar and Footer as nodes, so they always have
   them. The routes that live here do not — and five of the six were rendering
   with neither. A property page is the exact URL an agent texts to a buyer; a
   story page is the exact URL a reader is sent. Both opened with no way to
   reach the rest of the site and no footer: no phone number, no address, and —
   once the policies existed — no link to them either. The visitor could only
   press Back.

   Kept as one component rather than four copies so a route added next month is
   right by default, and so the masthead/navbar decision is made once. */

import { RtFooter, RtNavbar } from '@/components/runtime/nav';
import { RtMasthead } from '@/components/runtime/editorial';
import { site } from '@/lib/site-config';

/** A publication is led by its masthead; everyone else by the nav bar. The site
    says which, so no route has to guess. */
export function SiteTopChrome() {
  if (site.chrome === 'masthead')
    return (
      <RtMasthead
        seal={site.masthead?.seal}
        actionLabel={site.masthead?.actionLabel}
        actionLabelZh={site.masthead?.actionLabelZh}
        actionHref={site.masthead?.actionHref}
        dateline={site.masthead?.dateline}
        datelineZh={site.masthead?.datelineZh}
        sectionLinks={site.masthead?.sectionLinks}
      />
    );
  return <RtNavbar brand={site.business.name} sectionLinks={site.nav?.sectionLinks} logoSize={site.nav?.logoSize} />;
}

export function SiteBottomChrome({ blurb }: { blurb?: string }) {
  /* RtFooter's blurb is required, and the sensible default for a route that
     has nothing of its own to say is the business's own description. */
  return <RtFooter blurb={blurb ?? site.business.name} />;
}

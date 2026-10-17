import Link from 'next/link';

import { ForbiddenNotice } from '@/components/admin/forbidden';
import { toLocationOption } from '@/components/admin/booking-rows';
import { mediaOptions, toOfferingFormValues } from '@/components/admin/offering-admin';
import { OfferingForm } from '@/components/admin/offering-form';
import { PageHeading } from '@/components/admin/shell';
import { listLocations } from '@/lib/booking/repo';
import { getBookingRules } from '@/lib/booking/settings';
import { requireCmsUser } from '@/lib/cms/auth';
import { can } from '@/lib/cms/permissions';

export const metadata = { title: 'Nieuw aanbod' };

export default async function NewOfferingPage() {
  const user = await requireCmsUser();
  if (!can(user.role, 'offering.manage')) return <ForbiddenNotice what="het aanbod" />;

  const [locations, media, rules] = await Promise.all([
    listLocations({ includeInactive: true }),
    can(user.role, 'media.read') ? mediaOptions() : Promise.resolve([]),
    getBookingRules(),
  ]);

  return (
    <>
      <PageHeading
        title="Nieuw aanbod"
        description="Een nieuwe dienst in het aanbod. Zodra je het toont, staat het op de website; zodra je het rechtstreeks online boekbaar maakt en een aanbieder het aanvinkt, kan het geboekt worden."
        actions={
          <Link
            href="/admin/aanbod"
            className="text-sm underline underline-offset-4 hover:text-primary"
          >
            Terug naar het aanbod
          </Link>
        }
      />
      <OfferingForm
        offering={toOfferingFormValues(null, [])}
        locations={locations.map(toLocationOption)}
        media={media}
        defaultBuffer={rules.defaultBufferAfterMinutes}
      />
    </>
  );
}

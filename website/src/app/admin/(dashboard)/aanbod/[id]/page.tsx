import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { ForbiddenNotice } from '@/components/admin/forbidden';
import { toLocationOption } from '@/components/admin/booking-rows';
import { mediaOptions, toOfferingFormValues } from '@/components/admin/offering-admin';
import { OfferingForm } from '@/components/admin/offering-form';
import { PageHeading } from '@/components/admin/shell';
import { badgeTone, FLASH_TONES } from '@/components/admin/tones';
import { listLocations } from '@/lib/booking/repo';
import { getBookingRules } from '@/lib/booking/settings';
import { requireCmsUser } from '@/lib/cms/auth';
import { can } from '@/lib/cms/permissions';
import { OFFERING_STATUS_LABELS } from '@/lib/offers/offering';
import { getOfferingForAdmin } from '@/lib/offers/repo';

export const metadata = { title: 'Aanbod bewerken' };

export default async function EditOfferingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const user = await requireCmsUser();
  if (!can(user.role, 'offering.manage')) return <ForbiddenNotice what="het aanbod" />;

  // Next 16: route params are async.
  const [{ id }, search] = await Promise.all([params, searchParams]);
  const found = await getOfferingForAdmin(id);
  if (!found) notFound();
  const { offering, services } = found;

  const [locations, media, rules] = await Promise.all([
    listLocations({ includeInactive: true }),
    can(user.role, 'media.read') ? mediaOptions() : Promise.resolve([]),
    getBookingRules(),
  ]);

  const listed = offering.settings.isListed;
  const status = offering.resolved.status;

  return (
    <>
      <PageHeading
        title={offering.content.title}
        description={offering.path}
        actions={
          <>
            <Badge
              variant={
                !listed
                  ? 'secondary'
                  : status === 'bookable'
                    ? 'success'
                    : status === 'unavailable'
                      ? 'warning'
                      : 'secondary'
              }
              className={badgeTone(
                !listed
                  ? 'secondary'
                  : status === 'bookable'
                    ? 'success'
                    : status === 'unavailable'
                      ? 'warning'
                      : 'secondary',
              )}
            >
              {listed ? OFFERING_STATUS_LABELS[status] : 'Verborgen'}
            </Badge>
            {listed ? (
              <a
                href={offering.path}
                target="_blank"
                rel="noreferrer"
                className="text-sm underline underline-offset-4 hover:text-primary"
              >
                Bekijk op de website
              </a>
            ) : null}
            <Link
              href="/admin/aanbod"
              className="text-sm underline underline-offset-4 hover:text-primary"
            >
              Alle aanbod
            </Link>
          </>
        }
      />
      {search.created ? (
        <p className={`mb-4 px-3 py-2 text-sm ${FLASH_TONES.success}`}>
          Aanbod aangemaakt. De website toont het meteen zo.
        </p>
      ) : null}
      <OfferingForm
        offering={toOfferingFormValues(offering, services)}
        locations={locations.map(toLocationOption)}
        media={media}
        defaultBuffer={rules.defaultBufferAfterMinutes}
      />
    </>
  );
}

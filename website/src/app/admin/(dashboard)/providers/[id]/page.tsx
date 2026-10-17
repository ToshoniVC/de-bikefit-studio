import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { ForbiddenNotice } from '@/components/admin/forbidden';
import { GoogleConnectionCard } from '@/components/admin/google-connection-card';
import { GoogleFlash } from '@/components/admin/google-flash';
import {
  toLocationOption,
  toProviderEditorProps,
  toProviderServiceOption,
} from '@/components/admin/booking-rows';
import {
  BusinessHoursEditor,
  ExceptionsEditor,
  ProviderProfileForm,
} from '@/components/admin/provider-editor';
import { ProviderServicesForm } from '@/components/admin/provider-services-form';
import { PageHeading } from '@/components/admin/shell';
import { badgeTone } from '@/components/admin/tones';
import { googleConnectSetup } from '@/lib/booking/google';
import { getProvider, listLocations, listServices } from '@/lib/booking/repo';
import { todayYmd } from '@/lib/booking/time';
import { requireCmsUser } from '@/lib/cms/auth';
import { listOfferingSubscriptionGroups, type OfferingSubscriptionGroup } from '@/lib/offers/repo';
import { can, ROLE_LABELS } from '@/lib/cms/permissions';

export const metadata = { title: 'Aanbieder' };

/** Offerings to group the services form by; without them the flat list of before. */
function offeringGroups(): Promise<OfferingSubscriptionGroup[]> {
  return listOfferingSubscriptionGroups().catch(() => {
    console.error('[cms] offering_groups_unavailable');
    return [];
  });
}

export default async function AdminProviderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ google?: string; reason?: string }>;
}) {
  const user = await requireCmsUser();
  if (!can(user.role, 'provider.read')) return <ForbiddenNotice what="de aanbieders" />;

  // Next 16: route params are async.
  const [{ id }, search] = await Promise.all([params, searchParams]);
  const provider = await getProvider(id);
  if (!provider) notFound();

  const [services, locations, groups] = await Promise.all([
    can(user.role, 'service.read') ? listServices({ includeInactive: true }) : Promise.resolve([]),
    can(user.role, 'location.read')
      ? listLocations({ includeInactive: true })
      : Promise.resolve([]),
    can(user.role, 'service.read') ? offeringGroups() : Promise.resolve([]),
  ]);

  const canEdit = can(user.role, 'provider.manage');
  const editor = toProviderEditorProps(provider);
  const locationOptions = locations.map(toLocationOption);

  return (
    <>
      <PageHeading
        title={provider.displayName}
        description={`Login: ${provider.userEmail} · ${ROLE_LABELS[provider.userRole]}`}
        actions={
          <>
            <Badge
              variant={provider.isActive ? 'success' : 'secondary'}
              className={badgeTone(provider.isActive ? 'success' : 'secondary')}
            >
              {provider.isActive ? 'Actief' : 'Inactief'}
            </Badge>
            {!provider.userActive ? <Badge variant="destructive">Login gedeactiveerd</Badge> : null}
            <Link
              href={`/admin/bookings?provider=${provider.id}`}
              className="text-sm underline underline-offset-4 hover:text-primary"
            >
              Afspraken
            </Link>
            <Link
              href="/admin/providers"
              className="text-sm underline underline-offset-4 hover:text-primary"
            >
              Alle aanbieders
            </Link>
          </>
        }
      />
      <GoogleFlash {...search} />

      <div className="flex flex-col gap-4">
        <ProviderProfileForm
          provider={editor.profile}
          locations={locationOptions}
          scope="any"
          canEdit={canEdit}
        />
        <ProviderServicesForm
          providerId={provider.id}
          services={services.map(toProviderServiceOption)}
          subscriptions={editor.subscriptions}
          locations={locationOptions}
          scope="any"
          canEdit={canEdit}
          groups={groups}
          description="Wat deze aanbieder aanbiedt, per aanbod en variant, eventueel met een andere locatie per dienst. Normaal kiest de aanbieder dit zelf."
        />
        <BusinessHoursEditor
          providerId={provider.id}
          hours={editor.hours}
          locations={locationOptions}
          scope="any"
          canEdit={canEdit}
        />
        <ExceptionsEditor
          providerId={provider.id}
          exceptions={editor.exceptions}
          todayYmd={todayYmd()}
          scope="any"
          canEdit={canEdit}
        />
        <GoogleConnectionCard
          providerId={provider.id}
          google={editor.google}
          scope="any"
          canConnect={canEdit}
          setup={googleConnectSetup({ canManage: canEdit })}
        />
      </div>
    </>
  );
}

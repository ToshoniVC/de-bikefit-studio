import Link from 'next/link';

import { ForbiddenNotice } from '@/components/admin/forbidden';
import {
  toBookingRows,
  toLocationOption,
  toProviderEditorProps,
  toProviderServiceOption,
} from '@/components/admin/booking-rows';
import { BookingsTable } from '@/components/admin/bookings-table';
import { SectionCard } from '@/components/admin/form';
import { GoogleFlash } from '@/components/admin/google-flash';
import {
  BusinessHoursEditor,
  ExceptionsEditor,
  GoogleConnectionCard,
  ProviderProfileForm,
} from '@/components/admin/provider-editor';
import { ProviderServicesForm } from '@/components/admin/provider-services-form';
import { ServiceCreateForm } from '@/components/admin/services-manager';
import { PageHeading } from '@/components/admin/shell';
import { getOwnProvider, listBookings, listLocations, listServices } from '@/lib/booking/repo';
import { getBookingRules } from '@/lib/booking/settings';
import { todayYmd } from '@/lib/booking/time';
import { requireCmsUser } from '@/lib/cms/auth';
import { listOfferingSubscriptionGroups, type OfferingSubscriptionGroup } from '@/lib/offers/repo';
import { can } from '@/lib/cms/permissions';
import { features } from '@/lib/env';

export const metadata = { title: 'Mijn agenda' };

type Search = { google?: string; reason?: string };

export default async function AdminAgendaPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireCmsUser();
  if (!can(user.role, 'provider.self')) return <ForbiddenNotice what="een eigen agenda" />;

  const search = await searchParams;
  const provider = await getOwnProvider();

  if (!provider) {
    return (
      <>
        <PageHeading title="Mijn agenda" />
        <GoogleFlash {...search} />
        <SectionCard
          title="Nog geen aanbiedersprofiel"
          description="Je account is nog niet gekoppeld aan een aanbieder, dus er is geen agenda om te beheren."
        >
          <p className="text-sm text-muted-foreground">
            {can(user.role, 'provider.manage') ? (
              <>
                Maak een profiel aan of beheer bestaande aanbieders via{' '}
                <Link
                  href="/admin/providers"
                  className="underline underline-offset-4 hover:text-primary"
                >
                  Aanbieders
                </Link>
                .
              </>
            ) : (
              'Vraag een beheerder om een aanbiedersprofiel voor je aan te maken.'
            )}
          </p>
        </SectionCard>
      </>
    );
  }

  const [bookings, services, locations, rules, groups] = await Promise.all([
    listBookings({ scope: 'own', range: 'upcoming', limit: 50 }),
    can(user.role, 'service.read') ? listServices({ includeInactive: true }) : Promise.resolve([]),
    can(user.role, 'location.read') ? listLocations() : Promise.resolve([]),
    getBookingRules(),
    can(user.role, 'service.read')
      ? listOfferingSubscriptionGroups().catch((): OfferingSubscriptionGroup[] => {
          console.error('[cms] offering_groups_unavailable');
          return [];
        })
      : Promise.resolve([]),
  ]);

  const editor = toProviderEditorProps(provider);
  const locationOptions = locations.map(toLocationOption);
  const canEditSelf = can(user.role, 'provider.self');

  return (
    <>
      <PageHeading
        title="Mijn agenda"
        description={`Je afspraken, uren, aanbod en Google Agenda als ${provider.displayName}.`}
        actions={
          <Link
            href="/admin/bookings"
            className="text-sm underline underline-offset-4 hover:text-primary"
          >
            Alle afspraken
          </Link>
        }
      />
      <GoogleFlash {...search} />

      <div className="flex flex-col gap-4">
        <section>
          <h2 className="mb-3 text-2xl leading-tight">Komende afspraken</h2>
          <BookingsTable
            bookings={toBookingRows(bookings)}
            canManage={can(user.role, 'booking.manage.own') || can(user.role, 'booking.manage')}
            showProvider={false}
            emptyText="Geen komende afspraken."
          />
        </section>

        <GoogleConnectionCard
          providerId={provider.id}
          google={editor.google}
          scope="own"
          canConnect={canEditSelf}
          configured={features.googleCalendar}
        />
        <BusinessHoursEditor
          providerId={provider.id}
          hours={editor.hours}
          scope="own"
          canEdit={canEditSelf}
        />
        <ExceptionsEditor
          providerId={provider.id}
          exceptions={editor.exceptions}
          todayYmd={todayYmd()}
          scope="own"
          canEdit={canEditSelf}
        />
        <ProviderServicesForm
          providerId={provider.id}
          services={services.map(toProviderServiceOption)}
          subscriptions={editor.subscriptions}
          locations={locationOptions}
          scope="own"
          canEdit={can(user.role, 'service.subscribe.own') || can(user.role, 'provider.manage')}
          groups={groups}
          title="Mijn aanbod"
          description="Vink aan wat je zelf aanbiedt, per aanbod en variant (bv. Volwassene en Jeugd), en kies per dienst eventueel een andere locatie. Een aanbod is pas online te boeken als minstens één aanbieder het aanbiedt. Naam, duur en prijs beheert de beheerder."
        />
        {/* The catalogue is the admin's: a provider never sees a create form here. */}
        {can(user.role, 'service.manage') ? (
          <SectionCard
            title="Nieuwe dienst"
            description="Staat je dienst er niet bij? Maak hem aan en vink hem daarna hierboven aan."
          >
            <ServiceCreateForm
              locations={locationOptions}
              defaultBuffer={rules.defaultBufferAfterMinutes}
              idPrefix="agenda-service-new"
            />
          </SectionCard>
        ) : null}
        <ProviderProfileForm
          provider={editor.profile}
          locations={locationOptions}
          scope="own"
          canEdit={canEditSelf}
        />
      </div>
    </>
  );
}

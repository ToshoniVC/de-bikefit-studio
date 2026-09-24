import type { Metadata } from 'next';
import { BookingSummaryList } from '@/components/studio/booking/booking-summary';
import { CancelNote } from '@/components/studio/booking/confirmation';
import { readConfirmationRef } from '@/components/studio/booking/confirmation-ref';
import { StudioButtonLink } from '@/components/studio/link';
import { getSiteSettings } from '@/lib/cms/content';
import { defaultLocale } from '@/lib/studio/locale';
import { applyTitleTemplate } from '@/lib/studio/seo';

/**
 * `/afspraak/bevestigd` — the refresh-safe confirmation.
 *
 * After a booking the widget swaps this URL, with a signed `ref` (see
 * `confirmation-ref.ts`), into the address bar, so reloading shows the booking
 * rather than an empty form. The `ref` carries no personal data and nothing
 * is read from the database here. Without a valid `ref` the page is a generic
 * "bedankt" that points to the confirmation e-mail.
 *
 * Never indexed, rendered per request.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings(defaultLocale);
  return {
    title: { absolute: applyTitleTemplate(settings.seo.titleTemplate, 'Afspraak bevestigd') },
    robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
  };
}

function minutesBetween(startsAt: string, endsAt: string): number | null {
  const minutes = Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60_000);
  return minutes > 0 ? minutes : null;
}

export default async function BookingConfirmedPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string | string[] }>;
}) {
  const { ref: rawRef } = await searchParams;
  const ref = readConfirmationRef(typeof rawRef === 'string' ? rawRef : null);
  const settings = await getSiteSettings(defaultLocale);
  const rules = settings.booking;
  const { phoneLabel, phoneHref } = settings.contact;

  return (
    <section className="studio-booking-page">
      <div className="studio-booking-page__inner">
        <p className="studio-eyebrow">Afspraak</p>
        <h1 className="studio-booking-page__title">
          {ref ? 'Je afspraak staat vast' : 'Bedankt voor je afspraak'}
        </h1>
        <p className="studio-booking-page__lede">{rules.confirmationText}</p>

        {ref ? (
          <BookingSummaryList
            serviceName={ref.serviceName}
            durationMinutes={minutesBetween(ref.startsAt, ref.endsAt)}
            startsAt={ref.startsAt}
            endsAt={ref.endsAt}
            timezone={ref.timezone}
            where={ref.where}
            providerName={ref.providerName}
          />
        ) : (
          <p className="studio-booking__confirm-text">
            Alle details van je afspraak staan in de bevestigingsmail. Niets ontvangen? Kijk even in
            je map met ongewenste e-mail.
          </p>
        )}

        <CancelNote
          cancelUntilHours={rules.cancelUntilHours}
          phoneLabel={phoneLabel}
          phoneHref={phoneHref}
        />

        <p className="studio-booking__actions">
          <StudioButtonLink href="/afspraak" variant="outline">
            Nog een afspraak maken
          </StudioButtonLink>
          <StudioButtonLink href="/" variant="ghost" arrow={false}>
            Naar de homepagina
          </StudioButtonLink>
        </p>
      </div>
    </section>
  );
}

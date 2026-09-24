import type { Metadata } from 'next';
import { BookingSummaryList } from '@/components/studio/booking/booking-summary';
import { CancelPanel } from '@/components/studio/booking/cancel-panel';
import { instantToTime, instantToYmd, longDate } from '@/components/studio/booking/dates';
import { StudioButtonLink } from '@/components/studio/link';
import { getBookingByCancelToken, type BookingByTokenResult } from '@/lib/booking/public-booking';
import { getSiteSettings } from '@/lib/cms/content';
import { defaultLocale } from '@/lib/studio/locale';
import { applyTitleTemplate } from '@/lib/studio/seo';

/**
 * `/afspraak/annuleren/[token]` — the cancel link from the confirmation mail.
 *
 * Shows what would be cancelled (no contact data: `getBookingByCancelToken`
 * returns a public summary only) and whether the link still works. Cancelling
 * itself needs a click (`CancelPanel` → `cancelAction`), so a mail scanner that
 * opens the link cannot cancel anything.
 *
 * Never indexed, rendered per request, and `no-referrer` so the token in the
 * URL is not passed on to any page linked from here.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings(defaultLocale);
  return {
    title: { absolute: applyTitleTemplate(settings.seo.titleTemplate, 'Afspraak annuleren') },
    robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
    referrer: 'no-referrer',
  };
}

function minutesBetween(startsAt: string, endsAt: string): number | null {
  const minutes = Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60_000);
  return minutes > 0 ? minutes : null;
}

export default async function CancelBookingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const settings = await getSiteSettings(defaultLocale);
  const { phoneLabel, phoneHref } = settings.contact;

  let lookup: BookingByTokenResult;
  try {
    // Tokens are base64url; anything else is rejected inside as "ongeldig".
    lookup = await getBookingByCancelToken(token);
  } catch (error) {
    console.error('[booking] cancel page lookup failed', error);
    lookup = { ok: false, message: 'Er ging iets mis. Probeer het later opnieuw of bel ons.' };
  }

  if (!lookup.ok) {
    return (
      <section className="studio-booking-page">
        <div className="studio-booking-page__inner">
          <p className="studio-eyebrow">Afspraak</p>
          <h1 className="studio-booking-page__title">Deze link werkt niet</h1>
          <p className="studio-booking-page__lede">{lookup.message}</p>
          <p className="studio-booking__confirm-text">
            Controleer of je de volledige link uit je bevestigingsmail gebruikt.
            {phoneLabel && phoneHref ? (
              <>
                {' '}
                Lukt het niet? Bel ons op <a href={phoneHref}>{phoneLabel}</a>.
              </>
            ) : null}
          </p>
          <p className="studio-booking__actions">
            <StudioButtonLink href="/" variant="ghost" arrow={false}>
              Naar de homepagina
            </StudioButtonLink>
          </p>
        </div>
      </section>
    );
  }

  const { booking, canCancel, reason, cancelDeadline } = lookup;
  const cancelled = booking.status === 'cancelled';
  const deadline = `${longDate(instantToYmd(cancelDeadline, booking.timezone))} om ${instantToTime(cancelDeadline, booking.timezone)}`;

  return (
    <section className="studio-booking-page">
      <div className="studio-booking-page__inner">
        <p className="studio-eyebrow">Afspraak</p>
        <h1 className="studio-booking-page__title">
          {cancelled ? 'Afspraak geannuleerd' : 'Afspraak annuleren'}
        </h1>
        <p className="studio-booking-page__lede">
          {cancelled
            ? 'Deze afspraak is al geannuleerd. Je hoeft niets meer te doen.'
            : canCancel
              ? `Wil je deze afspraak annuleren? Dat kan via deze link tot ${deadline}.`
              : (reason ?? 'Deze afspraak kan niet meer via de link geannuleerd worden.')}
        </p>

        <BookingSummaryList
          serviceName={booking.serviceName}
          durationMinutes={minutesBetween(booking.startsAt, booking.endsAt)}
          startsAt={booking.startsAt}
          endsAt={booking.endsAt}
          timezone={booking.timezone}
          where={booking.locationLabel}
          providerName={booking.providerName}
        />

        {canCancel && !cancelled ? (
          <CancelPanel token={token} phoneLabel={phoneLabel} phoneHref={phoneHref} />
        ) : (
          <p className="studio-booking__actions">
            <StudioButtonLink href="/afspraak" variant="outline">
              Een nieuwe afspraak maken
            </StudioButtonLink>
          </p>
        )}
      </div>
    </section>
  );
}

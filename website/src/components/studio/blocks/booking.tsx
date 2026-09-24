import { getSiteSettings } from '@/lib/cms/content';
import { BookingWidget } from '../booking/booking-widget';
import { loadBookingOptions, type BookingOptions } from '../booking/load';
import type { BookingWidgetProps } from '../booking/types';
import { StudioSection } from './section';
import type { BlockProps } from './types';

/**
 * `booking` — the online booking widget.
 *
 * A server component: it reads services, providers and rules through
 * `@/lib/booking/content` (cached; live availability is fetched later by the
 * widget through `availabilityAction`) and hands the client widget nothing but
 * plain, serialisable props.
 *
 * It never breaks the page: when the booking tables are unreachable (e.g. the
 * migration has not run yet) or nothing is bookable, the section shows a short
 * "bel ons" fallback with the studio's phone number instead.
 *
 * The section anchor defaults to `#boeken`, which the `/afspraak` hero links to.
 */
export async function BookingBlock({ data, anchor, headingLevel, locale }: BlockProps<'booking'>) {
  const settings = await getSiteSettings(locale);
  const { phoneLabel, phoneHref } = settings.contact;

  let options: BookingOptions | null = null;
  try {
    options = await loadBookingOptions(locale, data.serviceIds);
  } catch (error) {
    console.error('[booking] widget data unavailable', error);
  }

  const rules = options?.rules ?? settings.booking;
  const title = data.title || rules.introTitle;
  const lede = data.lede || rules.introText;

  const props: BookingWidgetProps | null =
    options && options.services.length > 0
      ? {
          services: options.services,
          providers: options.providers,
          todayYmd: options.todayYmd,
          rules: {
            timezone: options.rules.timezone,
            horizonDays: options.rules.horizonDays,
            cancelUntilHours: options.rules.cancelUntilHours,
            showProviderChoice: data.showProviderChoice && options.rules.showProviderChoice,
          },
          copy: {
            successTitle: data.successTitle,
            successText: data.successText || options.rules.confirmationText,
            phoneLabel,
            phoneHref,
          },
        }
      : null;

  return (
    <StudioSection
      variant={data.variant}
      anchor={anchor ?? 'boeken'}
      eyebrow={data.eyebrow}
      title={title}
      lede={lede}
      headingLevel={headingLevel}
    >
      {props ? (
        <BookingWidget {...props} />
      ) : (
        <div className="studio-booking__fallback">
          <p>
            Online boeken lukt op dit moment niet.
            {phoneLabel && phoneHref ? (
              <>
                {' '}
                Bel ons op <a href={phoneHref}>{phoneLabel}</a> en we zoeken samen een moment.
              </>
            ) : (
              ' Probeer het later opnieuw.'
            )}
          </p>
        </div>
      )}
    </StudioSection>
  );
}

import { getSiteSettings } from '@/lib/cms/content';
import { listPublishedOffers } from '@/lib/cms/offers-content';
import {
  groupBookingChoices,
  resolveBookingSelection,
  type BookingSelection,
  type CatalogueOffer,
} from '@/lib/offers/catalogue';
import { BookingWidget } from '../booking/booking-widget';
import { BookingHeadingLevel } from '../booking/heading-level';
import { loadBookingOptions, type BookingOptions } from '../booking/load';
import { OfferEnquiry } from '../booking/offer-enquiry';
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
 * `?dienst=<slug>` (validated by the route, passed as `page.requestedService`)
 * is resolved here with `resolveBookingSelection()`:
 *  - an offer linked to bookable services → the widget, narrowed to those
 *    services (preselected when there is one) and naming the offer;
 *  - an offer without a bookable service → a contact prompt that names the
 *    offer (`OfferEnquiry`), never the widget with an unrelated default;
 *  - a booking-service slug → the widget with that service preselected;
 *  - an unknown slug → the normal widget with a short notice.
 *
 * Offers are the public vocabulary on the plain widget too: services that a
 * published offer links to appear once, under that offer, as a sub-selection
 * (`groupBookingChoices()`: "Bikefit – huidige fiets" → Volwassene / Jeugd);
 * services no offer links to stay directly selectable. The chosen SERVICE is
 * what is booked, with its own duration, availability, guardian rule and price.
 *
 * It never breaks the page: when the booking tables are unreachable (e.g. the
 * migration has not run yet) or nothing is bookable, the section shows a short
 * "bel ons" fallback with the studio's phone number instead.
 *
 * The section anchor defaults to `#boeken`, which the `/afspraak` hero links to.
 */
export async function BookingBlock({
  data,
  anchor,
  headingLevel,
  locale,
  page,
}: BlockProps<'booking'>) {
  const settings = await getSiteSettings(locale);
  const { phoneLabel, phoneHref, email } = settings.contact;

  let options: BookingOptions | null = null;
  try {
    options = await loadBookingOptions(locale, data.serviceIds);
  } catch {
    // A fixed code, never the error: a failed query's message holds the SQL and its bound values.
    console.error('[booking] widget_data_unavailable');
  }

  // Cached reader; without it the widget simply lists every service on its own.
  let offers: CatalogueOffer[] = [];
  try {
    offers = await listPublishedOffers(locale);
  } catch {
    console.error('[booking] offer_catalogue_unavailable');
  }
  const selection: BookingSelection = resolveBookingSelection({
    requested: page.requestedService,
    offers,
    services: options?.services ?? [],
  });

  const rules = options?.rules ?? settings.booking;
  // Headings inside the section sit one level below its title.
  const innerHeading = headingLevel === 1 ? 'h2' : 'h3';
  const section = {
    variant: data.variant,
    anchor: anchor ?? 'boeken',
    eyebrow: data.eyebrow,
    headingLevel,
  };

  if (selection.kind === 'offer' && selection.serviceIds.length === 0) {
    return (
      <StudioSection {...section} eyebrow="" title="Je afspraak aanvragen">
        <OfferEnquiry
          offer={selection.offer}
          phoneLabel={phoneLabel}
          phoneHref={phoneHref}
          email={email}
          titleTag={innerHeading}
        />
      </StudioSection>
    );
  }

  const title = data.title || rules.introTitle;
  const lede = data.lede || rules.introText;

  let props: BookingWidgetProps | null = null;
  if (options && options.services.length > 0) {
    let services = options.services;
    let initialServiceId: string | null = null;
    let context: BookingWidgetProps['context'] = null;
    let notice = '';

    if (selection.kind === 'offer') {
      services = selection.serviceIds
        .map((id) => options.services.find((service) => service.id === id))
        .filter((service): service is (typeof services)[number] => Boolean(service));
      initialServiceId = selection.initialServiceId;
      context = { label: selection.offer.title, href: selection.offer.path };
    } else if (selection.kind === 'service') {
      initialServiceId = selection.serviceId;
    } else if (selection.kind === 'unknown') {
      notice = 'We vonden de gekozen dienst niet terug. Kies hieronder zelf je fit.';
    }

    const offered = new Set(services.map((service) => service.id));
    // Behind an offer link, only that offer groups: a service another offer
    // also links must not appear under that other offer's title here.
    const grouping =
      selection.kind === 'offer'
        ? offers.filter((offer) => offer.slug === selection.offer.slug)
        : offers;
    props = {
      services,
      choices: groupBookingChoices({ offers: grouping, services }),
      providers: options.providers.filter((provider) =>
        provider.services.some((entry) => offered.has(entry.serviceId)),
      ),
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
      initialServiceId,
      context,
      notice,
    };
  }

  return (
    <StudioSection {...section} title={title} lede={lede}>
      {props ? (
        <BookingHeadingLevel tag={innerHeading}>
          <BookingWidget {...props} />
        </BookingHeadingLevel>
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

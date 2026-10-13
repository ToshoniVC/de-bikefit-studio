import { BOOKING_PATH, CONTACT_EMAIL, PHONE_HREF, PHONE_LABEL, type SeedPage } from './shared';

/**
 * `/afspraak` — the single place to book or ask (Toshoni's site review,
 * 13 Oct 2026). Plain data; used by `cms:seed` and, as the target state, by
 * `cms:patch-page-cleanup` (`page-cleanup.ts`).
 *
 * The page opens on "Kies je moment" (the booking widget owns the `<h1>`),
 * then "Voor je komt" with the "Andere vraag?" line. The page head, "Vier
 * manieren om te boeken", the "Boek je bikefit" contact section and the
 * closing "Boek je bikefit" band are gone; `/contact` redirects here.
 *
 * Provenance: content/booking.html (step order, tone), the `booking` block,
 * and the "wat breng je mee" / "hoe lang duurt het" answers from
 * content/about.html. "Andere vraag?" is Toshoni's wording.
 */

/** "Andere vraag?" under "Voor je komt"; the patch appends exactly this. */
export const OTHER_QUESTION_HTML = [
  '<h3>Andere vraag?</h3>',
  `<p>Contacteer ons op <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> of <a href="${PHONE_HREF}">${PHONE_LABEL}</a>.</p>`,
].join('');

const BEFORE_YOU_COME_HTML = [
  '<h3>Breng het juiste mee</h3>',
  '<p>Je fiets (proper en in werkende staat), de schoenen en fietskleding waarin je écht rijdt, en eventuele notities over wat je dwars zit. Meer hebben we niet nodig. De rest doen wij.</p>',
  '<h3>Reken op de tijd</h3>',
  '<p>Reken op 90 minuten voor een standaard bikefit voor volwassenen. Een jeugdfit is korter — ongeveer 60 minuten. We haasten ons niet — als het klaar is, is het klaar.</p>',
  `<p>Liever bellen, of vind je geen moment dat past? Bel <a href="${PHONE_HREF}">${PHONE_LABEL}</a> en we zoeken samen een moment.</p>`,
  OTHER_QUESTION_HTML,
].join('');

export const AFSPRAAK_PAGE: SeedPage = {
  slug: BOOKING_PATH.slice(1),
  title: 'Een afspraak maken',
  translationGroup: 'appointment',
  source:
    'content/booking.html + booking block + content/about.html answers; review 13 Oct 2026 ("Kies je moment" first, "Andere vraag?")',
  metaTitle: 'Een afspraak maken',
  metaDescription:
    'Boek je bikefit in Ninove online: kies je fit, een dag en een uur. Liever bellen? 0473 95 26 33. Breng je fiets, schoenen en fietskleding mee.',
  structuredDataType: 'WebPage',
  blocks: [
    {
      type: 'booking',
      data: {
        variant: 'default',
        eyebrow: '',
        title: 'Kies je moment',
        lede: 'Kies je fit, bij wie en wanneer. Je krijgt meteen een bevestiging per e-mail.',
        serviceIds: [],
        showProviderChoice: true,
        successTitle: 'Je afspraak staat vast',
        successText: '',
      },
    },
    {
      type: 'richText',
      data: {
        variant: 'default',
        eyebrow: 'Goed om te weten',
        title: 'Voor je komt',
        html: BEFORE_YOU_COME_HTML,
      },
    },
  ],
};

/** The old contact page is unpublished (row and snapshot kept) and sends visitors here. */
export const RETIRED_CONTACT_SLUG = 'contact';

export const CONTACT_REDIRECT = {
  fromPath: `/${RETIRED_CONTACT_SLUG}`,
  toPath: BOOKING_PATH,
  statusCode: 301 as const,
  notes: 'Contact verwijst naar Een afspraak maken (review 13 okt 2026).',
};

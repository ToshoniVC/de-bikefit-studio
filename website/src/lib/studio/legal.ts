/**
 * The legal identity of the business behind the site, in one place, so the
 * transactional e-mails (`src/lib/email/templates.ts`) and the error pages
 * always show the same facts. The public footer no longer shows it (Toshoni's
 * review, 13 Oct 2026); the legal pages carry it in their text.
 *
 * Source: KBO public search (kbopub.economie.fgov.be), enterprise number
 * 1036.912.281, consulted 24 Sep 2026. The RPR division follows from the
 * registered office (Asse, arrondissement Halle-Vilvoorde) and should be
 * checked against the Belgisch Staatsblad publication.
 *
 * Belgian law (art. III.74 WER, art. 2:20 WVV) requires the name, legal form,
 * registered office, enterprise number and an e-mail address on the website:
 * `/privacy` and `/algemene-voorwaarden` state them, and the footer shows the
 * public address from `cms_site_settings.contact.email`
 * (info@debikefitstudio.be, confirmed by Toshoni on 13 Oct 2026).
 *
 * Plain module (no `server-only`, no I/O): safe in server components, e-mail
 * templates and scripts alike.
 */
export const LEGAL_IDENTITY = {
  /** Legal name including the legal form. */
  name: 'Qarakter BV',
  /** Trade name (handelsnaam) the public knows. */
  tradeName: 'De Bikefit Studio',
  street: 'Weversstraat 7',
  /** Postal code and municipality. */
  city: '1730 Asse',
  /** Enterprise (KBO) number, which is also the VAT number. */
  kbo: 'BE 1036.912.281',
  /** Rechtspersonenregister: court division of the registered office. */
  rpr: 'Brussel, Nederlandstalige afdeling',
  phoneLabel: '0473 95 26 33',
  phoneHref: 'tel:+32473952633',
} as const;

/** Site-relative paths of the two legal pages (seeded by `scripts/cms-seed.mts`). */
export const LEGAL_LINKS = {
  privacy: '/privacy',
  terms: '/algemene-voorwaarden',
} as const;

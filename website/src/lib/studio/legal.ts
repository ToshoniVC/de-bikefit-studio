/**
 * The legal identity of the business behind the site, in one place, so the
 * public footer (`src/components/studio/site-footer.tsx`) and the transactional
 * e-mails (`src/lib/email/templates.ts`) always show the same facts.
 *
 * Source: KBO public search (kbopub.economie.fgov.be), enterprise number
 * 1036.912.281, consulted 24 Sep 2026. The RPR division follows from the
 * registered office (Asse, arrondissement Halle-Vilvoorde) and should be
 * checked against the Belgisch Staatsblad publication.
 *
 * Belgian law (art. III.74 WER, art. 2:20 WVV) requires the name, legal form,
 * registered office, enterprise number and an e-mail address on the website.
 * No public e-mail address is on record yet: the footer shows
 * `cms_site_settings.contact.email` when it is filled in.
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

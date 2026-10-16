import { z } from 'zod';
import { formatDuration, formatPrice } from '@/lib/booking/format';
import { OFFER_DURATION_FALLBACK, OFFER_PRICE_FALLBACK, offerDurationLabel } from './catalogue';

/**
 * Offering settings — what Beheer → Aanbod decides per offer page.
 *
 * Plain module: no I/O, no Next, no `server-only`. Unit-tested in
 * `offering.test.ts`; shared by the public blocks, the booking block, the
 * admin screen, the migration script and the self-test.
 *
 * Per offering, in ONE place (tables `cms_offerings` + `cms_offering_variants`,
 * `src/db/cms-offering-schema.ts`):
 *
 *  - `isListed`: shown on the website (overviews, its own page, `/afspraak`);
 *  - `variantMode`: `single` (one option) or `audience` (Volwassene and Jeugd
 *    apart, each its own booking service, duration and price);
 *  - `bookingMode`: `direct` (online booking through `/afspraak?dienst=<slug>`)
 *    or `enquiry` (the enquiry form on the offer page);
 *  - per variant: the booking service (`cms_services`) it is booked as, and its
 *    public price in cents (`null` = "Prijs op aanvraag", never € 0).
 *
 * Whether a direct offering is bookable RIGHT NOW is not stored: a variant is
 * bookable when its service is active and at least one active provider (with an
 * active account) is subscribed to it, the same rule as `listPublicServices()`.
 * A direct offering without any bookable variant is `unavailable` (temporarily,
 * shown greyed out), which is different from `enquiry` (on purpose).
 */

export const OFFERING_BOOKING_MODES = ['direct', 'enquiry'] as const;
export type OfferingBookingMode = (typeof OFFERING_BOOKING_MODES)[number];

export const OFFERING_VARIANT_MODES = ['single', 'audience'] as const;
export type OfferingVariantMode = (typeof OFFERING_VARIANT_MODES)[number];

export const OFFERING_AUDIENCES = ['all', 'adult', 'youth'] as const;
export type OfferingAudience = (typeof OFFERING_AUDIENCES)[number];

/** Public label of a variant; the single option has none. */
export const AUDIENCE_LABELS: Record<OfferingAudience, string> = {
  all: '',
  adult: 'Volwassene',
  youth: 'Jeugd',
};

/** € 10.000,00: a technical upper bound, not a business rule. */
export const OFFERING_MAX_PRICE_CENTS = 1_000_000;

export type OfferingStatus = 'bookable' | 'unavailable' | 'enquiry';

/** Shown on cards, the offer page and in Beheer. */
export const OFFERING_STATUS_LABELS: Record<OfferingStatus, string> = {
  bookable: 'Online te boeken',
  unavailable: 'Tijdelijk niet online te boeken',
  enquiry: 'Op aanvraag',
};

export function audiencesFor(mode: OfferingVariantMode): OfferingAudience[] {
  return mode === 'audience' ? ['adult', 'youth'] : ['all'];
}

export type OfferingVariant = {
  audience: OfferingAudience;
  serviceId: string | null;
  priceCents: number | null;
};

export type OfferingSettings = {
  isListed: boolean;
  bookingMode: OfferingBookingMode;
  variantMode: OfferingVariantMode;
  /** Exactly the audiences of `variantMode`, in that order. */
  variants: OfferingVariant[];
};

/** `stored` = a `cms_offerings` row; `legacy` = derived from the offer block (no row yet). */
export type OfferingSource = 'stored' | 'legacy';

// ---------------------------------------------------------------------------
// Validation (Beheer → Aanbod)
// ---------------------------------------------------------------------------

const variantSchema = z.object({
  audience: z.enum(OFFERING_AUDIENCES),
  serviceId: z.string().trim().max(64, 'Ongeldige dienst.').nullable().default(null),
  priceCents: z
    .number()
    .int('Geef de prijs in euro, bv. 150 of 149,50.')
    .min(1, 'Een prijs van € 0 kan niet; laat het veld leeg voor “Prijs op aanvraag”.')
    .max(OFFERING_MAX_PRICE_CENTS, 'De prijs is te hoog.')
    .nullable()
    .default(null),
});

export const offeringInputSchema = z
  .object({
    isListed: z.boolean(),
    bookingMode: z.enum(OFFERING_BOOKING_MODES),
    variantMode: z.enum(OFFERING_VARIANT_MODES),
    variants: z.array(variantSchema).max(OFFERING_AUDIENCES.length),
  })
  .superRefine((value, ctx) => {
    const expected = audiencesFor(value.variantMode);
    const given = value.variants.map((variant) => variant.audience);
    if (given.length !== expected.length || expected.some((audience, i) => given[i] !== audience)) {
      ctx.addIssue({
        code: 'custom',
        message: 'De varianten passen niet bij de gekozen opdeling.',
      });
      return;
    }
    if (value.bookingMode === 'direct') {
      for (const variant of value.variants) {
        if (!variant.serviceId) {
          const which = AUDIENCE_LABELS[variant.audience];
          ctx.addIssue({
            code: 'custom',
            message: which
              ? `Kies voor ${which} de dienst waarmee het online geboekt wordt.`
              : 'Kies de dienst waarmee dit aanbod online geboekt wordt.',
          });
        }
      }
    }
    const services = value.variants
      .map((variant) => variant.serviceId)
      .filter((id): id is string => Boolean(id));
    if (new Set(services).size !== services.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'Volwassene en Jeugd hebben elk een eigen dienst nodig (eigen duur en formulier).',
      });
    }
  });

export type OfferingInput = z.input<typeof offeringInputSchema>;

export function validateOfferingInput(
  raw: unknown,
): { ok: true; data: OfferingSettings } | { ok: false; message: string } {
  const parsed = offeringInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: [...new Set(parsed.error.issues.map((i) => i.message))].join(' '),
    };
  }
  const data = parsed.data;
  return {
    ok: true,
    data: {
      isListed: data.isListed,
      bookingMode: data.bookingMode,
      variantMode: data.variantMode,
      variants: data.variants.map((variant) => ({
        audience: variant.audience,
        serviceId: variant.serviceId || null,
        priceCents: variant.priceCents,
      })),
    },
  };
}

/**
 * Settings from stored rows. Defensive: an unknown mode reads as the safe
 * default (`enquiry`, `single`), a missing variant row as "no service, no
 * price", and rows of audiences the mode does not use are ignored (they stay
 * in the table until the next save rewrites the variants).
 */
export function settingsFromRows(
  row: { isListed: boolean; bookingMode: string; variantMode: string },
  variantRows: ReadonlyArray<{
    audience: string;
    serviceId: string | null;
    priceCents: number | null;
  }>,
): OfferingSettings {
  const bookingMode: OfferingBookingMode = row.bookingMode === 'direct' ? 'direct' : 'enquiry';
  const variantMode: OfferingVariantMode = row.variantMode === 'audience' ? 'audience' : 'single';
  return {
    isListed: row.isListed,
    bookingMode,
    variantMode,
    variants: audiencesFor(variantMode).map((audience) => {
      const found = variantRows.find((entry) => entry.audience === audience);
      const price = found?.priceCents ?? null;
      return {
        audience,
        serviceId: found?.serviceId ?? null,
        priceCents: price != null && price >= 1 ? price : null,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// The service facts an offering needs (`cms_services`, any provider count)
// ---------------------------------------------------------------------------

export type OfferingServiceInfo = {
  id: string;
  slug: string;
  name: string;
  choiceLabel: string;
  durationMinutes: number;
  isActive: boolean;
  requiresGuardian: boolean;
  priceCents: number | null;
  showPrice: boolean;
};

// ---------------------------------------------------------------------------
// Resolution: settings + services + who offers what → what the public sees
// ---------------------------------------------------------------------------

export type ResolvedVariant = {
  audience: OfferingAudience;
  /** "Volwassene", "Jeugd"; '' for the single option. */
  label: string;
  serviceId: string | null;
  serviceSlug: string | null;
  serviceName: string | null;
  /** From the active service; `null` without one. */
  durationMinutes: number | null;
  requiresGuardian: boolean;
  priceCents: number | null;
  /** Direct mode, active service, ≥ 1 active provider subscribed. */
  bookable: boolean;
};

export type ResolvedOffering = {
  source: OfferingSource;
  isListed: boolean;
  bookingMode: OfferingBookingMode;
  variantMode: OfferingVariantMode;
  status: OfferingStatus;
  variants: ResolvedVariant[];
};

export function resolveOffering(input: {
  settings: OfferingSettings;
  source: OfferingSource;
  services: readonly OfferingServiceInfo[];
  /** Services that are public on `/afspraak` (active, offered by an active provider). */
  bookableServiceIds: ReadonlySet<string>;
}): ResolvedOffering {
  const { settings } = input;
  const direct = settings.bookingMode === 'direct';
  const variants: ResolvedVariant[] = settings.variants.map((variant) => {
    const service = variant.serviceId
      ? (input.services.find((entry) => entry.id === variant.serviceId) ?? null)
      : null;
    const active = Boolean(service?.isActive);
    return {
      audience: variant.audience,
      label: AUDIENCE_LABELS[variant.audience],
      serviceId: variant.serviceId,
      serviceSlug: service?.slug ?? null,
      serviceName: service?.name ?? null,
      durationMinutes: active && service ? service.durationMinutes : null,
      requiresGuardian: Boolean(service?.requiresGuardian),
      priceCents: variant.priceCents,
      bookable: direct && active && Boolean(service) && input.bookableServiceIds.has(service!.id),
    };
  });
  const status: OfferingStatus = !direct
    ? 'enquiry'
    : variants.some((variant) => variant.bookable)
      ? 'bookable'
      : 'unavailable';
  return {
    source: input.source,
    isListed: settings.isListed,
    bookingMode: settings.bookingMode,
    variantMode: settings.variantMode,
    status,
    variants,
  };
}

/** One variant's price: "€ 150,00" or "Prijs op aanvraag". */
export function variantPriceLabel(variant: Pick<ResolvedVariant, 'priceCents'>): string {
  return variant.priceCents != null ? formatPrice(variant.priceCents) : OFFER_PRICE_FALLBACK;
}

/**
 * The offering's Kostprijs line: "Prijs op aanvraag" while no variant has a
 * price; one amount for a single option; per variant otherwise
 * ("Volwassene € 150,00 · Jeugd op aanvraag"). Never an invented amount.
 */
export function offeringPriceLabel(offering: Pick<ResolvedOffering, 'variants'>): string {
  const { variants } = offering;
  if (!variants.some((variant) => variant.priceCents != null)) return OFFER_PRICE_FALLBACK;
  if (variants.length === 1) return variantPriceLabel(variants[0]);
  return variants
    .map(
      (variant) =>
        `${variant.label} ${variant.priceCents != null ? formatPrice(variant.priceCents) : 'op aanvraag'}`,
    )
    .join(' · ');
}

/**
 * The offering's Duur line. Direct: from the variants' active services
 * ("Volwassene: 1 u 30 min · Jeugd: 1 uur"), never the editorial text.
 * Enquiry: the editorial text on the offer page (else "Duur in overleg").
 */
export function offeringDurationLabel(
  offering: Pick<ResolvedOffering, 'bookingMode' | 'variants'>,
  editorialDuration: string,
): string {
  if (offering.bookingMode === 'enquiry') return offerDurationLabel(editorialDuration);
  const parts = offering.variants
    .filter((variant) => variant.durationMinutes != null)
    .map((variant) =>
      variant.label
        ? `${variant.label}: ${formatDuration(variant.durationMinutes!)}`
        : formatDuration(variant.durationMinutes!),
    );
  return parts.length ? parts.join(' · ') : OFFER_DURATION_FALLBACK;
}

/**
 * The booking-service slugs `/afspraak` may use for this offering, in variant
 * order: only bookable variants of a listed, bookable offering. Empty for an
 * enquiry, unavailable or hidden offering, so the booking page never offers
 * another service in its place.
 */
export function offeringBookingSlugs(
  offering: Pick<ResolvedOffering, 'isListed' | 'status' | 'variants'>,
): string[] {
  if (!offering.isListed || offering.status !== 'bookable') return [];
  return offering.variants
    .filter((variant) => variant.bookable && variant.serviceSlug)
    .map((variant) => variant.serviceSlug!);
}

/**
 * Services an offering holds back from `/afspraak`: a service that is a
 * variant of some offering is booked through an offering only — when none of
 * the offerings that use it is shown on the website (published and listed)
 * and booked directly, the widget does not offer it on its own either, and
 * the server refuses it. Services no offering uses stay bookable on their own
 * (Gezinspakket, Fit aan huis, Inspanningstest), as before.
 */
export function withheldServiceIds(
  offerings: ReadonlyArray<{
    visible: boolean;
    settings: Pick<OfferingSettings, 'bookingMode' | 'variants'>;
  }>,
): Set<string> {
  const claimed = new Set<string>();
  const offered = new Set<string>();
  for (const offering of offerings) {
    for (const variant of offering.settings.variants) {
      if (!variant.serviceId) continue;
      claimed.add(variant.serviceId);
      if (offering.visible && offering.settings.bookingMode === 'direct') {
        offered.add(variant.serviceId);
      }
    }
  }
  return new Set([...claimed].filter((id) => !offered.has(id)));
}

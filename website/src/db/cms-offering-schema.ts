/**
 * Offering settings ("Aanbod" in Beheer), created by
 * `drizzle/0010_cms_offerings.sql`. Kept apart from `./cms-schema.ts`, which is
 * already past the file-size limit; the same `cms_` prefix and conventions
 * apply, and `drizzle.config.ts` and `./cms.ts` list this file too.
 * Architecture: docs/cms-architecture.md §15 and docs/booking-architecture.md §15.
 *
 * An offering is one offer page (`/aanbod/<slug>`, a `cms_pages` row with an
 * `offer` block). The page keeps the editorial copy (title, intro, Doel,
 * Inhoud, image, category, order); these two tables keep what an editor or
 * admin decides in ONE place in Beheer → Aanbod:
 *
 *  - `cms_offerings`: shown on the website or not, one option or separate
 *    Volwassene/Jeugd variants, booked directly online or asked for through
 *    the enquiry form;
 *  - `cms_offering_variants`: per variant, the booking service it is booked
 *    as (`cms_services`, which owns duration, buffer, guardian rule and
 *    location) and its public price in cents (`null` = "Prijs op aanvraag").
 *
 * Who offers a variant stays `cms_provider_services` (the provider's own
 * subscription to the variant's service). Bookings keep referencing
 * `cms_services` by id; nothing here touches `cms_bookings`.
 *
 * Closed sets (`booking_mode`, `variant_mode`, `audience`) are `text`,
 * validated by zod in `src/lib/offers/offering.ts`, like every other closed
 * set in the CMS except `cms_role`.
 */
import {
  integer,
  boolean,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { cmsPages, cmsServices, cmsUsers } from './cms-schema';

export const cmsOfferings = pgTable(
  'cms_offerings',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    /** The offer page; one offering per page. Deleting the page removes its settings. */
    pageId: text('page_id')
      .notNull()
      .references(() => cmsPages.id, { onDelete: 'cascade' }),
    /** "Tonen op de website": listed in the overviews and its page served. */
    isListed: boolean('is_listed').default(true).notNull(),
    /** `direct` (online booking) | `enquiry` (the enquiry form on the offer page). */
    bookingMode: text('booking_mode').default('enquiry').notNull(),
    /** `single` (one option) | `audience` (Volwassene and Jeugd apart). */
    variantMode: text('variant_mode').default('single').notNull(),
    updatedBy: text('updated_by').references(() => cmsUsers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('cms_offerings_page_id_key').on(t.pageId)],
);

export const cmsOfferingVariants = pgTable(
  'cms_offering_variants',
  {
    offeringId: text('offering_id')
      .notNull()
      .references(() => cmsOfferings.id, { onDelete: 'cascade' }),
    /** `all` (single option) | `adult` (Volwassene) | `youth` (Jeugd). */
    audience: text('audience').notNull(),
    /** The booking service this variant is booked as; `null` = none (enquiry only). */
    serviceId: text('service_id').references(() => cmsServices.id, { onDelete: 'set null' }),
    /** Public price in euro cents; `null` = "Prijs op aanvraag". Never 0. */
    priceCents: integer('price_cents'),
  },
  (t) => [
    primaryKey({ columns: [t.offeringId, t.audience] }),
    index('cms_offering_variants_service_idx').on(t.serviceId),
  ],
);

export type CmsOffering = typeof cmsOfferings.$inferSelect;
export type CmsOfferingVariant = typeof cmsOfferingVariants.$inferSelect;

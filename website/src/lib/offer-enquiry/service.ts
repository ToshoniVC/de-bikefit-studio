import 'server-only';
import { and, eq, gte } from 'drizzle-orm';
import { getCmsDb, type CmsDatabase } from '@/db/cms';
import { cmsRateLimits } from '@/db/cms-rate-limit-schema';
import { DEFAULT_LOCALE } from '@/db/cms-schema';
import { getSiteSettings } from '@/lib/cms/content';
import { loadOfferCatalogue } from '@/lib/cms/offers-content';
import { sendEmail } from '@/lib/email/send';
import { loadEmailSettings } from '@/lib/email/settings';
import { reserveRateLimit } from '@/lib/rate-limit';
import { absoluteUrl } from '@/lib/studio/site';
import {
  deliverOfferEnquiry,
  OFFER_ENQUIRY_DUPLICATE_WINDOW_MS,
  type EnquiryOffer,
  type OfferEnquiryResult,
  type OfferEnquiryStore,
} from './delivery';
import { enquirySentScope, offerEnquiryRateLimitScopes } from './rate-limit-policy';

/**
 * The real wiring behind "Verstuur je aanvraag" (`actions.ts` → here →
 * `delivery.ts`):
 *
 *  - the offer: from the published catalogue (`loadOfferCatalogue`); only a
 *    page that is shown on the website and set to "Enkel aanvraag" in Beheer →
 *    Aanbod accepts an enquiry, so the form cannot be pointed at any other page;
 *  - recipient: the studio's order inbox from the existing e-mail settings —
 *    env `GIFT_VOUCHER_RECIPIENT`, else Beheer → E-mail → *Ontvanger
 *    bestellingen en aanvragen* (`loadEmailSettings().recipient`, see
 *    `src/lib/gift-voucher/recipient.ts` for why it is never the public
 *    `contact.email`); empty = nothing is sent and the visitor is told so;
 *  - sender: the configured sender through Resend (`sendEmail()`); the
 *    visitor's address is only the Reply-To;
 *  - rate limit and duplicate marker: the race-free reservation on
 *    `cms_rate_limits` (`src/lib/rate-limit.ts`), keys `aanvraag:…`
 *    (`rate-limit-policy.ts`); no address is stored, rows age out after a day.
 *    No enquiry table: the enquiry itself lives only in the studio's mailbox.
 */

export function offerEnquiryStore(db: CmsDatabase): OfferEnquiryStore {
  return {
    async wasSent(requestId) {
      const since = new Date(Date.now() - OFFER_ENQUIRY_DUPLICATE_WINDOW_MS);
      const rows = await db
        .select({ scope: cmsRateLimits.scope })
        .from(cmsRateLimits)
        .where(
          and(
            eq(cmsRateLimits.scope, enquirySentScope(requestId).key),
            gte(cmsRateLimits.updatedAt, since),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },
    async reserve(email, ip) {
      const reserved = await reserveRateLimit(db, offerEnquiryRateLimitScopes({ email, ip }));
      return reserved.ok;
    },
    async markSent(requestId) {
      await reserveRateLimit(db, [enquirySentScope(requestId)]);
    },
  };
}

/** The offer an enquiry may name: shown, an `offer` page, and asked for (not booked online). */
export async function findEnquiryOffer(
  slug: string,
  locale: string = DEFAULT_LOCALE,
): Promise<EnquiryOffer | null> {
  if (!slug) return null;
  const catalogue = await loadOfferCatalogue(locale);
  const offer = catalogue.offers.find(
    (entry) => entry.slug === slug && entry.kind === 'service' && entry.status === 'enquiry',
  );
  if (!offer) return null;
  const audiences = offer.variants
    .map((variant) => variant.audience)
    .filter((audience): audience is 'adult' | 'youth' => audience !== 'all');
  return { title: offer.title, url: absoluteUrl(offer.path), audiences };
}

export async function requestOfferEnquiry(
  raw: unknown,
  context: { ipAddress: string | null; locale?: string },
): Promise<OfferEnquiryResult> {
  const locale = context.locale ?? DEFAULT_LOCALE;
  const settings = await getSiteSettings(locale);
  const db = await getCmsDb();
  const email = await loadEmailSettings(db);
  return deliverOfferEnquiry(raw, {
    store: offerEnquiryStore(db),
    findOffer: (slug) => findEnquiryOffer(slug, locale),
    send: (mail) => sendEmail(mail, email),
    recipient: email.recipient.address,
    siteName: settings.site.name || 'De Bikefit Studio',
    ipAddress: context.ipAddress,
    log: (message) => console.warn(message),
  });
}

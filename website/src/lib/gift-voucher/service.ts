import 'server-only';
import { createHash } from 'node:crypto';
import { and, eq, gte, sql } from 'drizzle-orm';
import { getCmsDb, type CmsDatabase } from '@/db/cms';
import { cmsBookingRateLimit, DEFAULT_LOCALE } from '@/db/cms-schema';
import { getSiteSettings } from '@/lib/cms/content';
import { sendEmail } from '@/lib/email/send';
import { deliverGiftVoucherOrder, type GiftVoucherResult, type GiftVoucherStore } from './delivery';

/**
 * The real wiring behind "Bestel nu" (`actions.ts` → here → `delivery.ts`):
 *
 *  - recipient: Instellingen → Contact → e-mail (`contact.email`), the
 *    studio's public address; empty = not configured, nothing is sent;
 *  - sender: `EMAIL_FROM` through Resend (`src/lib/email/send.ts`), never the
 *    visitor's address; the visitor's address is only the Reply-To;
 *  - rate limit and duplicate protection: rows in `cms_booking_rate_limit`
 *    with keys namespaced `cadeaubon:` / `cadeaubon-sent:`, so they never
 *    match a booking attempt (bookings key on the plain e-mail and IP). The
 *    e-mail address is stored only as a truncated SHA-256; rows are pruned
 *    after a day, like booking attempts. No migration, no order table: the
 *    order itself lives only in the studio's mailbox.
 */

const KEY = 'cadeaubon:';
const SENT_KEY = 'cadeaubon-sent:';
const SENT_IP = 'cadeaubon';

function emailKey(email: string): string {
  return `${KEY}${createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 32)}`;
}

function ipKey(ip: string): string {
  return `${KEY}${ip}`;
}

export function giftVoucherStore(db: CmsDatabase): GiftVoucherStore {
  return {
    async wasSent(requestId, since) {
      const rows = await db
        .select({ id: cmsBookingRateLimit.id })
        .from(cmsBookingRateLimit)
        .where(
          and(
            eq(cmsBookingRateLimit.email, `${SENT_KEY}${requestId}`),
            gte(cmsBookingRateLimit.attemptedAt, since),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },
    async countAttempts(email, ip, since) {
      // An unknown IP is never used as a key — it would lump every visitor together.
      const who = ip
        ? sql`(${cmsBookingRateLimit.email} = ${emailKey(email)} OR ${cmsBookingRateLimit.ipAddress} = ${ipKey(ip)})`
        : sql`${cmsBookingRateLimit.email} = ${emailKey(email)}`;
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(cmsBookingRateLimit)
        .where(and(gte(cmsBookingRateLimit.attemptedAt, since), who));
      return Number(rows[0]?.count ?? 0);
    },
    async recordAttempt(email, ip) {
      await db
        .insert(cmsBookingRateLimit)
        .values({ email: emailKey(email), ipAddress: ip ? ipKey(ip) : 'unknown' });
      await db
        .delete(cmsBookingRateLimit)
        .where(sql`${cmsBookingRateLimit.attemptedAt} < now() - interval '1 day'`);
    },
    async markSent(requestId) {
      await db
        .insert(cmsBookingRateLimit)
        .values({ email: `${SENT_KEY}${requestId}`, ipAddress: SENT_IP });
    },
  };
}

export async function requestGiftVoucher(
  raw: unknown,
  context: { ipAddress: string | null; locale?: string },
): Promise<GiftVoucherResult> {
  const settings = await getSiteSettings(context.locale ?? DEFAULT_LOCALE);
  return deliverGiftVoucherOrder(raw, {
    store: giftVoucherStore(await getCmsDb()),
    send: (mail) => sendEmail(mail),
    recipient: settings.contact.email,
    siteName: settings.site.name || 'De Bikefit Studio',
    ipAddress: context.ipAddress,
    log: (message) => console.warn(message),
  });
}

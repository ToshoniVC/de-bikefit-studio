'use server';

import { headers } from 'next/headers';
import { DEFAULT_LOCALE } from '@/db/cms-schema';
import { clientIpFromHeaders } from '@/lib/request-ip';
import type { GiftVoucherResult } from './delivery';
import { GIFT_VOUCHER_MESSAGES } from './order';
import { requestGiftVoucher } from './service';

/**
 * Server action behind the "Bestel nu" button on `/cadeaubon`.
 *
 * Public-endpoint hygiene only: the argument is untrusted (validated in
 * `delivery.ts`), the client IP comes from the request headers, and the
 * result is a plain object without contact data. Next's server actions carry
 * their own Origin/Host check, which keeps this from being posted cross-site.
 */
export async function orderGiftVoucherAction(input: unknown): Promise<GiftVoucherResult> {
  try {
    const ipAddress = clientIpFromHeaders(await headers());
    return await requestGiftVoucher(input, { ipAddress, locale: DEFAULT_LOCALE });
  } catch {
    // A fixed code, never the error or its name: a failed query's message holds its bound
    // values, here the client IP of the rate-limit row.
    console.error('[cadeaubon] order_action_failed');
    return { ok: false, code: 'error', message: GIFT_VOUCHER_MESSAGES.notSent, fieldErrors: {} };
  }
}

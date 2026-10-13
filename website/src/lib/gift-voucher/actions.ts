'use server';

import { headers } from 'next/headers';
import { DEFAULT_LOCALE } from '@/db/cms-schema';
import { clientIpFromHeaders } from '@/lib/request-ip';
import type { GiftVoucherResult } from './delivery';
import { GIFT_VOUCHER_MESSAGES } from './order';
import { requestGiftVoucher } from './service';

/**
 * Server action behind the "Bestel nu" button on `/aanbod/cadeaubon`.
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
  } catch (error) {
    console.error(
      '[cadeaubon] orderGiftVoucherAction failed',
      error instanceof Error ? error.name : '',
    );
    return { ok: false, code: 'error', message: GIFT_VOUCHER_MESSAGES.notSent, fieldErrors: {} };
  }
}

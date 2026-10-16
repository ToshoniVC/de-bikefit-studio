'use server';

import { headers } from 'next/headers';
import { DEFAULT_LOCALE } from '@/db/cms-schema';
import { clientIpFromHeaders } from '@/lib/request-ip';
import type { OfferEnquiryResult } from './delivery';
import { OFFER_ENQUIRY_MESSAGES } from './input';
import { requestOfferEnquiry } from './service';

/**
 * Server action behind "Verstuur je aanvraag" on an offer page that is asked
 * for rather than booked online.
 *
 * Public-endpoint hygiene: the argument is untrusted (validated in
 * `delivery.ts`, which also checks the offer server-side), the client IP comes
 * from the request headers, and the result is a plain object without contact
 * data. Next's server actions carry their own Origin/Host check.
 */
export async function sendOfferEnquiryAction(input: unknown): Promise<OfferEnquiryResult> {
  try {
    const ipAddress = clientIpFromHeaders(await headers());
    return await requestOfferEnquiry(input, { ipAddress, locale: DEFAULT_LOCALE });
  } catch {
    // A fixed code, never the error: a failed query's message holds its bound
    // values, here the client IP of the rate-limit row.
    console.error('[aanvraag] enquiry_action_failed');
    return { ok: false, code: 'error', message: OFFER_ENQUIRY_MESSAGES.notSent, fieldErrors: {} };
  }
}

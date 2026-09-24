import 'server-only';
import { eq } from 'drizzle-orm';
import { getCmsDb } from '@/db/cms';
import {
  cmsBookings,
  cmsLocations,
  cmsProviders,
  cmsServices,
  type CmsBooking,
  type CmsGoogleSyncStatus,
  type CmsProvider,
} from '@/db/cms-schema';
import { siteUrl } from '@/lib/env';
import {
  decryptSecret,
  deleteEvent,
  encryptSecret,
  getFreeBusy,
  GoogleApiError,
  insertEvent,
  isGoogleConfigured,
  refreshAccessToken,
  type GoogleBusyInterval,
} from './google';
import { formatLocation } from './format';

/**
 * A provider's Google Calendar, from the booking engine's point of view.
 *
 * Never throws for Google problems: a missing connection or a failing Google
 * call degrades to "no busy time" / "not synced", and the reason is written to
 * `cms_providers.google_sync_error` (shown on the admin's Google card) or to
 * `cms_bookings.google_sync_error`.
 */

/** Refresh the access token when it expires within this window. */
const ACCESS_TOKEN_MARGIN_MS = 60_000;

export type GoogleSyncResult = {
  status: CmsGoogleSyncStatus;
  eventId: string | null;
  error: string | null;
};

export function isProviderConnected(provider: Pick<CmsProvider, 'googleRefreshTokenEnc'>): boolean {
  return Boolean(provider.googleRefreshTokenEnc);
}

async function recordProviderError(providerId: string, message: string | null): Promise<void> {
  const db = await getCmsDb();
  await db
    .update(cmsProviders)
    .set({ googleSyncError: message, updatedAt: new Date() })
    .where(eq(cmsProviders.id, providerId));
}

function describe(error: unknown): string {
  if (error instanceof GoogleApiError) {
    if (error.code === 'invalid_grant') {
      return 'Google-toegang is ingetrokken of verlopen. Verbind Google Agenda opnieuw.';
    }
    return error.message;
  }
  return error instanceof Error ? error.message : 'Onbekende fout bij Google.';
}

/**
 * A valid access token for the provider, refreshing (and storing) it when
 * needed. `null` when not connected or when Google refuses — the reason is
 * recorded on the provider.
 */
export async function getProviderAccessToken(provider: CmsProvider): Promise<string | null> {
  if (!isProviderConnected(provider)) return null;
  if (!isGoogleConfigured()) {
    await recordProviderError(provider.id, 'Google Calendar is niet geconfigureerd op de server.');
    return null;
  }

  const expiresAt = provider.googleAccessExpiresAt
    ? new Date(provider.googleAccessExpiresAt).getTime()
    : 0;
  if (provider.googleAccessToken && expiresAt - ACCESS_TOKEN_MARGIN_MS > Date.now()) {
    const cached = decryptSecret(provider.googleAccessToken);
    if (cached) return cached;
  }

  const refreshToken = decryptSecret(provider.googleRefreshTokenEnc);
  if (!refreshToken) {
    await recordProviderError(
      provider.id,
      'De opgeslagen Google-koppeling kan niet meer gelezen worden (sleutel gewijzigd). Verbind Google Agenda opnieuw.',
    );
    return null;
  }

  try {
    const fresh = await refreshAccessToken(refreshToken);
    const db = await getCmsDb();
    await db
      .update(cmsProviders)
      .set({
        googleAccessToken: encryptSecret(fresh.accessToken),
        googleAccessExpiresAt: fresh.expiresAt,
        googleSyncError: null,
        updatedAt: new Date(),
      })
      .where(eq(cmsProviders.id, provider.id));
    return fresh.accessToken;
  } catch (error) {
    await recordProviderError(provider.id, describe(error));
    return null;
  }
}

/**
 * Busy intervals from the provider's Google Calendar in `[timeMin, timeMax)`.
 * `[]` when not connected or when Google fails (error recorded on the provider).
 */
export async function getProviderBusy(
  provider: CmsProvider,
  timeMin: Date | string,
  timeMax: Date | string,
): Promise<GoogleBusyInterval[]> {
  if (!isProviderConnected(provider)) return [];
  const accessToken = await getProviderAccessToken(provider);
  if (!accessToken) return [];
  try {
    const busy = await getFreeBusy({
      accessToken,
      calendarId: provider.googleCalendarId || 'primary',
      timeMin,
      timeMax,
    });
    if (provider.googleSyncError) await recordProviderError(provider.id, null);
    return busy;
  } catch (error) {
    await recordProviderError(provider.id, describe(error));
    return [];
  }
}

async function writeBookingSync(bookingId: string, result: GoogleSyncResult): Promise<void> {
  const db = await getCmsDb();
  await db
    .update(cmsBookings)
    .set({
      googleSyncStatus: result.status,
      googleEventId: result.eventId,
      googleSyncError: result.error,
      updatedAt: new Date(),
    })
    .where(eq(cmsBookings.id, bookingId));
}

/**
 * Creates the Google event for a booking (no attendees) and records the outcome
 * on the booking: `synced` + event id, `failed` + error, or `none` when the
 * provider has no Google connection.
 */
export async function createProviderEvent(
  provider: CmsProvider,
  booking: CmsBooking,
): Promise<GoogleSyncResult> {
  if (!isProviderConnected(provider)) {
    const result: GoogleSyncResult = { status: 'none', eventId: null, error: null };
    await writeBookingSync(booking.id, result);
    return result;
  }

  const accessToken = await getProviderAccessToken(provider);
  if (!accessToken) {
    const db = await getCmsDb();
    const [fresh] = await db
      .select({ error: cmsProviders.googleSyncError })
      .from(cmsProviders)
      .where(eq(cmsProviders.id, provider.id))
      .limit(1);
    const result: GoogleSyncResult = {
      status: 'failed',
      eventId: null,
      error: fresh?.error ?? 'Geen geldige Google-toegang.',
    };
    await writeBookingSync(booking.id, result);
    return result;
  }

  const db = await getCmsDb();
  const [service] = await db
    .select({ name: cmsServices.name })
    .from(cmsServices)
    .where(eq(cmsServices.id, booking.serviceId))
    .limit(1);
  const [location] = booking.locationId
    ? await db.select().from(cmsLocations).where(eq(cmsLocations.id, booking.locationId)).limit(1)
    : [];

  const where =
    location?.kind === 'customer'
      ? (booking.customerAddress ?? '')
      : location
        ? formatLocation(location).singleLine
        : '';

  const lines = [
    `Klant: ${booking.customerName}`,
    `E-mail: ${booking.customerEmail}`,
    booking.customerPhone ? `Telefoon: ${booking.customerPhone}` : '',
    booking.customerAge != null ? `Leeftijd: ${booking.customerAge}` : '',
    booking.guardianName ? `Ouder/voogd: ${booking.guardianName}` : '',
    booking.guardianPhone ? `Telefoon ouder/voogd: ${booking.guardianPhone}` : '',
    booking.bikeDetails ? `Fiets: ${booking.bikeDetails}` : '',
    booking.notes ? `Opmerkingen: ${booking.notes}` : '',
  ].filter(Boolean);
  lines.push('', `Beheer: ${siteUrl()}/admin/bookings`);

  try {
    const event = await insertEvent({
      accessToken,
      calendarId: provider.googleCalendarId || 'primary',
      event: {
        summary: `${service?.name ?? 'Afspraak'} — ${booking.customerName}`,
        description: lines.join('\n'),
        location: where || undefined,
        start: new Date(booking.startsAt).toISOString(),
        end: new Date(booking.endsAt).toISOString(),
        timeZone: booking.timezone,
        privateProperties: { bookingId: booking.id },
      },
    });
    const result: GoogleSyncResult = { status: 'synced', eventId: event.id, error: null };
    await writeBookingSync(booking.id, result);
    return result;
  } catch (error) {
    const result: GoogleSyncResult = { status: 'failed', eventId: null, error: describe(error) };
    await writeBookingSync(booking.id, result);
    return result;
  }
}

/**
 * Removes the booking's Google event, if it has one. Records `synced` on
 * success and `failed` + error otherwise; bookings without an event are left
 * as they are.
 */
export async function cancelProviderEvent(
  provider: CmsProvider,
  booking: CmsBooking,
): Promise<GoogleSyncResult> {
  if (!booking.googleEventId) {
    return { status: booking.googleSyncStatus, eventId: null, error: booking.googleSyncError };
  }
  const accessToken = await getProviderAccessToken(provider);
  if (!accessToken) {
    const result: GoogleSyncResult = {
      status: 'failed',
      eventId: booking.googleEventId,
      error: 'Het Google-agendapunt kon niet verwijderd worden: geen geldige Google-toegang.',
    };
    await writeBookingSync(booking.id, result);
    return result;
  }
  try {
    await deleteEvent({
      accessToken,
      calendarId: provider.googleCalendarId || 'primary',
      eventId: booking.googleEventId,
    });
    const result: GoogleSyncResult = {
      status: 'synced',
      eventId: booking.googleEventId,
      error: null,
    };
    await writeBookingSync(booking.id, result);
    return result;
  } catch (error) {
    const result: GoogleSyncResult = {
      status: 'failed',
      eventId: booking.googleEventId,
      error: describe(error),
    };
    await writeBookingSync(booking.id, result);
    return result;
  }
}

import 'server-only';

import { JWT } from 'google-auth-library';
import { unstable_cache } from 'next/cache';

import { getSiteSettings } from '@/lib/cms/content';
import { env, features } from '@/lib/env';

/**
 * GA4 Data API reader for the admin dashboard (`AnalyticsPanel`).
 *
 * - Credentials: a service account whose key JSON is in
 *   `GA4_SERVICE_ACCOUNT_JSON` (raw JSON or base64 of it) and which has
 *   Viewer access on the GA4 property. Signed into a short-lived access token
 *   with `google-auth-library`'s `JWT` client, scope `analytics.readonly`.
 * - Property: `GA4_PROPERTY_ID` (env) wins, else the `analytics.ga4PropertyId`
 *   site setting. Numeric id; a `properties/` prefix is tolerated.
 * - Data: three `runReport` calls over the last 28 full days (Brussels
 *   calendar): totals, top 10 pages, top 5 session sources.
 * - Cached for an hour with `unstable_cache`, tag {@link ANALYTICS_CACHE_TAG};
 *   failures are not cached, so fixing the configuration shows up at once.
 *
 * Never throws: every failure comes back as `{ connected: false, reason }`
 * with a Dutch message that is safe to show to an admin.
 */

export const ANALYTICS_CACHE_TAG = 'analytics';

const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const API = 'https://analyticsdata.googleapis.com/v1beta';
const CACHE_SECONDS = 3600;
const RANGE_DAYS = 28;
const REQUEST_TIMEOUT_MS = 10_000;
const TIMEZONE = 'Europe/Brussels';

export type AnalyticsOverview =
  | {
      connected: true;
      propertyId: string;
      /** Inclusive calendar dates, `YYYY-MM-DD`. */
      range: { start: string; end: string };
      totals: { activeUsers: number; sessions: number; screenPageViews: number };
      topPages: Array<{ path: string; views: number }>;
      topSources: Array<{ source: string; sessions: number }>;
      /** ISO instant the numbers were fetched from Google (cache age). */
      fetchedAt: string;
    }
  | {
      connected: false;
      reason: 'missing_property' | 'missing_credentials' | 'error';
      message: string;
    };

export type AnalyticsNotConnected = Extract<AnalyticsOverview, { connected: false }>;

type ServiceAccount = { clientEmail: string; privateKey: string; privateKeyId?: string };

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Accepts the key file as raw JSON or base64; null when absent or unusable. */
export function parseServiceAccountJson(raw: string | undefined | null): ServiceAccount | null {
  const value = raw?.trim();
  if (!value) return null;

  let text = value;
  if (!value.startsWith('{')) {
    try {
      text = Buffer.from(value, 'base64').toString('utf8').trim();
    } catch {
      return null;
    }
  }

  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    const clientEmail = typeof json.client_email === 'string' ? json.client_email : '';
    // Env editors sometimes turn the key's newlines into literal "\n".
    const privateKey =
      typeof json.private_key === 'string' ? json.private_key.replace(/\\n/g, '\n') : '';
    if (!clientEmail || !privateKey.includes('PRIVATE KEY')) return null;
    return {
      clientEmail,
      privateKey,
      privateKeyId: typeof json.private_key_id === 'string' ? json.private_key_id : undefined,
    };
  } catch {
    return null;
  }
}

/** `properties/123456789` or `123456789` → `123456789`; anything else → null. */
export function normalizePropertyId(value: string | undefined | null): string | null {
  const id = (value ?? '').trim().replace(/^properties\//, '');
  return /^\d{4,20}$/.test(id) ? id : null;
}

async function resolvePropertyId(): Promise<{ id: string | null; raw: string }> {
  const fromEnv = env.GA4_PROPERTY_ID?.trim() ?? '';
  if (fromEnv) return { id: normalizePropertyId(fromEnv), raw: fromEnv };
  const settings = await getSiteSettings();
  const fromSetting = settings.analytics.ga4PropertyId?.trim() ?? '';
  return { id: normalizePropertyId(fromSetting), raw: fromSetting };
}

// ---------------------------------------------------------------------------
// Dates (Brussels calendar)
// ---------------------------------------------------------------------------

function brusselsToday(now = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function addDays(ymd: string, days: number): string {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The last 28 complete days: yesterday and the 27 days before it. */
export function lastFullDays(days = RANGE_DAYS, now = new Date()): { start: string; end: string } {
  const today = brusselsToday(now);
  return { start: addDays(today, -days), end: addDays(today, -1) };
}

// ---------------------------------------------------------------------------
// Data API
// ---------------------------------------------------------------------------

type RunReportResponse = {
  rows?: Array<{
    dimensionValues?: Array<{ value?: string }>;
    metricValues?: Array<{ value?: string }>;
  }>;
};

class Ga4ApiError extends Error {
  constructor(
    readonly status: number,
    readonly googleStatus: string,
    message: string,
  ) {
    super(message);
    this.name = 'Ga4ApiError';
  }
}

async function runReport(
  accessToken: string,
  propertyId: string,
  body: Record<string, unknown>,
): Promise<RunReportResponse> {
  const response = await fetch(`${API}/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    let googleStatus = '';
    let message = response.statusText;
    try {
      const payload = (await response.json()) as { error?: { status?: string; message?: string } };
      googleStatus = payload.error?.status ?? '';
      message = payload.error?.message ?? message;
    } catch {
      // Non-JSON error body: keep the status text.
    }
    throw new Ga4ApiError(response.status, googleStatus, message);
  }

  return (await response.json()) as RunReportResponse;
}

function metric(
  row: NonNullable<RunReportResponse['rows']>[number] | undefined,
  index: number,
): number {
  const value = Number(row?.metricValues?.[index]?.value ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function dimension(row: NonNullable<RunReportResponse['rows']>[number], index: number): string {
  return row.dimensionValues?.[index]?.value ?? '';
}

async function fetchOverview(
  propertyId: string,
  account: ServiceAccount,
): Promise<Extract<AnalyticsOverview, { connected: true }>> {
  const client = new JWT({
    email: account.clientEmail,
    key: account.privateKey,
    keyId: account.privateKeyId,
    scopes: [SCOPE],
  });
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('Geen toegangstoken ontvangen van Google.');

  const range = lastFullDays();
  const dateRanges = [{ startDate: range.start, endDate: range.end }];

  const [totals, pages, sources] = await Promise.all([
    runReport(token, propertyId, {
      dateRanges,
      metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }],
    }),
    runReport(token, propertyId, {
      dateRanges,
      dimensions: [{ name: 'pagePath' }],
      metrics: [{ name: 'screenPageViews' }],
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      limit: 10,
    }),
    runReport(token, propertyId, {
      dateRanges,
      dimensions: [{ name: 'sessionSource' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 5,
    }),
  ]);

  const totalsRow = totals.rows?.[0];

  return {
    connected: true,
    propertyId,
    range,
    totals: {
      activeUsers: metric(totalsRow, 0),
      sessions: metric(totalsRow, 1),
      screenPageViews: metric(totalsRow, 2),
    },
    topPages: (pages.rows ?? []).map((row) => ({ path: dimension(row, 0), views: metric(row, 0) })),
    topSources: (sources.rows ?? []).map((row) => ({
      source: dimension(row, 0),
      sessions: metric(row, 0),
    })),
    fetchedAt: new Date().toISOString(),
  };
}

function describeError(error: unknown, account: ServiceAccount, propertyId: string): string {
  if (error instanceof Ga4ApiError) {
    const text = error.message.toLowerCase();
    if (error.googleStatus === 'PERMISSION_DENIED' || error.status === 403) {
      if (
        text.includes('has not been used') ||
        text.includes('disabled') ||
        text.includes('service_disabled')
      ) {
        return 'De Google Analytics Data API staat niet aan in het Google Cloud-project van het serviceaccount. Schakel ze in en probeer over enkele minuten opnieuw.';
      }
      return `Het serviceaccount ${account.clientEmail} heeft geen toegang tot property ${propertyId}. Voeg het in GA4 toe als Kijker (Viewer).`;
    }
    if (error.status === 400 || error.status === 404) {
      return `Google Analytics kent property ${propertyId} niet. Controleer de property-ID (een getal, geen G-…-meet-ID).`;
    }
    if (error.status === 401) {
      return 'Google weigerde het toegangstoken van het serviceaccount. Maak een nieuwe sleutel aan en werk GA4_SERVICE_ACCOUNT_JSON bij.';
    }
    return `Google Analytics gaf een fout (${error.status}): ${error.message}`.slice(0, 300);
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/invalid_grant|invalid_client|account not found|no key/i.test(message)) {
    return 'De sleutel van het serviceaccount werd geweigerd (verwijderd of verlopen?). Maak een nieuwe JSON-sleutel aan en werk GA4_SERVICE_ACCOUNT_JSON bij.';
  }
  if (/timeout|aborted/i.test(message)) {
    return 'Google Analytics antwoordde niet op tijd. Probeer het later opnieuw.';
  }
  return `Google Analytics kon niet worden gelezen: ${message}`.slice(0, 300);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Users, sessions and page views for the last 28 days plus the top 10 pages
 * and top 5 sources. Cached for an hour (tag `analytics`). Never throws.
 */
export async function getAnalyticsOverview(): Promise<AnalyticsOverview> {
  const account = features.ga4Data ? parseServiceAccountJson(env.GA4_SERVICE_ACCOUNT_JSON) : null;

  let property: { id: string | null; raw: string };
  try {
    property = await resolvePropertyId();
  } catch {
    property = { id: null, raw: '' };
  }

  if (!property.id) {
    return {
      connected: false,
      reason: 'missing_property',
      message: property.raw
        ? `“${property.raw}” is geen geldige GA4-property-ID. Gebruik het getal uit GA4 → Beheer → Property-details.`
        : 'Er is nog geen GA4-property-ID ingesteld.',
    };
  }

  if (!account) {
    return {
      connected: false,
      reason: 'missing_credentials',
      message: env.GA4_SERVICE_ACCOUNT_JSON?.trim()
        ? 'GA4_SERVICE_ACCOUNT_JSON is geen geldige sleutel van een serviceaccount (JSON of base64 van de JSON).'
        : 'GA4_SERVICE_ACCOUNT_JSON ontbreekt: er is geen serviceaccount om Google Analytics mee te lezen.',
    };
  }

  const propertyId = property.id;
  const range = lastFullDays();

  try {
    const load = unstable_cache(
      () => fetchOverview(propertyId, account),
      // The end date rolls the cache over at Brussels midnight; the account
      // e-mail makes a swapped service account take effect immediately.
      ['analytics-overview', propertyId, range.end, account.clientEmail],
      { revalidate: CACHE_SECONDS, tags: [ANALYTICS_CACHE_TAG] },
    );
    return await load();
  } catch (error) {
    console.error(
      '[analytics] GA4 Data API request failed:',
      error instanceof Error ? error.message : error,
    );
    return {
      connected: false,
      reason: 'error',
      message: describeError(error, account, propertyId),
    };
  }
}

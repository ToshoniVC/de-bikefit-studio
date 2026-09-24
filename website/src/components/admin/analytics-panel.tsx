import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { badgeTone, FLASH_TONES } from '@/components/admin/tones';
import { resolveMeasurementId } from '@/lib/analytics/consent';
import {
  getAnalyticsOverview,
  normalizePropertyId,
  parseServiceAccountJson,
  type AnalyticsNotConnected,
  type AnalyticsOverview,
} from '@/lib/analytics/ga4';
import { getCurrentCmsUser } from '@/lib/cms/auth';
import { getSiteSettings } from '@/lib/cms/content';
import { can } from '@/lib/cms/permissions';
import { env } from '@/lib/env';

/**
 * Dashboard panel with GA4 insights (Worker B places it first on `/admin`).
 *
 * Async server component. Renders nothing for users without `analytics.read`.
 * Connected: three KPI tiles and two compact tables for the last 28 days.
 * Not connected: the three setup steps, each marked done or to do.
 *
 * The numbers come from `getAnalyticsOverview()` (cached one hour, never
 * throws). Wrapping the panel in `<Suspense>` keeps a slow Google response
 * from holding up the rest of the dashboard.
 */

const CARD = 'border border-border bg-card p-5 sm:p-6';

const numberFormat = new Intl.NumberFormat('nl-BE');
const dayFormat = new Intl.DateTimeFormat('nl-BE', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const dayYearFormat = new Intl.DateTimeFormat('nl-BE', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const timeFormat = new Intl.DateTimeFormat('nl-BE', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Brussels',
});

function formatRange(start: string, end: string): string {
  const from = new Date(`${start}T00:00:00Z`);
  const to = new Date(`${end}T00:00:00Z`);
  return `${dayFormat.format(from)} – ${dayYearFormat.format(to)}`;
}

function sourceLabel(source: string): string {
  if (source === '(direct)') return 'Direct';
  if (!source || source === '(not set)') return 'Onbekend';
  return source;
}

export async function AnalyticsPanel() {
  const user = await getCurrentCmsUser();
  if (!user || !can(user.role, 'analytics.read')) return null;

  const overview = await getAnalyticsOverview();
  if (overview.connected) return <ConnectedPanel overview={overview} />;

  return (
    <NotConnectedPanel
      overview={overview}
      steps={await setupProgress()}
      canEditSettings={can(user.role, 'settings.update')}
    />
  );
}

export default AnalyticsPanel;

// ---------------------------------------------------------------------------
// Connected
// ---------------------------------------------------------------------------

function ConnectedPanel({
  overview,
}: {
  overview: Extract<AnalyticsOverview, { connected: true }>;
}) {
  const tiles = [
    { label: 'Actieve gebruikers', value: overview.totals.activeUsers },
    { label: 'Sessies', value: overview.totals.sessions },
    { label: 'Paginaweergaven', value: overview.totals.screenPageViews },
  ];

  return (
    <section className={CARD} aria-labelledby="analytics-panel-title">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="analytics-panel-title" className="text-xl leading-tight">
            Google Analytics
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Laatste 28 dagen · {formatRange(overview.range.start, overview.range.end)} · bijgewerkt
            om {timeFormat.format(new Date(overview.fetchedAt))}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="success" className={badgeTone('success')}>
            Verbonden
          </Badge>
          <a
            href={`https://analytics.google.com/analytics/web/#/p${overview.propertyId}/reports/intelligenthome`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm underline underline-offset-4 hover:text-primary"
          >
            Open in Google Analytics
          </a>
        </div>
      </div>

      <div className="grid gap-px border border-border bg-border sm:grid-cols-3">
        {tiles.map((tile) => (
          <div key={tile.label} className="bg-background p-4">
            <p className="admin-label text-xs text-muted-foreground">{tile.label}</p>
            <p className="mt-1 font-ds-display text-4xl leading-none font-semibold tabular-nums">
              {numberFormat.format(tile.value)}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <MiniTable
          title="Populairste pagina’s"
          labelHeading="Pagina"
          valueHeading="Weergaven"
          empty="Nog geen paginaweergaven in deze periode."
          mono
          rows={overview.topPages.map((page) => ({ label: page.path || '/', value: page.views }))}
        />
        <MiniTable
          title="Belangrijkste bronnen"
          labelHeading="Bron"
          valueHeading="Sessies"
          empty="Nog geen sessies in deze periode."
          rows={overview.topSources.map((row) => ({
            label: sourceLabel(row.source),
            value: row.sessions,
          }))}
        />
      </div>
    </section>
  );
}

function MiniTable({
  title,
  labelHeading,
  valueHeading,
  rows,
  empty,
  mono = false,
}: {
  title: string;
  labelHeading: string;
  valueHeading: string;
  rows: Array<{ label: string; value: number }>;
  empty: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-base leading-tight">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <table className="w-full table-fixed border border-border text-xs">
          <thead className="bg-muted">
            <tr className="border-b border-border text-left text-muted-foreground">
              <th scope="col" className="py-2 pr-3 pl-3">
                {labelHeading}
              </th>
              <th scope="col" className="w-24 py-2 pr-3 text-right">
                {valueHeading}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.label}-${index}`} className="border-b border-border last:border-0">
                <td
                  className={`truncate py-2 pr-3 pl-3 ${mono ? 'font-mono' : ''}`}
                  title={row.label}
                >
                  {row.label}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {numberFormat.format(row.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Not connected
// ---------------------------------------------------------------------------

type SetupProgress = { measurement: boolean; serviceAccount: boolean; property: boolean };

async function setupProgress(): Promise<SetupProgress> {
  let enabled = false;
  let settingPropertyId = '';
  try {
    const settings = await getSiteSettings();
    enabled = settings.analytics.enabled;
    settingPropertyId = settings.analytics.ga4PropertyId;
  } catch {
    // Database hiccup: show every step as still to do rather than failing.
  }
  return {
    measurement: resolveMeasurementId(env.NEXT_PUBLIC_GA4_MEASUREMENT_ID, enabled) !== null,
    serviceAccount: parseServiceAccountJson(env.GA4_SERVICE_ACCOUNT_JSON) !== null,
    property: normalizePropertyId(env.GA4_PROPERTY_ID?.trim() || settingPropertyId) !== null,
  };
}

function StepState({ done }: { done: boolean }) {
  return done ? (
    <Badge variant="success" className={badgeTone('success')}>
      Klaar
    </Badge>
  ) : (
    <Badge variant="outline">Te doen</Badge>
  );
}

function NotConnectedPanel({
  overview,
  steps,
  canEditSettings,
}: {
  overview: AnalyticsNotConnected;
  steps: SetupProgress;
  canEditSettings: boolean;
}) {
  const code = 'rounded bg-muted px-1 py-0.5 font-mono text-[11px]';
  const settingsLink = canEditSettings ? (
    <Link href="/admin/settings" className="underline underline-offset-4">
      Instellingen → Analytics
    </Link>
  ) : (
    'Instellingen → Analytics'
  );

  return (
    <section className={CARD} aria-labelledby="analytics-panel-title">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="analytics-panel-title" className="text-xl leading-tight">
            Google Analytics: niet verbonden
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{overview.message}</p>
        </div>
        <Badge
          variant={overview.reason === 'error' ? 'destructive' : 'warning'}
          className={badgeTone(overview.reason === 'error' ? 'destructive' : 'warning')}
        >
          {overview.reason === 'error' ? 'Fout' : 'Niet verbonden'}
        </Badge>
      </div>

      <ol className="flex flex-col gap-3 text-sm">
        <li className="flex items-start gap-3">
          <span className="font-ds-display text-xl leading-none font-semibold text-muted-foreground tabular-nums">
            1.
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">GA4-property en meet-ID</p>
            <p className="text-muted-foreground">
              Maak in Google Analytics een GA4-property met een webdatastream. Zet de meet-ID (
              <code className={code}>G-…</code>) in Vercel als{' '}
              <code className={code}>NEXT_PUBLIC_GA4_MEASUREMENT_ID</code> en zet Analytics aan
              onder {settingsLink}.
            </p>
          </div>
          <StepState done={steps.measurement} />
        </li>
        <li className="flex items-start gap-3">
          <span className="font-ds-display text-xl leading-none font-semibold text-muted-foreground tabular-nums">
            2.
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">Serviceaccount met leesrechten</p>
            <p className="text-muted-foreground">
              Maak in Google Cloud een serviceaccount, schakel de Google Analytics Data API in en
              geef het serviceaccount de rol Kijker (Viewer) op de GA4-property. Zet de JSON-sleutel
              in Vercel als <code className={code}>GA4_SERVICE_ACCOUNT_JSON</code>.
            </p>
          </div>
          <StepState done={steps.serviceAccount} />
        </li>
        <li className="flex items-start gap-3">
          <span className="font-ds-display text-xl leading-none font-semibold text-muted-foreground tabular-nums">
            3.
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">Property-ID</p>
            <p className="text-muted-foreground">
              Vul de numerieke property-ID (GA4 → Beheer → Property-details) in onder {settingsLink}
              , of zet <code className={code}>GA4_PROPERTY_ID</code> in Vercel.
            </p>
          </div>
          <StepState done={steps.property} />
        </li>
      </ol>

      <p className={`mt-4 px-3 py-2 text-xs ${FLASH_TONES.info}`}>
        De publieke site laadt Google Analytics pas nadat een bezoeker cookies heeft geaccepteerd in
        de cookiebanner. Zonder toestemming wordt er niets gemeten. De volledige handleiding staat
        in <code className={code}>docs/booking-runbook.md</code>.
      </p>
    </section>
  );
}

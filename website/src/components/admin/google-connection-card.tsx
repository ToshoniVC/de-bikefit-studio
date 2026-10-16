'use client';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { ActionForm, SectionCard, SubmitButton } from '@/components/admin/form';
import type { EditorScope } from '@/components/admin/provider-editor';
import { badgeTone, FLASH_TONES } from '@/components/admin/tones';
import type { GoogleSetupView } from '@/lib/booking/google-oauth-config';
import { disconnectGoogleAction } from '@/lib/cms/actions/providers';

/**
 * The Google Agenda card of `/admin/agenda` (scope `own`) and
 * `/admin/providers/[id]` (scope `any`), split out of `provider-editor.tsx`.
 *
 * `setup` is `googleConnectSetup()` from `src/lib/booking/google.ts`: the same
 * decision the OAuth start route takes, so the connect button shows exactly
 * when the route would send the user on to Google. Who sees what while the
 * server is not ready:
 *  - a user with `provider.manage` (`setup.admin`): what is missing, by
 *    variable name, never a value, and the redirect URI to register;
 *  - anyone else: that it is not set up yet and whom to ask. A provider
 *    cannot fix server configuration.
 * A ready admin can still look up the redirect URI under the card.
 */

export type GoogleStatus = {
  connected: boolean;
  email: string | null;
  /** Already formatted for display, or null. */
  connectedSince: string | null;
  error: string | null;
};

function RedirectUri({ uri }: { uri: string }) {
  return (
    <code className="rounded bg-muted px-1 py-0.5 font-mono break-all text-foreground">{uri}</code>
  );
}

function GoogleSetupNotice({ setup, scope }: { setup: GoogleSetupView; scope: EditorScope }) {
  if (!setup.admin) {
    return (
      <p className={`px-3 py-2 text-xs ${FLASH_TONES.info}`}>
        {scope === 'own'
          ? 'Google Agenda koppelen kan nog niet: de koppeling is op deze server nog niet ingesteld. Vraag de beheerder om ze in te stellen. Tot dan tellen enkel je openingsuren en je bestaande afspraken.'
          : 'Google Agenda koppelen kan nog niet: de koppeling is op deze server nog niet ingesteld. Een beheerder kan ze instellen. Tot dan tellen enkel de openingsuren en de bestaande afspraken van deze aanbieder.'}
      </p>
    );
  }

  return (
    <div className={`flex flex-col gap-2 px-3 py-2 text-xs ${FLASH_TONES.warning}`}>
      <p className="font-medium">Google Agenda koppelen kan nog niet op deze server.</p>
      {setup.admin.problems.length > 0 ? (
        <ul className="list-disc pl-4">
          {setup.admin.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
      {setup.admin.redirectUri ? (
        <p>
          Registreer in de OAuth-client in Google Cloud exact deze terugkeer-URL (Authorised
          redirect URI): <RedirectUri uri={setup.admin.redirectUri} />
        </p>
      ) : null}
      <p>
        Stel de waarden in bij de omgevingsvariabelen van deze omgeving (Vercel, lokaal .env.local)
        en deploy daarna opnieuw; zie docs/booking-runbook.md §7. Tot dan tellen enkel de
        openingsuren en de bestaande afspraken.
      </p>
    </div>
  );
}

export function GoogleConnectionCard({
  providerId,
  google,
  scope,
  canConnect,
  setup,
}: {
  providerId: string;
  google: GoogleStatus;
  scope: EditorScope;
  canConnect: boolean;
  /** Whether a connection can start on this server, and what this user may see about it. */
  setup: GoogleSetupView;
}) {
  return (
    <SectionCard
      title="Google Agenda"
      description={
        scope === 'own'
          ? 'Bezette momenten in je Google Agenda worden niet aangeboden, en elke nieuwe afspraak komt erin te staan.'
          : 'Bezette momenten in de Google Agenda van deze aanbieder worden niet aangeboden, en elke nieuwe afspraak komt erin te staan.'
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {google.connected ? (
            <>
              <Badge
                variant={google.error ? 'warning' : 'success'}
                className={badgeTone(google.error ? 'warning' : 'success')}
              >
                Verbonden
              </Badge>
              <span>
                als <span className="font-medium">{google.email ?? 'onbekend account'}</span>
                {google.connectedSince ? ` sinds ${google.connectedSince}` : ''}
              </span>
            </>
          ) : (
            <Badge variant="secondary">Niet verbonden</Badge>
          )}
        </div>
        {google.error ? (
          <p className={`px-3 py-2 text-sm ${FLASH_TONES.error}`}>Laatste fout: {google.error}</p>
        ) : null}
        {!setup.ready ? <GoogleSetupNotice setup={setup} scope={scope} /> : null}
        {canConnect ? (
          <div className="flex flex-wrap items-start gap-2">
            {setup.ready ? (
              <a
                href={`/api/google/oauth/start?provider=${encodeURIComponent(providerId)}&return=${scope === 'own' ? 'agenda' : 'provider'}`}
                data-slot="button"
                className={buttonVariants({
                  size: 'sm',
                  variant: google.connected ? 'outline' : 'default',
                })}
              >
                {google.connected ? 'Opnieuw koppelen' : 'Google Agenda koppelen'}
              </a>
            ) : null}
            {google.connected ? (
              <ActionForm action={disconnectGoogleAction} hidden={{ providerId, scope }}>
                <SubmitButton
                  variant="destructive"
                  confirm="Google Agenda ontkoppelen? Nieuwe afspraken komen dan niet meer in je agenda en bezette momenten worden niet meer gecontroleerd."
                >
                  Ontkoppelen
                </SubmitButton>
              </ActionForm>
            ) : null}
          </div>
        ) : null}
        {setup.ready && setup.admin?.redirectUri ? (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Gegevens voor de OAuth-client</summary>
            <p className="mt-2">
              Terugkeer-URL (Authorised redirect URI) die deze server naar Google stuurt; ze moet
              exact zo in de OAuth-client staan: <RedirectUri uri={setup.admin.redirectUri} />
            </p>
          </details>
        ) : null}
      </div>
    </SectionCard>
  );
}

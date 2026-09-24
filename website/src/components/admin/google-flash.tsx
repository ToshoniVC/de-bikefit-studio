import { FLASH_TONES } from '@/components/admin/tones';

/**
 * Feedback after the Google OAuth round trip. `/api/google/oauth/callback`
 * redirects back with `?google=connected` or `?google=error&reason=<code>`;
 * the code is mapped to Dutch here and never echoed raw.
 */

const REASONS: Record<string, string> = {
  state: 'De koppelaanvraag is verlopen of ongeldig. Start de koppeling opnieuw.',
  session: 'Je sessie is verlopen of je bent met een ander account aangemeld. Meld je opnieuw aan.',
  forbidden: 'Je mag de Google Agenda van deze aanbieder niet koppelen.',
  access_denied: 'Je hebt de toegang in Google geweigerd.',
  google: 'Google gaf een fout terug.',
  exchange: 'De code van Google kon niet ingewisseld worden. Controleer de OAuth-instellingen.',
  missing_scope:
    'Niet alle gevraagde rechten zijn aangevinkt. Geef toegang tot je agenda en je beschikbaarheid.',
  no_refresh_token:
    'Google gaf geen vernieuwingssleutel. Verwijder de toegang van deze app in je Google-account (Beveiliging → Apps van derden) en koppel opnieuw.',
  store: 'De koppeling kon niet bewaard worden.',
};

export function GoogleFlash({ google, reason }: { google?: string; reason?: string }) {
  if (google === 'connected') {
    return (
      <p role="status" className={`mb-6 px-4 py-3 text-sm ${FLASH_TONES.success}`}>
        Google Agenda gekoppeld. Nieuwe afspraken komen er vanaf nu in te staan.
      </p>
    );
  }
  if (google === 'error') {
    const detail = (reason && REASONS[reason]) || 'Er ging iets mis.';
    return (
      <p role="status" className={`mb-6 px-4 py-3 text-sm ${FLASH_TONES.error}`}>
        Koppelen met Google is niet gelukt. {detail}
      </p>
    );
  }
  return null;
}

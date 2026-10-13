'use client';

import { Input } from '@/components/ui/input';
import { Field, StatusMessage, SubmitButton } from '@/components/admin/form';
import { MfaQrCode } from '@/components/admin/mfa/qr-code';
import type { ActionState } from '@/lib/cms/actions/state';

/**
 * Step "scan and confirm", shared by the first enrolment (`/admin/mfa`) and
 * replacing an authenticator (`/admin/account`). `display` is the payload of
 * the start action: shown once, from React state, never put in a URL.
 */
export function MfaEnrolmentStep({
  display,
  confirmAction,
  confirmState,
  submitLabel = 'Bevestigen',
}: {
  display: Record<string, string>;
  confirmAction: (form: FormData) => void;
  confirmState: ActionState;
  submitLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
        <li>
          Open je authenticator: 1Password (nieuw item of bewerken → <em>Eenmalig wachtwoord</em>)
          of een gratis app zoals Aegis, Ente Auth of Google Authenticator.
        </li>
        <li>Scan de QR-code, of typ de sleutel hieronder over.</li>
        <li>Vul de code van 6 cijfers in die de app toont.</li>
      </ol>

      <div className="flex justify-center">
        <MfaQrCode size={Number(display.qrSize)} path={display.qrPath} />
      </div>

      <Field label="Sleutel om over te typen" htmlFor="mfa-manual-key">
        <Input
          id="mfa-manual-key"
          readOnly
          value={display.manualKey}
          className="h-9 font-mono text-sm"
          onFocus={(event) => event.currentTarget.select()}
        />
      </Field>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">
          Koppeling als tekst (om in 1Password te plakken)
        </summary>
        <Input
          aria-label="otpauth-koppeling"
          readOnly
          value={display.otpauthUri}
          className="mt-2 h-9 font-mono text-xs"
          onFocus={(event) => event.currentTarget.select()}
        />
      </details>

      <form action={confirmAction} className="flex flex-col gap-3">
        <Field label="Code uit je app" htmlFor="mfa-confirm-code">
          <Input
            id="mfa-confirm-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
            required
            className="h-9 font-mono"
          />
        </Field>
        <StatusMessage state={confirmState} />
        <SubmitButton size="lg">{submitLabel}</SubmitButton>
      </form>
    </div>
  );
}

/** Code field for sign-in and re-authentication: six digits or a recovery code. */
export function MfaCodeField({ id, autoFocus }: { id: string; autoFocus?: boolean }) {
  return (
    <Field
      label="Code uit je app of herstelcode"
      htmlFor={id}
      hint="6 cijfers uit je authenticator, of één van je herstelcodes (XXXX-XXXX-XXXX-XXXX)."
    >
      <Input
        id={id}
        name="code"
        autoComplete="one-time-code"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={32}
        required
        autoFocus={autoFocus}
        className="h-9 font-mono"
      />
    </Field>
  );
}

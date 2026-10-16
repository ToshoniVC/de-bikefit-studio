'use client';

import { useActionState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Field, SectionCard, StatusMessage, SubmitButton } from '@/components/admin/form';
import { badgeTone, FLASH_TONES } from '@/components/admin/tones';
import { IDLE_STATE } from '@/lib/cms/actions/state';
import {
  clearEmailApiKeyAction,
  saveEmailApiKeyAction,
  saveEmailSettingsAction,
  sendTestEmailAction,
} from '@/lib/email/actions';
import type { EmailServiceStatus, EmailSettingSource } from '@/lib/email/config';
import { cn } from '@/lib/utils';

/**
 * Beheer → E-mail. Everything shown comes from `EmailServiceStatus`, which
 * never holds the API key: the key field is write-only (always empty, a
 * password input), and after saving only its source and last four characters
 * come back from the server.
 */

const CODE = 'rounded bg-muted px-1 py-0.5 font-mono text-[11px]';

function State({
  done,
  label = 'Klaar',
  optional,
}: {
  done: boolean;
  label?: string;
  optional?: boolean;
}) {
  if (done) {
    return (
      <Badge variant="success" className={badgeTone('success')}>
        {label}
      </Badge>
    );
  }
  return <Badge variant="outline">{optional ? 'Optioneel' : 'Te doen'}</Badge>;
}

function sourceLabel(source: EmailSettingSource, envName: string) {
  if (source === 'env') {
    return (
      <>
        via omgevingsvariabele <code className={CODE}>{envName}</code> (heeft voorrang)
      </>
    );
  }
  if (source === 'setting') return 'ingesteld hier in beheer';
  return 'niet ingesteld';
}

function EnvNote({ active, envName }: { active: boolean; envName: string }) {
  if (!active) return null;
  return (
    <p className="text-xs text-muted-foreground">
      <code className={CODE}>{envName}</code> is op de server ingesteld en heeft voorrang: wat je
      hier bewaart, wordt pas gebruikt als die variabele verdwijnt.
    </p>
  );
}

export function EmailServiceManager({
  status,
  keyUpdated,
  adminEmail,
}: {
  status: EmailServiceStatus;
  keyUpdated: string | null;
  adminEmail: string;
}) {
  const [keyState, keyAction] = useActionState(saveEmailApiKeyAction, IDLE_STATE);
  const [clearState, clearAction] = useActionState(clearEmailApiKeyAction, IDLE_STATE);
  const [settingsState, settingsAction] = useActionState(saveEmailSettingsAction, IDLE_STATE);
  const [testState, testAction] = useActionState(sendTestEmailAction, IDLE_STATE);

  const { apiKey, sender, replyTo, recipient } = status;
  const keyLine =
    apiKey.source === 'env' ? (
      <>
        Via omgevingsvariabele <code className={CODE}>RESEND_API_KEY</code> (heeft voorrang).
      </>
    ) : apiKey.source === 'setting' ? (
      `Opgeslagen in beheer, versleuteld · eindigt op …${apiKey.hint ?? ''}${keyUpdated ? ` · ${keyUpdated}` : ''}`
    ) : apiKey.unreadable ? (
      'Er is een sleutel opgeslagen, maar die kan niet meer ontsleuteld worden (het servergeheim CMS_SESSION_SECRET is veranderd). Vul de sleutel opnieuw in.'
    ) : (
      'Niet ingesteld.'
    );

  const recipientLine = recipient.invalid
    ? recipient.source === 'env'
      ? 'GIFT_VOUCHER_RECIPIENT is geen geldig adres: er wordt niets verstuurd.'
      : 'Het opgeslagen adres is ongeldig: er wordt niets verstuurd.'
    : recipient.address
      ? recipient.address
      : 'Leeg: bestellingen worden niet verstuurd.';

  const summary = !status.ready
    ? 'Niet ingesteld: de site verstuurt geen e-mail. Afspraken worden wel bewaard (zonder bevestigingsmail). Bij een cadeaubonbestelling ziet de bezoeker “Je bestelling is niet verstuurd”, blijft het formulier ingevuld en krijgt die het telefoonnummer.'
    : !status.voucherReady
      ? 'Afspraakmails worden verstuurd. Cadeaubonbestellingen nog niet: er is geen geldige ontvanger, dus de bezoeker ziet “Je bestelling is niet verstuurd”.'
      : 'Klaar. “Verstuurd” betekent dat Resend het bericht aanvaardde, niet dat het al in de mailbox staat: kijk na de eerste echte bestelling in Resend → Emails.';

  return (
    <div className="flex flex-col gap-4">
      {!status.storeAvailable ? (
        <p role="alert" className={cn('px-3 py-2 text-sm', FLASH_TONES.error)}>
          De database heeft de tabel voor deze instellingen nog niet (migratie 0004). Opslaan lukt
          pas na <code className={CODE}>npm run db:migrate</code> op deze omgeving.
          Omgevingsvariabelen werken wel.
        </p>
      ) : null}

      <SectionCard title="Status" description={summary}>
        <ul className="flex flex-col gap-3 text-sm">
          <li className="flex items-start justify-between gap-3">
            <span>
              <span className="font-medium">API-sleutel</span>
              <span className="block text-muted-foreground">{keyLine}</span>
            </span>
            <State done={Boolean(apiKey.source !== 'none')} label="Aanwezig" />
          </li>
          <li className="flex items-start justify-between gap-3">
            <span>
              <span className="font-medium">Afzender</span>
              <span className="block break-all text-muted-foreground">
                {sender.value ? `${sender.value} — ` : ''}
                {sourceLabel(sender.source, 'EMAIL_FROM')}
              </span>
            </span>
            <State done={Boolean(sender.value)} />
          </li>
          <li className="flex items-start justify-between gap-3">
            <span>
              <span className="font-medium">Antwoordadres</span>
              <span className="block break-all text-muted-foreground">
                {replyTo.value
                  ? `${replyTo.value} — `
                  : 'Geen: antwoorden op afspraakmails gaan naar de afzender. '}
                {replyTo.value ? sourceLabel(replyTo.source, 'EMAIL_REPLY_TO') : null}
              </span>
            </span>
            <State done={Boolean(replyTo.value)} optional />
          </li>
          <li className="flex items-start justify-between gap-3">
            <span>
              <span className="font-medium">Ontvanger bestellingen en aanvragen</span>
              <span className="block break-all text-muted-foreground">
                {recipientLine}
                {recipient.address ? (
                  <> — {sourceLabel(recipient.source, 'GIFT_VOUCHER_RECIPIENT')}</>
                ) : null}
              </span>
            </span>
            <State done={Boolean(recipient.address)} />
          </li>
        </ul>
      </SectionCard>

      <SectionCard
        title="API-sleutel"
        description="De sleutel van je Resend-account. Hij wordt versleuteld bewaard en is hierna nooit meer zichtbaar, ook niet voor beheerders: je ziet alleen de laatste vier tekens."
      >
        <form action={keyAction} className="flex flex-col gap-3" autoComplete="off">
          <Field
            label={apiKey.stored ? 'Nieuwe API-sleutel (vervangt de opgeslagen)' : 'API-sleutel'}
            htmlFor="email-apiKey"
            hint="Begint met re_. Maak in Resend een sleutel met alleen “Sending access”."
          >
            <Input
              id="email-apiKey"
              name="apiKey"
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              placeholder="re_…"
              required
            />
          </Field>
          <EnvNote active={apiKey.source === 'env'} envName="RESEND_API_KEY" />
          <div>
            <SubmitButton>Sleutel opslaan</SubmitButton>
          </div>
          <StatusMessage state={keyState} />
        </form>
        {apiKey.stored ? (
          <form
            action={clearAction}
            className="mt-4 flex flex-col gap-2 border-t border-border pt-4"
          >
            <div>
              <SubmitButton
                variant="outline"
                confirm="De opgeslagen API-sleutel verwijderen? Zonder sleutel verstuurt de site geen e-mail meer (tenzij RESEND_API_KEY op de server staat)."
              >
                Opgeslagen sleutel verwijderen
              </SubmitButton>
            </div>
            <StatusMessage state={clearState} />
          </form>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Afzender en ontvangers"
        description="Gelden voor alle e-mail van de site. Laat een veld leeg om het uit te zetten."
      >
        <form action={settingsAction} className="flex flex-col gap-3">
          <Field
            label="Afzender"
            htmlFor="email-from"
            hint="Een adres op een domein dat in Resend geverifieerd is, bv. De Bikefit Studio <afspraken@jouwdomein.be>. Nooit het adres van een bezoeker."
          >
            <Input
              id="email-from"
              name="from"
              autoComplete="off"
              spellCheck={false}
              placeholder="De Bikefit Studio <afspraken@jouwdomein.be>"
              defaultValue={status.stored.from}
            />
          </Field>
          <EnvNote active={sender.source === 'env'} envName="EMAIL_FROM" />
          <Field
            label="Antwoordadres (optioneel)"
            htmlFor="email-replyTo"
            hint="Waar antwoorden op afspraakmails naartoe gaan. Bij een cadeaubonbestelling is het antwoordadres altijd de bezoeker."
          >
            <Input
              id="email-replyTo"
              name="replyTo"
              type="email"
              inputMode="email"
              autoComplete="off"
              placeholder="info@jouwdomein.be"
              defaultValue={status.stored.replyTo}
            />
          </Field>
          <EnvNote active={replyTo.source === 'env'} envName="EMAIL_REPLY_TO" />
          <Field
            label="Ontvanger bestellingen en aanvragen"
            htmlFor="email-giftVoucherRecipient"
            hint="Eén mailbox die echt mail ontvangt: cadeaubonbestellingen en aanvragen via het formulier op een dienstpagina (aanbod op aanvraag) komen hier aan. Het publieke contactadres (Instellingen → Contact) wordt hier niet automatisch voor gebruikt."
          >
            <Input
              id="email-giftVoucherRecipient"
              name="giftVoucherRecipient"
              type="email"
              inputMode="email"
              autoComplete="off"
              placeholder="bestellingen@jouwdomein.be"
              defaultValue={status.stored.giftVoucherRecipient}
            />
          </Field>
          <EnvNote active={recipient.source === 'env'} envName="GIFT_VOUCHER_RECIPIENT" />
          <div>
            <SubmitButton>Opslaan</SubmitButton>
          </div>
          <StatusMessage state={settingsState} />
        </form>
      </SectionCard>

      <SectionCard
        title="Testbericht"
        description="Verstuurt één echte e-mail met de huidige instellingen. Zo weet je of sleutel, afzender en mailbox werken."
      >
        <form action={testAction} className="flex flex-col gap-3">
          <Field label="Naar" htmlFor="email-test-to">
            <Input
              id="email-test-to"
              name="to"
              type="email"
              inputMode="email"
              autoComplete="off"
              defaultValue={recipient.address || adminEmail}
              required
            />
          </Field>
          <div>
            <SubmitButton
              variant="outline"
              confirm="Dit verstuurt echt een e-mail naar het ingevulde adres. Doorgaan?"
            >
              Testbericht versturen
            </SubmitButton>
          </div>
          <StatusMessage state={testState} />
        </form>
      </SectionCard>

      <SectionCard title="Zo stel je het in">
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
          <li>Maak een account op resend.com (of gebruik het bestaande account van de studio).</li>
          <li>
            Voeg in Resend → Domains het domein toe waarvan je wilt mailen. Laat de DNS-records die
            Resend toont (DKIM, SPF/MX voor het “send”-subdomein) bij je domeinbeheerder zetten en
            wacht tot het domein op <em>Verified</em> staat. Zonder geverifieerd domein weigert
            Resend de berichten.
          </li>
          <li>
            Maak in Resend → API Keys een sleutel met <em>Sending access</em>, plak die hierboven en
            sla op. Bewaar hem daarnaast in de wachtwoordkluis van de studio.
          </li>
          <li>Vul de afzender in met een adres op dat geverifieerde domein.</li>
          <li>
            Vul de ontvanger voor bestellingen en aanvragen in: een mailbox die echt mail ontvangt
            en gelezen wordt.
          </li>
          <li>
            Verstuur een testbericht en controleer of het aankomt. Het cadeaubonformulier meldt
            “verstuurd” zodra sleutel, afzender en ontvanger ingevuld zijn; alleen het testbericht
            bewijst dat de mail ook echt in de mailbox komt.
          </li>
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">
          Staan <code className={CODE}>RESEND_API_KEY</code>,{' '}
          <code className={CODE}>EMAIL_FROM</code>, <code className={CODE}>EMAIL_REPLY_TO</code> of{' '}
          <code className={CODE}>GIFT_VOUCHER_RECIPIENT</code> op de server (Vercel), dan hebben die
          voorrang op wat hier staat.
        </p>
      </SectionCard>
    </div>
  );
}

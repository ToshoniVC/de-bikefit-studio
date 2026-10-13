'use client';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/admin/form';
import { badgeTone } from '@/components/admin/tones';
import type { GiftVoucherDeliveryStatus } from '@/lib/gift-voucher/recipient';

/**
 * Instellingen → Bestellingen: where gift voucher orders go, plus a read-only
 * checklist of what sending needs. The status comes from the server page as
 * plain values (key presence as a boolean, never the key itself).
 */

function StepState({ done, label = 'Klaar' }: { done: boolean; label?: string }) {
  return done ? (
    <Badge variant="success" className={badgeTone('success')}>
      {label}
    </Badge>
  ) : (
    <Badge variant="outline">Te doen</Badge>
  );
}

const CODE = 'rounded bg-muted px-1 py-0.5 font-mono text-[11px]';

export function OrderSettingsFields({
  value,
  status,
}: {
  value: string;
  status: GiftVoucherDeliveryStatus;
}) {
  const { recipient } = status;
  const recipientNote =
    recipient.source === 'env'
      ? recipient.invalid
        ? 'De omgevingsvariabele GIFT_VOUCHER_RECIPIENT is geen geldig adres: er wordt niets verstuurd.'
        : `Ingesteld via de omgevingsvariabele GIFT_VOUCHER_RECIPIENT (${recipient.address}); die heeft voorrang op dit veld.`
      : recipient.invalid
        ? 'Het opgeslagen adres is ongeldig: er wordt niets verstuurd.'
        : recipient.address
          ? `Bestellingen gaan naar ${recipient.address}.`
          : 'Leeg: bestellingen worden niet verstuurd.';

  return (
    <>
      <Field
        label="Ontvanger cadeaubonbestellingen"
        htmlFor="orders-giftVoucherRecipient"
        hint="Eén e-mailadres van een mailbox die echt mail ontvangt. Het publieke contactadres (Contact → E-mail) wordt hier niet automatisch voor gebruikt."
      >
        <Input
          id="orders-giftVoucherRecipient"
          name="giftVoucherRecipient"
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder="bestellingen@domein.be"
          defaultValue={value}
        />
      </Field>
      <p className="text-xs text-muted-foreground">{recipientNote}</p>

      <div className="mt-2 border border-border p-4 text-sm">
        <p className="font-medium">Wat versturen nodig heeft</p>
        <ul className="mt-2 flex flex-col gap-2">
          <li className="flex items-start justify-between gap-3">
            <span>
              API-sleutel van de e-maildienst (<code className={CODE}>RESEND_API_KEY</code>, in
              Vercel; de waarde wordt hier nooit getoond)
            </span>
            <StepState done={status.apiKey} label="Aanwezig" />
          </li>
          <li className="flex items-start justify-between gap-3">
            <span>
              Afzender (<code className={CODE}>EMAIL_FROM</code>, op een domein dat bij Resend
              geverifieerd is){status.sender ? `: ${status.sender}` : ''}
            </span>
            <StepState done={Boolean(status.sender)} />
          </li>
          <li className="flex items-start justify-between gap-3">
            <span>Ontvanger (dit veld of GIFT_VOUCHER_RECIPIENT)</span>
            <StepState done={Boolean(recipient.address)} />
          </li>
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          {status.ready
            ? 'Alles staat klaar. “Verstuurd” betekent dat de e-maildienst het bericht aanvaardde; controleer in Resend of het ook aankwam.'
            : 'Zolang iets ontbreekt, ziet de bezoeker “Je bestelling is niet verstuurd”, blijft het formulier ingevuld en krijgt die het telefoonnummer. Er wordt niets verstuurd.'}
        </p>
      </div>
    </>
  );
}

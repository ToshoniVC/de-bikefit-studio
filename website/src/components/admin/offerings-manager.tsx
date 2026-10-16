'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field, StatusMessage, SubmitButton } from '@/components/admin/form';
import { centsToEuroInput } from '@/components/admin/booking-labels';
import { badgeTone, FLASH_TONES } from '@/components/admin/tones';
import { saveOfferingAction } from '@/lib/cms/actions/offerings';
import { IDLE_STATE } from '@/lib/cms/actions/state';
import {
  AUDIENCE_LABELS,
  audiencesFor,
  OFFERING_STATUS_LABELS,
  type OfferingAudience,
  type OfferingBookingMode,
  type OfferingStatus,
  type OfferingVariantMode,
} from '@/lib/offers/offering';

/** One service in the variant pickers. */
export type OfferingServiceOption = {
  id: string;
  name: string;
  durationMinutes: number;
  isActive: boolean;
  requiresGuardian: boolean;
  providerCount: number;
};

/** One offer page with its settings, plain and serialisable. */
export type OfferingRow = {
  pageId: string;
  title: string;
  path: string;
  categoryLabel: string;
  pageStatus: 'draft' | 'published';
  source: 'stored' | 'legacy';
  legacyNotes: string[];
  isListed: boolean;
  bookingMode: OfferingBookingMode;
  variantMode: OfferingVariantMode;
  variants: { audience: OfferingAudience; serviceId: string | null; priceCents: number | null }[];
  status: OfferingStatus;
};

/**
 * Beheer → Aanbod: one card per offer page with every decision about the
 * offering in one form — shown or not, one option or Volwassene/Jeugd, the
 * price per variant, and booked directly online (as which service) or asked
 * for through the enquiry form. The page's text stays in Pagina's; durations,
 * buffers and the guardian rule stay in Diensten; who offers what is each
 * provider's own choice (Mijn agenda → Mijn aanbod). The server action is the
 * boundary (`offering.manage`); this form only explains.
 */
export function OfferingsManager({
  offerings,
  services,
}: {
  offerings: OfferingRow[];
  services: OfferingServiceOption[];
}) {
  if (offerings.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Er zijn nog geen dienstpagina’s onder /aanbod/ met een blok “Dienst (aanbod)”.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {offerings.map((offering) => (
        <OfferingCard key={offering.pageId} offering={offering} services={services} />
      ))}
    </div>
  );
}

function statusBadge(offering: OfferingRow): {
  label: string;
  tone: 'success' | 'warning' | 'secondary';
} {
  if (offering.pageStatus !== 'published')
    return { label: 'Pagina is een concept', tone: 'secondary' };
  if (!offering.isListed) return { label: 'Verborgen', tone: 'secondary' };
  if (offering.status === 'bookable')
    return { label: OFFERING_STATUS_LABELS.bookable, tone: 'success' };
  if (offering.status === 'unavailable') {
    return { label: `${OFFERING_STATUS_LABELS.unavailable}: geen aanbieder`, tone: 'warning' };
  }
  return { label: 'Op aanvraag (formulier)', tone: 'secondary' };
}

function OfferingCard({
  offering,
  services,
}: {
  offering: OfferingRow;
  services: OfferingServiceOption[];
}) {
  const [state, formAction] = useActionState(saveOfferingAction, IDLE_STATE);
  const [variantMode, setVariantMode] = useState<OfferingVariantMode>(offering.variantMode);
  const [bookingMode, setBookingMode] = useState<OfferingBookingMode>(offering.bookingMode);
  const [chosen, setChosen] = useState<Record<string, string>>(() =>
    Object.fromEntries(offering.variants.map((v) => [v.audience, v.serviceId ?? ''])),
  );
  const id = (name: string) => `offering-${offering.pageId}-${name}`;
  const badge = statusBadge(offering);
  const price = (audience: OfferingAudience) =>
    offering.variants.find((variant) => variant.audience === audience)?.priceCents ?? null;

  return (
    <section className="border border-border bg-card p-5 sm:p-6" aria-labelledby={id('title')}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id('title')} className="text-xl leading-tight">
            {offering.title}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {offering.categoryLabel} ·{' '}
            <code className="bg-muted px-1 text-xs">{offering.path}</code>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={badge.tone} className={badgeTone(badge.tone)}>
            {badge.label}
          </Badge>
          <Link
            href={`/admin/pages/${offering.pageId}`}
            className="text-sm underline underline-offset-4 hover:text-primary"
          >
            Tekst bewerken
          </Link>
        </div>
      </div>

      {offering.source === 'legacy' ? (
        <div className={`mb-4 px-3 py-2 text-sm ${FLASH_TONES.warning}`}>
          <p>
            Nog niet opgeslagen in Aanbod: deze instellingen zijn afgeleid van de pagina en gelden
            zo tot je opslaat.
          </p>
          {offering.legacyNotes.length > 0 ? (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {offering.legacyNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="pageId" value={offering.pageId} />

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="isListed"
            defaultChecked={offering.isListed}
            className="mt-0.5 size-4 rounded border-input accent-primary"
          />
          <span>
            <span className="font-medium">Tonen op de website</span>
            <span className="block text-xs text-muted-foreground">
              In de overzichten (Aanbod, home, Bikefit), op de eigen pagina en op de afspraakpagina.
              Uit = de pagina geeft “niet gevonden”; de tekst blijft bewaard.
            </span>
          </span>
        </label>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="admin-label mb-1 text-xs text-muted-foreground">Varianten</legend>
          <Radio
            name="variantMode"
            value="single"
            checked={variantMode === 'single'}
            onChange={() => setVariantMode('single')}
            label="Eén optie voor iedereen"
          />
          <Radio
            name="variantMode"
            value="audience"
            checked={variantMode === 'audience'}
            onChange={() => setVariantMode('audience')}
            label="Volwassene en Jeugd apart"
            hint="Elk met een eigen dienst (duur, ouder of voogd) en een eigen prijs."
          />
        </fieldset>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="admin-label mb-1 text-xs text-muted-foreground">Boeken</legend>
          <Radio
            name="bookingMode"
            value="direct"
            checked={bookingMode === 'direct'}
            onChange={() => setBookingMode('direct')}
            label="Rechtstreeks online boeken"
            hint="De knop gaat naar /afspraak met enkel de diensten hieronder. Zonder aanbieder voor een dienst staat het aanbod grijs: “tijdelijk niet online te boeken”."
          />
          <Radio
            name="bookingMode"
            value="enquiry"
            checked={bookingMode === 'enquiry'}
            onChange={() => setBookingMode('enquiry')}
            label="Enkel op aanvraag"
            hint="De dienstpagina toont een aanvraagformulier; de aanvraag gaat naar de ontvanger uit Beheer → E-mail."
          />
        </fieldset>

        <div className="flex flex-col gap-3">
          {audiencesFor(variantMode).map((audience) => {
            const label = AUDIENCE_LABELS[audience] || 'Het aanbod';
            const serviceId = chosen[audience] ?? '';
            const service = services.find((entry) => entry.id === serviceId) ?? null;
            const options = services.filter((entry) => entry.isActive || entry.id === serviceId);
            return (
              <div
                key={audience}
                className="grid gap-3 border border-border bg-background p-3 sm:grid-cols-2"
              >
                <Field
                  label={`${label}: boeken als dienst`}
                  htmlFor={id(`service-${audience}`)}
                  hint={
                    bookingMode === 'direct'
                      ? 'Verplicht. Duur, buffer en ouderregel komen uit Beheer → Diensten.'
                      : 'Niet nodig op aanvraag; een gekozen dienst blijft bewaard maar is dan niet online te boeken.'
                  }
                >
                  <Select
                    id={id(`service-${audience}`)}
                    name={`service:${audience}`}
                    value={serviceId}
                    onChange={(event) =>
                      setChosen((current) => ({ ...current, [audience]: event.target.value }))
                    }
                  >
                    <option value="">— geen dienst —</option>
                    {options.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name} · {entry.durationMinutes} min
                        {entry.isActive ? '' : ' (inactief)'}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label={`${label}: prijs (euro)`}
                  htmlFor={id(`price-${audience}`)}
                  hint="Bv. 150 of 149,50. Leeg = “Prijs op aanvraag”."
                >
                  <Input
                    id={id(`price-${audience}`)}
                    name={`price:${audience}`}
                    inputMode="decimal"
                    defaultValue={centsToEuroInput(price(audience))}
                  />
                </Field>
                {bookingMode === 'direct' && service ? (
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    {service.providerCount > 0
                      ? `${service.providerCount === 1 ? '1 aanbieder biedt' : `${service.providerCount} aanbieders bieden`} ${service.name} aan.`
                      : `Nog geen aanbieder voor ${service.name}: deze variant is tijdelijk niet online te boeken. Aanbieders kiezen zelf wat ze aanbieden (Mijn agenda).`}
                    {audience === 'youth' && !service.requiresGuardian
                      ? ' Let op: deze dienst vraagt geen ouder of voogd.'
                      : ''}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        <StatusMessage state={state} />
        <div>
          <SubmitButton>Opslaan</SubmitButton>
        </div>
      </form>
    </section>
  );
}

function Radio({
  name,
  value,
  checked,
  onChange,
  label,
  hint,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="mt-0.5 size-4 accent-primary"
      />
      <span>
        <span className="font-medium">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}

'use client';

import { useActionState, useState } from 'react';

import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  ActionForm,
  CheckboxField,
  Field,
  SectionCard,
  StatusMessage,
  SubmitButton,
} from '@/components/admin/form';
import {
  centsToEuroInput,
  locationOptionLabel,
  type LocationOption,
} from '@/components/admin/booking-labels';
import { MediaPicker, type MediaOption } from '@/components/admin/media-picker';
import { deleteOfferingAction, saveOfferingAction } from '@/lib/cms/actions/offerings';
import { IDLE_STATE } from '@/lib/cms/actions/state';
import { OFFER_CATEGORIES, OFFER_CATEGORY_LABELS, OFFER_CTA_LABEL } from '@/lib/offers/catalogue';
import {
  AUDIENCE_LABELS,
  audiencesFor,
  type OfferingAudience,
  type OfferingBookingMode,
  type OfferingVariantMode,
} from '@/lib/offers/offering';
import type { OfferingContent } from '@/lib/offers/offering-content';

/** One variant as the form shows it: the stored price and its service's facts. */
export type OfferingFormVariant = {
  audience: OfferingAudience;
  serviceId: string | null;
  priceCents: number | null;
  durationMinutes: number | null;
  bufferAfterMinutes: number | null;
  locationId: string | null;
  requiresGuardian: boolean;
  providerNames: string[];
};

export type OfferingFormValues = {
  id: string | null;
  content: OfferingContent;
  isListed: boolean;
  bookingMode: OfferingBookingMode;
  variantMode: OfferingVariantMode;
  variants: OfferingFormVariant[];
};

/**
 * Beheer → Aanbod: one form for everything about an offering — the text a
 * visitor reads, whether it is shown, how it is booked, and per variant the
 * booking facts (duration, buffer, location, guardian rule) and the price.
 * Saving writes the offering and its booking services in one go
 * (`src/lib/offers/repo.ts`); who offers a variant stays the providers' own
 * choice (Mijn agenda → Mijn aanbod). The server action is the boundary
 * (`offering.manage`); this form only explains.
 */
export function OfferingForm({
  offering,
  locations,
  media,
  defaultBuffer,
}: {
  offering: OfferingFormValues;
  locations: LocationOption[];
  media: MediaOption[];
  defaultBuffer: number;
}) {
  const [state, formAction] = useActionState(saveOfferingAction, IDLE_STATE);
  const [variantMode, setVariantMode] = useState<OfferingVariantMode>(offering.variantMode);
  const [bookingMode, setBookingMode] = useState<OfferingBookingMode>(offering.bookingMode);
  const { content } = offering;
  const id = (name: string) => `offering-${name}`;
  const variant = (audience: OfferingAudience) =>
    offering.variants.find((entry) => entry.audience === audience) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="offeringId" value={offering.id ?? ''} />

        <SectionCard
          title="Tekst"
          description="Wat de bezoeker leest op /aanbod en op de eigen pagina van dit aanbod."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Titel" htmlFor={id('title')}>
              <Input id={id('title')} name="title" defaultValue={content.title} required />
            </Field>
            <Field
              label="Slug"
              htmlFor={id('slug')}
              hint="Het laatste deel van het webadres (/aanbod/…). Leeg laten om hem uit de titel af te leiden."
            >
              <Input
                id={id('slug')}
                name="slug"
                defaultValue={content.slug}
                placeholder="bikefit-huidige-fiets"
              />
            </Field>
            <Field label="Categorie" htmlFor={id('category')}>
              <Select id={id('category')} name="category" defaultValue={content.category}>
                {OFFER_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {OFFER_CATEGORY_LABELS[category]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Volgorde"
              htmlFor={id('sortOrder')}
              hint="Binnen de categorie; lager staat eerst."
            >
              <Input
                id={id('sortOrder')}
                name="sortOrder"
                type="number"
                min={0}
                max={999}
                defaultValue={content.sortOrder}
              />
            </Field>
          </div>
          <div className="mt-3 flex flex-col gap-3">
            <Field
              label="Korte omschrijving"
              htmlFor={id('summary')}
              hint="Eén of twee zinnen op de kaart in het overzicht. Leeg = de inleiding."
            >
              <Textarea id={id('summary')} name="summary" rows={2} defaultValue={content.summary} />
            </Field>
            <Field label="Inleiding" htmlFor={id('intro')}>
              <Textarea id={id('intro')} name="intro" rows={3} defaultValue={content.intro} />
            </Field>
            <Field label="Doel" htmlFor={id('goal')}>
              <Textarea id={id('goal')} name="goal" rows={2} defaultValue={content.goal} />
            </Field>
            <Field label="Inhoud" htmlFor={id('contents')} hint="Eén punt per regel.">
              <Textarea
                id={id('contents')}
                name="contents"
                rows={5}
                defaultValue={content.contents.join('\n')}
              />
            </Field>
            <Field label="Mogelijke extra’s" htmlFor={id('extras')} hint="Eén per regel.">
              <Textarea
                id={id('extras')}
                name="extras"
                rows={3}
                defaultValue={content.extras.join('\n')}
              />
            </Field>
            <Field label="Uitleg bij de extra’s" htmlFor={id('extrasNote')}>
              <Input id={id('extrasNote')} name="extrasNote" defaultValue={content.extrasNote} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Tekst van de boekknop"
                htmlFor={id('ctaLabel')}
                hint={`Leeg = “${OFFER_CTA_LABEL}”.`}
              >
                <Input id={id('ctaLabel')} name="ctaLabel" defaultValue={content.ctaLabel} />
              </Field>
              <Field
                label="Meta description"
                htmlFor={id('metaDescription')}
                hint="Voor zoekmachines; leeg = de korte omschrijving."
              >
                <Input
                  id={id('metaDescription')}
                  name="metaDescription"
                  defaultValue={content.metaDescription}
                  maxLength={320}
                />
              </Field>
            </div>
            <Field
              label="Afbeelding"
              hint={
                content.image.url && !content.image.mediaId
                  ? `Nu: ${content.image.url} (tijdelijk beeld). Kies een eigen foto om het te vervangen.`
                  : 'Een eigen foto uit Media; mag leeg blijven.'
              }
            >
              <input type="hidden" name="imageUrl" value={content.image.url ?? ''} />
              <MediaPicker
                value={content.image.mediaId}
                name="imageMediaId"
                media={media}
                emptyLabel="Geen afbeelding gekozen"
              />
            </Field>
            <Field label="Alt-tekst van de afbeelding" htmlFor={id('imageAlt')}>
              <Input id={id('imageAlt')} name="imageAlt" defaultValue={content.image.alt} />
            </Field>
          </div>
        </SectionCard>

        <SectionCard
          title="Tonen en boeken"
          description="Of dit aanbod op de website staat, en hoe een bezoeker het boekt."
        >
          <div className="flex flex-col gap-4">
            <CheckboxField
              name="isListed"
              label="Tonen op de website"
              defaultChecked={offering.isListed}
              hint="In de overzichten (Aanbod, home, Bikefit), op de eigen pagina en op de afspraakpagina. Uit = niet te zien en niet te boeken; de tekst blijft bewaard."
            />
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
                hint="Elk met een eigen duur, ouderregel en prijs."
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
                hint="De knop gaat naar /afspraak met enkel de varianten hieronder. Zonder aanbieder voor een variant staat het aanbod grijs: “tijdelijk niet online te boeken”."
              />
              <Radio
                name="bookingMode"
                value="enquiry"
                checked={bookingMode === 'enquiry'}
                onChange={() => setBookingMode('enquiry')}
                label="Enkel op aanvraag"
                hint="De pagina toont een aanvraagformulier; de aanvraag gaat naar de ontvanger uit Beheer → E-mail."
              />
            </fieldset>
            {bookingMode === 'enquiry' ? (
              <Field
                label="Duur (tekst)"
                htmlFor={id('duration')}
                hint="Vrije tekst voor aanbod op aanvraag, bv. “ongeveer 90 minuten”. Leeg = “Duur in overleg”."
              >
                <Input id={id('duration')} name="duration" defaultValue={content.duration} />
              </Field>
            ) : (
              <input type="hidden" name="duration" value={content.duration} />
            )}
          </div>
        </SectionCard>

        <SectionCard
          title={variantMode === 'audience' ? 'Varianten' : 'Boeking'}
          description={
            bookingMode === 'direct'
              ? 'Per variant: hoe lang de afspraak duurt in de agenda, de buffer erna, de locatie, of een ouder of voogd verplicht is, en de prijs. Aanbieders kiezen zelf wat ze aanbieden (Mijn agenda).'
              : 'Op aanvraag: enkel de prijs telt. Een ingevulde duur wordt bewaard voor als je later rechtstreeks online boeken aanzet.'
          }
        >
          <div className="flex flex-col gap-3">
            {audiencesFor(variantMode).map((audience) => {
              const label = AUDIENCE_LABELS[audience] || 'Het aanbod';
              const current = variant(audience);
              return (
                <fieldset
                  key={audience}
                  className="grid gap-3 border border-border bg-background p-3 sm:grid-cols-2"
                >
                  <legend className="admin-label px-1 text-xs text-muted-foreground">
                    {label}
                  </legend>
                  <input
                    type="hidden"
                    name={`serviceId:${audience}`}
                    value={current?.serviceId ?? ''}
                  />
                  <Field
                    label="Duur in de agenda (minuten)"
                    htmlFor={id(`duration-${audience}`)}
                    hint={bookingMode === 'direct' ? 'Verplicht om online te boeken.' : undefined}
                  >
                    <Input
                      id={id(`duration-${audience}`)}
                      name={`duration:${audience}`}
                      type="number"
                      min={5}
                      max={720}
                      step={5}
                      defaultValue={
                        current?.durationMinutes ?? (bookingMode === 'direct' ? 60 : '')
                      }
                      required={bookingMode === 'direct'}
                    />
                  </Field>
                  <Field
                    label="Buffer na afloop (minuten)"
                    htmlFor={id(`buffer-${audience}`)}
                    hint={`Leeg = standaard uit de instellingen (${defaultBuffer} min).`}
                  >
                    <Input
                      id={id(`buffer-${audience}`)}
                      name={`buffer:${audience}`}
                      type="number"
                      min={0}
                      max={240}
                      step={5}
                      defaultValue={current?.bufferAfterMinutes ?? ''}
                    />
                  </Field>
                  <Field
                    label="Locatie"
                    htmlFor={id(`location-${audience}`)}
                    hint="Leeg = de standaardlocatie van de aanbieder."
                  >
                    <Select
                      id={id(`location-${audience}`)}
                      name={`location:${audience}`}
                      defaultValue={current?.locationId ?? ''}
                    >
                      <option value="">Standaardlocatie van de aanbieder</option>
                      {locations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {locationOptionLabel(location)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field
                    label="Prijs (euro)"
                    htmlFor={id(`price-${audience}`)}
                    hint="Bv. 150 of 149,50. Leeg = “Prijs op aanvraag”."
                  >
                    <Input
                      id={id(`price-${audience}`)}
                      name={`price:${audience}`}
                      inputMode="decimal"
                      defaultValue={centsToEuroInput(current?.priceCents ?? null)}
                    />
                  </Field>
                  <div className="sm:col-span-2">
                    <CheckboxField
                      name={`guardian:${audience}`}
                      label="Ouder of voogd verplicht"
                      defaultChecked={current?.requiresGuardian ?? audience === 'youth'}
                      hint="Het boekingsformulier vraagt dan de gegevens van een ouder."
                    />
                  </div>
                  {bookingMode === 'direct' && current?.serviceId ? (
                    <p className="text-xs text-muted-foreground sm:col-span-2">
                      {current.providerNames.length > 0
                        ? `Aangeboden door ${current.providerNames.join(', ')}.`
                        : 'Nog geen aanbieder: deze variant is tijdelijk niet online te boeken. Aanbieders vinken dit zelf aan onder Mijn agenda → Mijn aanbod.'}
                    </p>
                  ) : bookingMode === 'direct' ? (
                    <p className="text-xs text-muted-foreground sm:col-span-2">
                      Na het opslaan kunnen aanbieders deze variant aanvinken onder Mijn agenda →
                      Mijn aanbod.
                    </p>
                  ) : null}
                </fieldset>
              );
            })}
          </div>
        </SectionCard>

        <StatusMessage state={state} />
        <div>
          <SubmitButton size="lg">{offering.id ? 'Opslaan' : 'Aanbod aanmaken'}</SubmitButton>
        </div>
      </form>

      {offering.id ? (
        <SectionCard
          title="Verwijderen"
          description="Verwijdert dit aanbod van de website en uit het beheer. De diensten erachter worden inactief; bestaande afspraken blijven staan."
        >
          <ActionForm
            action={deleteOfferingAction}
            hidden={{ offeringId: offering.id }}
            className="max-w-sm"
          >
            <Field
              label="Aanbod verwijderen"
              htmlFor={id('confirm')}
              hint="Typ VERWIJDER om te bevestigen."
            >
              <Input id={id('confirm')} name="confirm" placeholder="VERWIJDER" />
            </Field>
            <div>
              <SubmitButton variant="destructive" confirm="Aanbod definitief verwijderen?">
                Definitief verwijderen
              </SubmitButton>
            </div>
          </ActionForm>
        </SectionCard>
      ) : null}
    </div>
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

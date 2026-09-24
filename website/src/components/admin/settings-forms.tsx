'use client';

import { useActionState } from 'react';

import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  CheckboxField,
  Field,
  SectionCard,
  StatusMessage,
  SubmitButton,
} from '@/components/admin/form';
import { MediaPicker, type MediaOption } from '@/components/admin/media-picker';
import { updateSettingAction } from '@/lib/cms/actions/settings';
import { IDLE_STATE } from '@/lib/cms/actions/state';
import type { SiteSettingKey, SiteSettings } from '@/lib/cms/blocks';

/** Site settings, one form (and one `cms_site_settings` row) per key. */
export function SettingsForms({
  settings,
  locale,
  media,
  canEdit,
}: {
  settings: SiteSettings;
  locale: string;
  media: MediaOption[];
  canEdit: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <SettingForm
        settingKey="site"
        locale={locale}
        canEdit={canEdit}
        title="Site"
        description="Naam en positionering van de studio."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Naam" htmlFor="site-name">
            <Input id="site-name" name="name" defaultValue={settings.site.name} />
          </Field>
          <Field label="Tagline" htmlFor="site-tagline">
            <Input id="site-tagline" name="tagline" defaultValue={settings.site.tagline} />
          </Field>
          <Field label="Strapline" htmlFor="site-strapline">
            <Input id="site-strapline" name="strapline" defaultValue={settings.site.strapline} />
          </Field>
        </div>
        <Field label="Missie" htmlFor="site-mission" className="mt-3">
          <Textarea
            id="site-mission"
            name="mission"
            rows={3}
            defaultValue={settings.site.mission}
          />
        </Field>
        <Field label="Logo" className="mt-3">
          <MediaPicker
            value={settings.site.logoMediaId}
            name="logoMediaId"
            media={media}
            emptyLabel="Geen logo gekozen"
          />
        </Field>
      </SettingForm>

      <SettingForm
        settingKey="contact"
        locale={locale}
        canEdit={canEdit}
        title="Contact"
        description="Gebruikt in de footer en in de LocalBusiness structured data."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Telefoon (label)" htmlFor="contact-phoneLabel">
            <Input
              id="contact-phoneLabel"
              name="phoneLabel"
              defaultValue={settings.contact.phoneLabel}
            />
          </Field>
          <Field label="Telefoon (link)" htmlFor="contact-phoneHref" hint="Bv. tel:+32473952633">
            <Input
              id="contact-phoneHref"
              name="phoneHref"
              defaultValue={settings.contact.phoneHref}
            />
          </Field>
          <Field label="E-mail" htmlFor="contact-email">
            <Input id="contact-email" name="email" defaultValue={settings.contact.email} />
          </Field>
          <Field label="Website" htmlFor="contact-website">
            <Input id="contact-website" name="website" defaultValue={settings.contact.website} />
          </Field>
          <Field label="Postcode" htmlFor="contact-postalCode">
            <Input
              id="contact-postalCode"
              name="postalCode"
              defaultValue={settings.contact.postalCode}
            />
          </Field>
          <Field label="Gemeente" htmlFor="contact-city">
            <Input id="contact-city" name="city" defaultValue={settings.contact.city} />
          </Field>
          <Field label="Land" htmlFor="contact-country">
            <Input id="contact-country" name="country" defaultValue={settings.contact.country} />
          </Field>
          <Field label="Openingsuren" htmlFor="contact-hours">
            <Input id="contact-hours" name="hours" defaultValue={settings.contact.hours} />
          </Field>
        </div>
        <Field
          label="Adresregels"
          htmlFor="contact-addressLines"
          hint="Eén regel per lijn."
          className="mt-3"
        >
          <Textarea
            id="contact-addressLines"
            name="addressLines"
            rows={3}
            defaultValue={settings.contact.addressLines.join('\n')}
          />
        </Field>
      </SettingForm>

      <SettingForm
        settingKey="seo"
        locale={locale}
        canEdit={canEdit}
        title="SEO"
        description="Standaardwaarden voor pagina’s die zelf niets invullen."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Standaard meta titel" htmlFor="seo-defaultMetaTitle">
            <Input
              id="seo-defaultMetaTitle"
              name="defaultMetaTitle"
              defaultValue={settings.seo.defaultMetaTitle}
            />
          </Field>
          <Field
            label="Titelsjabloon"
            htmlFor="seo-titleTemplate"
            hint="%s wordt vervangen door de paginatitel."
          >
            <Input
              id="seo-titleTemplate"
              name="titleTemplate"
              defaultValue={settings.seo.titleTemplate}
            />
          </Field>
        </div>
        <Field
          label="Standaard meta omschrijving"
          htmlFor="seo-defaultMetaDescription"
          className="mt-3"
        >
          <Textarea
            id="seo-defaultMetaDescription"
            name="defaultMetaDescription"
            rows={3}
            defaultValue={settings.seo.defaultMetaDescription}
          />
        </Field>
        <Field label="Standaard OG-afbeelding" className="mt-3">
          <MediaPicker
            value={settings.seo.defaultOgImageMediaId}
            name="defaultOgImageMediaId"
            media={media}
            emptyLabel="Geen standaardafbeelding"
          />
        </Field>
        <div className="mt-3">
          <CheckboxField
            name="allowIndexing"
            label="Indexeren toestaan"
            defaultChecked={settings.seo.allowIndexing}
            hint="Uit op staging: robots.txt blokkeert dan alles."
          />
        </div>
      </SettingForm>

      <SettingForm
        settingKey="organization"
        locale={locale}
        canEdit={canEdit}
        title="Organisatie (JSON-LD)"
        description="Bron voor de Organization / LocalBusiness structured data."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="schema.org type" htmlFor="org-type">
            <Input id="org-type" name="type" defaultValue={settings.organization.type} />
          </Field>
          <Field label="Juridische naam" htmlFor="org-legalName">
            <Input
              id="org-legalName"
              name="legalName"
              defaultValue={settings.organization.legalName}
            />
          </Field>
          <Field label="Btw-nummer" htmlFor="org-vatNumber">
            <Input
              id="org-vatNumber"
              name="vatNumber"
              defaultValue={settings.organization.vatNumber}
            />
          </Field>
          <Field label="Prijsklasse" htmlFor="org-priceRange" hint="Bv. €€">
            <Input
              id="org-priceRange"
              name="priceRange"
              defaultValue={settings.organization.priceRange}
            />
          </Field>
          <Field label="Breedtegraad" htmlFor="org-latitude">
            <Input
              id="org-latitude"
              name="latitude"
              defaultValue={settings.organization.latitude ?? ''}
            />
          </Field>
          <Field label="Lengtegraad" htmlFor="org-longitude">
            <Input
              id="org-longitude"
              name="longitude"
              defaultValue={settings.organization.longitude ?? ''}
            />
          </Field>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="sameAs (profielen)" htmlFor="org-sameAs" hint="Eén URL per regel.">
            <Textarea
              id="org-sameAs"
              name="sameAs"
              rows={3}
              defaultValue={settings.organization.sameAs.join('\n')}
            />
          </Field>
          <Field label="Werkgebied" htmlFor="org-areaServed" hint="Eén plaats per regel.">
            <Textarea
              id="org-areaServed"
              name="areaServed"
              rows={3}
              defaultValue={settings.organization.areaServed.join('\n')}
            />
          </Field>
        </div>
      </SettingForm>

      <SettingForm
        settingKey="booking"
        locale={locale}
        canEdit={canEdit}
        title="Afspraken"
        description="Regels voor de online agenda op /afspraak. Tijden worden berekend in de tijdzone hieronder."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Tijdsraster (minuten)"
            htmlFor="booking-slotStepMinutes"
            hint="Om de hoeveel minuten een afspraak kan starten. Standaard 30."
          >
            <Input
              id="booking-slotStepMinutes"
              name="slotStepMinutes"
              type="number"
              min={5}
              max={240}
              step={5}
              defaultValue={settings.booking.slotStepMinutes}
            />
          </Field>
          <Field
            label="Minimale termijn vooraf (uren)"
            htmlFor="booking-minNoticeHours"
            hint="Hoeveel uur op voorhand een klant ten laatste kan boeken. Standaard 24."
          >
            <Input
              id="booking-minNoticeHours"
              name="minNoticeHours"
              type="number"
              min={0}
              max={1440}
              defaultValue={settings.booking.minNoticeHours}
            />
          </Field>
          <Field
            label="Boekingshorizon (dagen)"
            htmlFor="booking-horizonDays"
            hint="Hoe ver vooruit klanten kunnen boeken. Standaard 56 (8 weken)."
          >
            <Input
              id="booking-horizonDays"
              name="horizonDays"
              type="number"
              min={1}
              max={730}
              defaultValue={settings.booking.horizonDays}
            />
          </Field>
          <Field
            label="Standaard buffer na een afspraak (minuten)"
            htmlFor="booking-defaultBufferAfterMinutes"
            hint="Geldt voor diensten zonder eigen buffer. Standaard 15."
          >
            <Input
              id="booking-defaultBufferAfterMinutes"
              name="defaultBufferAfterMinutes"
              type="number"
              min={0}
              max={240}
              defaultValue={settings.booking.defaultBufferAfterMinutes}
            />
          </Field>
          <Field
            label="Annuleren via link tot (uren vooraf)"
            htmlFor="booking-cancelUntilHours"
            hint="Daarna kan de klant niet meer zelf annuleren. Standaard 48."
          >
            <Input
              id="booking-cancelUntilHours"
              name="cancelUntilHours"
              type="number"
              min={0}
              max={1440}
              defaultValue={settings.booking.cancelUntilHours}
            />
          </Field>
          <Field
            label="Tijdzone"
            htmlFor="booking-timezone"
            hint="IANA-naam. Laat op Europe/Brussels tenzij je weet wat je doet."
          >
            <Input id="booking-timezone" name="timezone" defaultValue={settings.booking.timezone} />
          </Field>
          <Field
            label="Titel boekingspagina"
            htmlFor="booking-introTitle"
            hint="Leeg laten zet “Maak een afspraak” terug."
          >
            <Input
              id="booking-introTitle"
              name="introTitle"
              defaultValue={settings.booking.introTitle}
            />
          </Field>
        </div>
        <Field
          label="Introductietekst"
          htmlFor="booking-introText"
          hint="Korte uitleg boven de agenda. Mag leeg blijven."
          className="mt-3"
        >
          <Textarea
            id="booking-introText"
            name="introText"
            rows={3}
            defaultValue={settings.booking.introText}
          />
        </Field>
        <Field
          label="Bevestigingstekst"
          htmlFor="booking-confirmationText"
          hint="Getoond na een geslaagde boeking. Leeg laten zet de standaardtekst terug."
          className="mt-3"
        >
          <Textarea
            id="booking-confirmationText"
            name="confirmationText"
            rows={3}
            defaultValue={settings.booking.confirmationText}
          />
        </Field>
        <div className="mt-3">
          <CheckboxField
            name="showProviderChoice"
            label="Klant kan een aanbieder kiezen"
            defaultChecked={settings.booking.showProviderChoice}
            hint="Uit: de klant kiest enkel een dienst en krijgt de eerste vrije aanbieder."
          />
        </div>
      </SettingForm>

      <SettingForm
        settingKey="analytics"
        locale={locale}
        canEdit={canEdit}
        title="Analytics"
        description="GA4 laadt pas als analytics hier ingeschakeld is, de meet-ID in Vercel staat (NEXT_PUBLIC_GA4_MEASUREMENT_ID) én de bezoeker via de cookiebanner toestemming gaf."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="GA4 measurement id"
            htmlFor="analytics-ga4"
            hint="Ter referentie. Het script gebruikt de omgevingsvariabele NEXT_PUBLIC_GA4_MEASUREMENT_ID."
          >
            <Input
              id="analytics-ga4"
              name="ga4MeasurementId"
              placeholder="G-XXXXXXX"
              defaultValue={settings.analytics.ga4MeasurementId}
            />
          </Field>
          <Field
            label="GA4 property id"
            htmlFor="analytics-ga4PropertyId"
            hint="Numeriek id (bv. 123456789) voor de cijfers op het dashboard. De omgevingsvariabele GA4_PROPERTY_ID heeft voorrang."
          >
            <Input
              id="analytics-ga4PropertyId"
              name="ga4PropertyId"
              inputMode="numeric"
              placeholder="123456789"
              defaultValue={settings.analytics.ga4PropertyId}
            />
          </Field>
        </div>
        <div className="mt-3">
          <CheckboxField
            name="enabled"
            label="Analytics ingeschakeld"
            defaultChecked={settings.analytics.enabled}
            hint="Uit: er wordt geen trackingscript en geen analytics-cookie geladen, ook niet na toestemming."
          />
        </div>
      </SettingForm>
    </div>
  );
}

function SettingForm({
  settingKey,
  locale,
  title,
  description,
  canEdit,
  children,
}: {
  settingKey: SiteSettingKey;
  locale: string;
  title: string;
  description: string;
  canEdit: boolean;
  children: React.ReactNode;
}) {
  const [state, formAction] = useActionState(updateSettingAction, IDLE_STATE);

  return (
    <SectionCard title={title} description={description}>
      <form action={formAction} className="flex flex-col gap-2">
        <input type="hidden" name="key" value={settingKey} />
        <input type="hidden" name="locale" value={locale} />
        {children}
        <StatusMessage state={state} />
        {canEdit ? (
          <div className="mt-1 flex justify-end">
            <SubmitButton>Opslaan</SubmitButton>
          </div>
        ) : null}
      </form>
    </SectionCard>
  );
}

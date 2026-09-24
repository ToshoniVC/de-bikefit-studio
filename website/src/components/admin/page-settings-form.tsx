'use client';

import { useActionState } from 'react';

import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { CheckboxField, Field, SectionCard, StatusMessage, SubmitButton } from '@/components/admin/form';
import { MediaPicker, type MediaOption } from '@/components/admin/media-picker';
import { PAGE_KINDS } from '@/components/admin/page-create-form';
import { updatePageAction } from '@/lib/cms/actions/pages';
import { IDLE_STATE } from '@/lib/cms/actions/state';
import { STRUCTURED_DATA_TYPES } from '@/lib/cms/blocks';

export type PageFormValues = {
  id: string;
  slug: string;
  title: string;
  kind: string;
  translationGroup: string;
  metaTitle: string | null;
  metaDescription: string | null;
  canonicalOverride: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImageMediaId: string | null;
  noIndex: boolean;
  structuredDataType: string | null;
  structuredDataOverrides: Record<string, unknown> | null;
};

/** Page metadata + the whole SEO panel. Empty field means empty, not "keep". */
export function PageSettingsForm({
  page,
  media,
  canEdit,
}: {
  page: PageFormValues;
  media: MediaOption[];
  canEdit: boolean;
}) {
  const [state, formAction] = useActionState(updatePageAction, IDLE_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="pageId" value={page.id} />

      <SectionCard title="Pagina" description="Titel, pad en template.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Titel" htmlFor="title">
            <Input id="title" name="title" defaultValue={page.title} required />
          </Field>
          <Field label="Pad (slug)" htmlFor="slug" hint="Leeg = homepagina.">
            <Input id="slug" name="slug" defaultValue={page.slug} />
          </Field>
          <Field label="Template" htmlFor="kind">
            <Select id="kind" name="kind" defaultValue={page.kind}>
              {PAGE_KINDS.some((kind) => kind.value === page.kind) ? null : (
                <option value={page.kind}>{page.kind}</option>
              )}
              {PAGE_KINDS.map((kind) => (
                <option key={kind.value} value={kind.value}>
                  {kind.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Vertaalgroep" htmlFor="translationGroup">
            <Input
              id="translationGroup"
              name="translationGroup"
              defaultValue={page.translationGroup}
            />
          </Field>
        </div>
      </SectionCard>

      <SectionCard
        title="SEO"
        description="Leeg laten betekent: de standaardwaarden uit de site-instellingen gebruiken."
      >
        <div className="flex flex-col gap-3">
          <Field label="Meta titel" htmlFor="metaTitle">
            <Input id="metaTitle" name="metaTitle" defaultValue={page.metaTitle ?? ''} />
          </Field>
          <Field label="Meta omschrijving" htmlFor="metaDescription">
            <Textarea
              id="metaDescription"
              name="metaDescription"
              rows={3}
              defaultValue={page.metaDescription ?? ''}
            />
          </Field>
          <Field
            label="Canonical (override)"
            htmlFor="canonicalOverride"
            hint="Volledige URL of pad. Leeg = automatisch."
          >
            <Input
              id="canonicalOverride"
              name="canonicalOverride"
              defaultValue={page.canonicalOverride ?? ''}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="OG titel" htmlFor="ogTitle">
              <Input id="ogTitle" name="ogTitle" defaultValue={page.ogTitle ?? ''} />
            </Field>
            <Field label="OG omschrijving" htmlFor="ogDescription">
              <Input
                id="ogDescription"
                name="ogDescription"
                defaultValue={page.ogDescription ?? ''}
              />
            </Field>
          </div>

          <Field label="OG afbeelding">
            <MediaPicker
              value={page.ogImageMediaId}
              name="ogImageMediaId"
              media={media}
              emptyLabel="Standaard OG-afbeelding gebruiken"
            />
          </Field>

          <CheckboxField
            name="noIndex"
            label="noindex"
            defaultChecked={page.noIndex}
            hint="Zoekmachines vragen deze pagina niet te indexeren."
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Structured data" htmlFor="structuredDataType">
              <Select
                id="structuredDataType"
                name="structuredDataType"
                defaultValue={page.structuredDataType ?? ''}
              >
                <option value="">— geen —</option>
                {STRUCTURED_DATA_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Structured data — overrides"
              htmlFor="structuredDataOverrides"
              hint="JSON-object; leeg laten als je niets wil overschrijven."
            >
              <Textarea
                id="structuredDataOverrides"
                name="structuredDataOverrides"
                rows={3}
                className="font-mono text-xs"
                defaultValue={
                  page.structuredDataOverrides
                    ? JSON.stringify(page.structuredDataOverrides, null, 2)
                    : ''
                }
              />
            </Field>
          </div>
        </div>
      </SectionCard>

      <StatusMessage state={state} />

      {canEdit ? (
        <div className="flex justify-end">
          <SubmitButton size="lg">Opslaan</SubmitButton>
        </div>
      ) : null}
    </form>
  );
}

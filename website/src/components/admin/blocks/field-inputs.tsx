'use client';

import { createContext, use, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { MediaPicker, type MediaOption } from '@/components/admin/media-picker';
import { defaultValueFor, type FieldSpec } from './field-spec';
import { hasRichMarkup, htmlToPlainText, plainTextToHtml } from '@/lib/cms/rich-text-plain';

/**
 * Renders one generated field. Everything is local component state; the block
 * editor serialises the whole block to JSON when you press "Blok opslaan", and
 * the server validates it against the same zod schema the spec came from.
 */

type Props = {
  spec: FieldSpec;
  value: unknown;
  onChange: (value: unknown) => void;
  media: MediaOption[];
  id: string;
};

export type BlockServiceOption = { id: string; name: string; isActive: boolean };

/**
 * Booking services for the `serviceIds` field of the `booking` block. Provided
 * by `BlockEditor`; empty (no `service.read`, or no services yet) falls back to
 * the plain one-id-per-line textarea.
 */
export const BlockServicesContext = createContext<BlockServiceOption[]>([]);

const asString = (value: unknown) => (typeof value === 'string' ? value : '');
const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export function FieldInput({ spec, value, onChange, media, id }: Props) {
  switch (spec.kind) {
    case 'text':
      return (
        <LabelledField label={spec.label} htmlFor={id}>
          {spec.multiline ? (
            <Textarea
              id={id}
              rows={3}
              value={asString(value)}
              onChange={(event) => onChange(event.target.value)}
            />
          ) : (
            <Input
              id={id}
              value={asString(value)}
              onChange={(event) => onChange(event.target.value)}
            />
          )}
        </LabelledField>
      );

    case 'richText':
      return <RichTextField spec={spec} value={value} onChange={onChange} id={id} />;

    case 'number':
      return (
        <LabelledField label={spec.label} htmlFor={id}>
          <Input
            id={id}
            type="number"
            step={spec.integer ? 1 : 'any'}
            value={typeof value === 'number' ? String(value) : ''}
            onChange={(event) => {
              const raw = event.target.value;
              if (raw === '') return onChange(spec.nullable ? null : 0);
              const parsed = Number(raw);
              onChange(Number.isFinite(parsed) ? parsed : spec.nullable ? null : 0);
            }}
          />
        </LabelledField>
      );

    case 'boolean':
      return (
        <label className="flex items-center gap-2 py-1 text-sm">
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            onChange={(event) => onChange(event.target.checked)}
            className="size-4 rounded border-input accent-primary"
          />
          <span className="font-medium">{spec.label}</span>
        </label>
      );

    case 'enum':
      return (
        <LabelledField label={spec.label} htmlFor={id}>
          <Select
            id={id}
            value={value === null || value === undefined ? '' : String(value)}
            onChange={(event) =>
              onChange(spec.numeric ? Number(event.target.value) : event.target.value)
            }
          >
            {spec.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </LabelledField>
      );

    case 'textList':
      if (spec.name === 'serviceIds') {
        return <ServiceIdsField spec={spec} value={value} onChange={onChange} id={id} />;
      }
      return <TextListField spec={spec} value={value} onChange={onChange} id={id} />;

    case 'image':
      return <ImageField spec={spec} value={value} onChange={onChange} media={media} id={id} />;

    case 'link':
      return <LinkField spec={spec} value={value} onChange={onChange} id={id} />;

    case 'object':
      return (
        <fieldset className="border border-border p-3">
          <legend className="admin-label px-1 text-xs text-muted-foreground">{spec.label}</legend>
          <div className="flex flex-col gap-2">
            {spec.fields.map((child) => (
              <FieldInput
                key={child.name}
                spec={child}
                value={asRecord(value)[child.name]}
                onChange={(next) => onChange({ ...asRecord(value), [child.name]: next })}
                media={media}
                id={`${id}-${child.name}`}
              />
            ))}
          </div>
        </fieldset>
      );

    case 'objectList':
      return (
        <ObjectListField spec={spec} value={value} onChange={onChange} media={media} id={id} />
      );

    case 'json':
      return <JsonField spec={spec} value={value} onChange={onChange} id={id} />;
  }
}

function LabelledField({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const RICH_TEXT_HINT_TEXT =
  'Gewone tekst. Eén lege regel begint een nieuwe alinea; HTML wordt niet overgenomen.';
const RICH_TEXT_HINT_HTML =
  'HTML-bron. Toegestaan: p, br, h2, h3, h4, ul, ol, li, a, strong, em, blockquote. Al de rest wordt bij het opslaan verwijderd.';

/**
 * Not a WYSIWYG. Two modes, one stored value (HTML):
 *  - "Tekst": the textarea holds plain text; the stored value is escaped `<p>`
 *    HTML rebuilt from it. Good for ordinary paragraphs.
 *  - "HTML": the textarea holds the HTML source itself. Needed for pages such as
 *    the privacy statement and the terms, which use headings, lists and links.
 * A block whose stored HTML already uses more than `<p>`/`<br>` opens in HTML
 * mode, so saving it never flattens it. Either way the server passes the value
 * through the allowlist sanitiser before it is stored.
 */
function RichTextField({
  spec,
  value,
  onChange,
  id,
}: {
  spec: Extract<FieldSpec, { kind: 'richText' }>;
  value: unknown;
  onChange: (value: unknown) => void;
  id: string;
}) {
  const initialHtml = asString(value);
  const [mode, setMode] = useState<'text' | 'html'>(() =>
    hasRichMarkup(initialHtml) ? 'html' : 'text',
  );
  const [text, setText] = useState(() => htmlToPlainText(initialHtml));
  const [html, setHtml] = useState(initialHtml);

  const switchTo = (next: 'text' | 'html') => {
    if (next === mode) return;
    if (next === 'html') {
      // Plain text → its `<p>` HTML, so nothing typed so far is lost.
      const fromText = plainTextToHtml(text);
      setHtml(fromText);
      onChange(fromText);
    } else {
      if (
        hasRichMarkup(html) &&
        !window.confirm(
          'Overschakelen naar gewone tekst verwijdert koppen, lijsten en links uit dit blok. Doorgaan?',
        )
      ) {
        return;
      }
      const fromHtml = htmlToPlainText(html);
      setText(fromHtml);
      onChange(plainTextToHtml(fromHtml));
    }
    setMode(next);
  };

  const modeButton = (target: 'text' | 'html', label: string) => (
    <Button
      type="button"
      size="sm"
      variant={mode === target ? 'default' : 'outline'}
      aria-pressed={mode === target}
      onClick={() => switchTo(target)}
    >
      {label}
    </Button>
  );

  return (
    <LabelledField
      label={spec.label}
      htmlFor={id}
      hint={mode === 'html' ? RICH_TEXT_HINT_HTML : RICH_TEXT_HINT_TEXT}
    >
      <div className="flex items-center gap-2" role="group" aria-label="Bewerkmodus">
        {modeButton('text', 'Tekst')}
        {modeButton('html', 'HTML')}
      </div>
      {mode === 'html' ? (
        <Textarea
          id={id}
          rows={16}
          spellCheck={false}
          className="font-mono text-xs"
          value={html}
          onChange={(event) => {
            setHtml(event.target.value);
            onChange(event.target.value);
          }}
        />
      ) : (
        <Textarea
          id={id}
          rows={8}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            onChange(plainTextToHtml(event.target.value));
          }}
        />
      )}
    </LabelledField>
  );
}

function TextListField({
  spec,
  value,
  onChange,
  id,
}: {
  spec: Extract<FieldSpec, { kind: 'textList' }>;
  value: unknown;
  onChange: (value: unknown) => void;
  id: string;
}) {
  const separator = spec.multiline ? '\n\n' : '\n';
  const [text, setText] = useState(() => asArray(value).map(String).join(separator));

  return (
    <LabelledField
      label={spec.label}
      htmlFor={id}
      hint={
        spec.multiline ? 'Eén item per alinea (scheid met een lege regel).' : 'Eén item per regel.'
      }
    >
      <Textarea
        id={id}
        rows={spec.multiline ? 6 : 4}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          onChange(
            event.target.value
              .split(spec.multiline ? /\n{2,}/ : '\n')
              .map((line) => line.trim())
              .filter(Boolean),
          );
        }}
      />
    </LabelledField>
  );
}

/** Checkbox list of booking services; nothing ticked = every active service. */
function ServiceIdsField({
  spec,
  value,
  onChange,
  id,
}: {
  spec: Extract<FieldSpec, { kind: 'textList' }>;
  value: unknown;
  onChange: (value: unknown) => void;
  id: string;
}) {
  const services = use(BlockServicesContext);
  if (services.length === 0) {
    return <TextListField spec={spec} value={value} onChange={onChange} id={id} />;
  }

  const selected = asArray(value).map(String);
  const known = new Set(services.map((service) => service.id));
  const unknown = selected.filter((serviceId) => !known.has(serviceId));
  const toggle = (serviceId: string, checked: boolean) =>
    onChange(
      checked
        ? [...selected.filter((existing) => existing !== serviceId), serviceId]
        : selected.filter((existing) => existing !== serviceId),
    );

  return (
    <fieldset className="border border-border p-3">
      <legend className="admin-label px-1 text-xs text-muted-foreground">Diensten</legend>
      <div className="flex flex-col gap-1.5">
        {services
          .filter((service) => service.isActive || selected.includes(service.id))
          .map((service) => (
            <label key={service.id} className="flex items-center gap-2 text-sm">
              <input
                id={`${id}-${service.id}`}
                type="checkbox"
                checked={selected.includes(service.id)}
                onChange={(event) => toggle(service.id, event.target.checked)}
                className="size-4 rounded border-input accent-primary"
              />
              <span>
                {service.name}
                {service.isActive ? '' : ' (inactief)'}
              </span>
            </label>
          ))}
        {unknown.map((serviceId) => (
          <label key={serviceId} className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked
              onChange={() => toggle(serviceId, false)}
              className="size-4 rounded border-input accent-primary"
            />
            <span>Onbekende dienst ({serviceId})</span>
          </label>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Niets aangevinkt = alle actieve diensten.
      </p>
    </fieldset>
  );
}

function ImageField({
  spec,
  value,
  onChange,
  media,
  id,
}: {
  spec: Extract<FieldSpec, { kind: 'image' }>;
  value: unknown;
  onChange: (value: unknown) => void;
  media: MediaOption[];
  id: string;
}) {
  const image = asRecord(value);
  const mediaId = typeof image.mediaId === 'string' ? image.mediaId : null;
  const patch = (partial: Record<string, unknown>) =>
    onChange({
      mediaId: null,
      url: null,
      alt: '',
      decorative: false,
      ...image,
      ...partial,
    });

  return (
    <fieldset className="border border-border p-3">
      <legend className="admin-label px-1 text-xs text-muted-foreground">{spec.label}</legend>
      <div className="flex flex-col gap-2">
        <MediaPicker value={mediaId} media={media} onChange={(next) => patch({ mediaId: next })} />
        <LabelledField label="Alt-tekst" htmlFor={`${id}-alt`}>
          <Input
            id={`${id}-alt`}
            value={asString(image.alt)}
            onChange={(event) => patch({ alt: event.target.value })}
          />
        </LabelledField>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={image.decorative === true}
            onChange={(event) => patch({ decorative: event.target.checked })}
            className="size-4 rounded border-input accent-primary"
          />
          <span>Decoratief (geen alt-tekst nodig)</span>
        </label>
      </div>
    </fieldset>
  );
}

function LinkField({
  spec,
  value,
  onChange,
  id,
}: {
  spec: Extract<FieldSpec, { kind: 'link' }>;
  value: unknown;
  onChange: (value: unknown) => void;
  id: string;
}) {
  const link = asRecord(value);
  const isEmpty = value === null || value === undefined;
  const patch = (partial: Record<string, unknown>) =>
    onChange({ label: '', href: '', external: false, ...link, ...partial });

  return (
    <fieldset className="border border-border p-3">
      <legend className="admin-label px-1 text-xs text-muted-foreground">{spec.label}</legend>

      {isEmpty ? (
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => onChange({ label: '', href: '', external: false })}
        >
          Knop toevoegen
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          <LabelledField label="Label" htmlFor={`${id}-label`}>
            <Input
              id={`${id}-label`}
              value={asString(link.label)}
              onChange={(event) => patch({ label: event.target.value })}
            />
          </LabelledField>
          <LabelledField
            label="Link"
            htmlFor={`${id}-href`}
            hint="Bv. /bikefit, #contact, tel:+32473952633 of https://…"
          >
            <Input
              id={`${id}-href`}
              value={asString(link.href)}
              onChange={(event) => patch({ href: event.target.value })}
            />
          </LabelledField>
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={link.external === true}
                onChange={(event) => patch({ external: event.target.checked })}
                className="size-4 rounded border-input accent-primary"
              />
              <span>Externe link</span>
            </label>
            {spec.nullable ? (
              <Button type="button" size="xs" variant="ghost" onClick={() => onChange(null)}>
                Knop verwijderen
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </fieldset>
  );
}

function ObjectListField({
  spec,
  value,
  onChange,
  media,
  id,
}: {
  spec: Extract<FieldSpec, { kind: 'objectList' }>;
  value: unknown;
  onChange: (value: unknown) => void;
  media: MediaOption[];
  id: string;
}) {
  const items = asArray(value);

  const replace = (index: number, item: unknown) =>
    onChange(items.map((existing, position) => (position === index ? item : existing)));

  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>{`${spec.label} (${items.length})`}</Label>
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => onChange([...items, structuredClone(spec.defaultItem)])}
        >
          + Toevoegen
        </Button>
      </div>

      {items.map((item, index) => (
        <div key={index} className="border border-border bg-background p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="admin-label text-xs text-muted-foreground">
              {index + 1} / {items.length}
            </span>
            <div className="flex gap-1">
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="Omhoog"
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                ↑
              </Button>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="Omlaag"
                disabled={index === items.length - 1}
                onClick={() => move(index, 1)}
              >
                ↓
              </Button>
              <Button
                type="button"
                size="xs"
                variant="destructive"
                onClick={() => onChange(items.filter((_, position) => position !== index))}
              >
                Verwijderen
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {spec.fields.map((child) => (
              <FieldInput
                key={child.name}
                spec={child}
                value={asRecord(item)[child.name] ?? defaultValueFor(child)}
                onChange={(next) => replace(index, { ...asRecord(item), [child.name]: next })}
                media={media}
                id={`${id}-${index}-${child.name}`}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function JsonField({
  spec,
  value,
  onChange,
  id,
}: {
  spec: Extract<FieldSpec, { kind: 'json' }>;
  value: unknown;
  onChange: (value: unknown) => void;
  id: string;
}) {
  const [text, setText] = useState(() =>
    value === undefined ? '' : JSON.stringify(value, null, 2),
  );
  const [invalid, setInvalid] = useState(false);

  return (
    <LabelledField
      label={`${spec.label} (JSON)`}
      htmlFor={id}
      hint={invalid ? 'Ongeldige JSON — de laatste geldige waarde blijft bewaard.' : undefined}
    >
      <Textarea
        id={id}
        rows={4}
        value={text}
        className="font-mono text-xs"
        onChange={(event) => {
          setText(event.target.value);
          if (event.target.value.trim() === '') {
            setInvalid(false);
            onChange(null);
            return;
          }
          try {
            onChange(JSON.parse(event.target.value));
            setInvalid(false);
          } catch {
            setInvalid(true);
          }
        }}
      />
    </LabelledField>
  );
}

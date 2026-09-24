'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { MediaPicker, type MediaOption } from '@/components/admin/media-picker';
import { defaultValueFor, type FieldSpec } from './field-spec';
import { htmlToPlainText, plainTextToHtml } from '@/lib/cms/actions/sanitize';

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
        <label className="flex items-center gap-2 py-1 text-xs">
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
      return <TextListField spec={spec} value={value} onChange={onChange} id={id} />;

    case 'image':
      return (
        <ImageField spec={spec} value={value} onChange={onChange} media={media} id={id} />
      );

    case 'link':
      return <LinkField spec={spec} value={value} onChange={onChange} id={id} />;

    case 'object':
      return (
        <fieldset className="rounded-lg border border-border p-2.5">
          <legend className="px-1 text-xs font-medium text-muted-foreground">{spec.label}</legend>
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
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * Plain paragraphs, not a WYSIWYG: the textarea holds text, the stored value is
 * escaped `<p>` HTML rebuilt from it. The server repeats the same rebuild, so
 * no markup can be smuggled in.
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
  const [text, setText] = useState(() => htmlToPlainText(asString(value)));

  return (
    <LabelledField
      label={spec.label}
      htmlFor={id}
      hint="Gewone tekst. Eén lege regel begint een nieuwe alinea; HTML wordt niet overgenomen."
    >
      <Textarea
        id={id}
        rows={8}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          onChange(plainTextToHtml(event.target.value));
        }}
      />
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
        spec.multiline
          ? 'Eén item per alinea (scheid met een lege regel).'
          : 'Eén item per regel.'
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
    <fieldset className="rounded-lg border border-border p-2.5">
      <legend className="px-1 text-xs font-medium text-muted-foreground">{spec.label}</legend>
      <div className="flex flex-col gap-2">
        <MediaPicker
          value={mediaId}
          media={media}
          onChange={(next) => patch({ mediaId: next })}
        />
        <LabelledField label="Alt-tekst" htmlFor={`${id}-alt`}>
          <Input
            id={`${id}-alt`}
            value={asString(image.alt)}
            onChange={(event) => patch({ alt: event.target.value })}
          />
        </LabelledField>
        <label className="flex items-center gap-2 text-xs">
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
    <fieldset className="rounded-lg border border-border p-2.5">
      <legend className="px-1 text-xs font-medium text-muted-foreground">{spec.label}</legend>

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
            <label className="flex items-center gap-2 text-xs">
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
        <div key={index} className="rounded-lg border border-border bg-muted/20 p-2.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">
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
  const [text, setText] = useState(() => (value === undefined ? '' : JSON.stringify(value, null, 2)));
  const [invalid, setInvalid] = useState(false);

  return (
    <LabelledField label={`${spec.label} (JSON)`} htmlFor={id} hint={invalid ? 'Ongeldige JSON — de laatste geldige waarde blijft bewaard.' : undefined}>
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

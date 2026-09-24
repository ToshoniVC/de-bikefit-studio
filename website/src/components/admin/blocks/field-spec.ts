import { blockRegistry, imageRefSchema, linkSchema, type BlockType } from '@/lib/cms/blocks';

/**
 * Turns the zod schemas in the block registry into a small, JSON-serialisable
 * description of a form. The admin never hand-writes a form per block type:
 * the server derives the spec here, the client renders it, and `repo.ts`
 * validates the result against the very same schema on save.
 *
 * Mapping (as agreed in docs/cms-architecture.md § 5):
 *   string            → input, or textarea for long-form fields
 *   number            → number input
 *   boolean           → checkbox
 *   enum / literal ∪  → select
 *   string[]          → one line per item ("regellijst")
 *   object[]          → repeatable group
 *   imageRefSchema    → media picker
 *   linkSchema        → label + href + external triple
 *   anything else     → raw JSON textarea (nothing in the registry hits this)
 */

export type FieldSpec =
  | { kind: 'text'; name: string; label: string; multiline: boolean; nullable: boolean }
  | { kind: 'richText'; name: string; label: string }
  | { kind: 'number'; name: string; label: string; nullable: boolean; integer: boolean }
  | { kind: 'boolean'; name: string; label: string }
  | { kind: 'enum'; name: string; label: string; options: string[]; numeric: boolean }
  | { kind: 'textList'; name: string; label: string; multiline: boolean }
  | { kind: 'image'; name: string; label: string }
  | { kind: 'link'; name: string; label: string; nullable: boolean }
  | {
      kind: 'objectList';
      name: string;
      label: string;
      fields: FieldSpec[];
      defaultItem: Record<string, unknown>;
    }
  | { kind: 'object'; name: string; label: string; fields: FieldSpec[] }
  | { kind: 'json'; name: string; label: string };

export type BlockSpec = {
  type: BlockType;
  label: string;
  description: string;
  fields: FieldSpec[];
};

// --- Dutch labels -----------------------------------------------------------

const LABELS: Record<string, string> = {
  addressLines: 'Adresregels',
  alt: 'Alt-tekst',
  answer: 'Antwoord',
  author: 'Naam',
  body: 'Tekst',
  bullets: 'Opsomming',
  cards: 'Kaarten',
  city: 'Gemeente',
  collapsible: 'Inklapbaar',
  columns: 'Kolommen',
  cta: 'Knop',
  currency: 'Munteenheid',
  decorative: 'Decoratief (geen alt nodig)',
  description: 'Omschrijving',
  duration: 'Duur',
  email: 'E-mail',
  emitStructuredData: 'FAQ structured data genereren',
  external: 'Externe link',
  eyebrow: 'Bovenkop',
  facts: 'Feiten',
  features: 'Kenmerken',
  featured: 'Uitgelicht',
  footnote: 'Voetnoot',
  highlighted: 'Uitgelicht',
  hours: 'Openingsuren',
  href: 'Link',
  html: 'Tekst',
  image: 'Afbeelding',
  imagePosition: 'Positie beeld',
  isPlaceholder: 'Placeholder — niet publiek tonen',
  items: 'Items',
  label: 'Label',
  lede: 'Inleiding',
  mapEmbedUrl: 'Kaart-embed URL',
  mediaId: 'Media',
  meta: 'Extra info',
  number: 'Nummer',
  paragraphs: 'Alinea’s',
  phoneHref: 'Telefoon (link)',
  phoneLabel: 'Telefoon (label)',
  plans: 'Pakketten',
  priceCents: 'Prijs in eurocent',
  priceLabel: 'Prijslabel',
  primaryCta: 'Primaire knop',
  question: 'Vraag',
  quote: 'Citaat',
  quoteAttribution: 'Citaat — wie',
  rotating: 'Roterend tonen',
  secondaryCta: 'Secundaire knop',
  // `booking` block
  serviceIds: 'Diensten (één dienst-ID per regel; leeg = alle actieve diensten)',
  showProviderChoice: 'Keuze van aanbieder tonen',
  successTitle: 'Titel na boeken',
  successText: 'Tekst na boeken (leeg = tekst uit Instellingen → Afspraken)',
  steps: 'Stappen',
  subtitle: 'Ondertitel',
  title: 'Titel',
  titleEmphasis: 'Titel — accentdeel',
  url: 'Externe URL',
  value: 'Waarde',
  variant: 'Variant',
};

const MULTILINE = new Set([
  'answer',
  'body',
  'description',
  'lede',
  'mission',
  'paragraphs',
  'quote',
  'subtitle',
  'successText',
  'text',
]);

function labelFor(name: string): string {
  if (LABELS[name]) return LABELS[name];
  const spaced = name.replace(/([A-Z])/g, ' $1').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// --- zod introspection ------------------------------------------------------

type ZodDef = {
  type: string;
  innerType?: unknown;
  defaultValue?: unknown;
  shape?: Record<string, unknown>;
  element?: unknown;
  entries?: Record<string, string | number>;
  options?: unknown[];
  values?: unknown[];
};

function defOf(schema: unknown): ZodDef | null {
  const candidate = schema as { _zod?: { def?: ZodDef } } | null;
  return candidate?._zod?.def ?? null;
}

const WRAPPERS = new Set(['default', 'prefault', 'optional', 'nullable', 'catch', 'readonly']);

type Unwrapped = { schema: unknown; def: ZodDef | null; nullable: boolean; defaultValue: unknown };

function unwrap(schema: unknown): Unwrapped {
  let current = schema;
  let def = defOf(current);
  let nullable = false;
  let defaultValue: unknown;

  while (def && WRAPPERS.has(def.type)) {
    if (def.type === 'nullable' || def.type === 'optional') nullable = true;
    if ((def.type === 'default' || def.type === 'prefault') && defaultValue === undefined) {
      defaultValue = def.defaultValue;
    }
    current = def.innerType;
    def = defOf(current);
  }
  return { schema: current, def, nullable, defaultValue };
}

function literalValue(schema: unknown): string | null {
  const def = defOf(schema);
  if (!def || def.type !== 'literal') return null;
  const value = Array.isArray(def.values) ? def.values[0] : undefined;
  return value === undefined || value === null ? null : String(value);
}

function fieldSpec(name: string, schema: unknown): FieldSpec {
  const { schema: inner, def, nullable, defaultValue } = unwrap(schema);
  const label = labelFor(name);

  if (inner === imageRefSchema) return { kind: 'image', name, label };
  if (inner === linkSchema) return { kind: 'link', name, label, nullable };

  switch (def?.type) {
    case 'string':
      if (name === 'html') return { kind: 'richText', name, label };
      return { kind: 'text', name, label, multiline: MULTILINE.has(name), nullable };

    case 'number':
      return { kind: 'number', name, label, nullable, integer: true };

    case 'boolean':
      return { kind: 'boolean', name, label };

    case 'enum': {
      const options = Object.values(def.entries ?? {}).map(String);
      return { kind: 'enum', name, label, options, numeric: false };
    }

    case 'union': {
      const options = (def.options ?? []).map(literalValue).filter((v): v is string => v !== null);
      if (options.length > 0) {
        const numeric = options.every((option) => /^-?\d+(\.\d+)?$/.test(option));
        return { kind: 'enum', name, label, options, numeric };
      }
      return { kind: 'json', name, label };
    }

    case 'literal': {
      const value = literalValue(inner);
      return value === null
        ? { kind: 'json', name, label }
        : { kind: 'enum', name, label, options: [value], numeric: /^-?\d+$/.test(value) };
    }

    case 'array': {
      const element = unwrap(def.element);
      if (element.def?.type === 'string') {
        return { kind: 'textList', name, label, multiline: MULTILINE.has(name) };
      }
      if (element.def?.type === 'object') {
        const fields = objectFields(element.def);
        return { kind: 'objectList', name, label, fields, defaultItem: defaultsFor(fields) };
      }
      return { kind: 'json', name, label };
    }

    case 'object':
      return { kind: 'object', name, label, fields: objectFields(def) };

    default:
      void defaultValue;
      return { kind: 'json', name, label };
  }
}

function objectFields(def: ZodDef): FieldSpec[] {
  return Object.entries(def.shape ?? {}).map(([key, value]) => fieldSpec(key, value));
}

/** A fresh, schema-shaped value for one repeatable item. */
export function defaultsFor(fields: FieldSpec[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const spec of fields) out[spec.name] = defaultValueFor(spec);
  return out;
}

export function defaultValueFor(spec: FieldSpec): unknown {
  switch (spec.kind) {
    case 'text':
    case 'richText':
      return '';
    case 'number':
      return spec.nullable ? null : 0;
    case 'boolean':
      return false;
    case 'enum':
      return spec.numeric ? Number(spec.options[0]) : (spec.options[0] ?? '');
    case 'textList':
    case 'objectList':
      return [];
    case 'image':
      return { mediaId: null, url: null, alt: '', decorative: false };
    case 'link':
      return spec.nullable ? null : { label: '', href: '', external: false };
    case 'object':
      return defaultsFor(spec.fields);
    case 'json':
      return null;
  }
}

/** The full form description for one block type. */
export function blockSpec(type: BlockType): BlockSpec {
  const definition = blockRegistry[type];
  const def = defOf(definition.schema);
  return {
    type,
    label: definition.label,
    description: definition.description,
    fields: def?.type === 'object' ? objectFields(def) : [],
  };
}

export function allBlockSpecs(): Record<string, BlockSpec> {
  const out: Record<string, BlockSpec> = {};
  for (const type of Object.keys(blockRegistry) as BlockType[]) out[type] = blockSpec(type);
  return out;
}

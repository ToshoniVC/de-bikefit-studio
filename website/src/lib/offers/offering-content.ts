import { z } from 'zod';
import { emptyImage, imageRefSchema, type CmsImageRef } from '@/lib/cms/block-primitives';
import {
  OFFER_CATEGORIES,
  OFFER_CTA_LABEL,
  OFFER_DURATION_FALLBACK,
  type OfferCategory,
} from './catalogue';
import type { OfferingSettings } from './offering';

/**
 * The copy of an offering — what a visitor reads on `/aanbod` and on
 * `/aanbod/<slug>` — as Beheer → Aanbod stores it in `cms_offerings`
 * (17 Oct 2026; before that this text lived in an `offer` block on a page).
 *
 * Plain module: no I/O, no Next, no `server-only`. Unit-tested in
 * `offering-content.test.ts`; shared by the admin form, the repo, the public
 * renderers, the bootstrap and the migration from offer pages.
 */

export const OFFERING_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type OfferingContent = {
  /** Last URL segment of `/aanbod/<slug>`; also what `?dienst=` carries. */
  slug: string;
  category: OfferCategory;
  /** Position inside its category on every overview (lower first). */
  sortOrder: number;
  title: string;
  /** One or two sentences for the overview card; empty = the intro. */
  summary: string;
  intro: string;
  /** Doel */
  goal: string;
  /** Inhoud — one item per entry. */
  contents: string[];
  /** Mogelijke extra's — one item per entry. */
  extras: string[];
  extrasNote: string;
  /** Free-text Duur, public only for an offering that is asked for; '' = "Duur in overleg". */
  duration: string;
  /** Text of the booking button; '' = {@link OFFER_CTA_LABEL}. */
  ctaLabel: string;
  image: CmsImageRef;
  metaDescription: string;
};

/** One offering as the public site and the admin read it: copy + settings. */
export type OfferingRecord = {
  id: string;
  locale: string;
  content: OfferingContent;
  settings: OfferingSettings;
  /** ISO 8601 (plain across the cache boundary). */
  updatedAt: string;
};

const line = (max: number) => z.string().trim().max(max, `Maximaal ${max} tekens.`);

export const offeringContentSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, 'Geef een slug op (het laatste deel van het webadres).')
    .max(80, 'De slug is te lang (max. 80 tekens).')
    .regex(
      OFFERING_SLUG_PATTERN,
      'De slug mag enkel kleine letters, cijfers en koppeltekens bevatten.',
    ),
  category: z.enum(OFFER_CATEGORIES).default('bikefit'),
  sortOrder: z.number().int('De volgorde moet een geheel getal zijn.').min(0).max(999).default(0),
  title: z
    .string()
    .trim()
    .min(1, 'Geef het aanbod een titel.')
    .max(120, 'De titel is te lang (max. 120 tekens).'),
  summary: line(300).default(''),
  intro: line(1000).default(''),
  goal: line(300).default(''),
  contents: z.array(line(300)).max(20, 'Maximaal 20 punten.').default([]),
  extras: z.array(line(300)).max(20, 'Maximaal 20 extra’s.').default([]),
  extrasNote: line(300).default(''),
  duration: line(120).default(''),
  ctaLabel: line(80).default(''),
  image: imageRefSchema.default(emptyImage),
  metaDescription: line(320).default(''),
});

export type OfferingContentInput = z.input<typeof offeringContentSchema>;

export function validateOfferingContent(
  raw: unknown,
): { ok: true; data: OfferingContent } | { ok: false; message: string } {
  const parsed = offeringContentSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: [...new Set(parsed.error.issues.map((issue) => issue.message))].join(' '),
    };
  }
  const data = parsed.data;
  return {
    ok: true,
    data: {
      ...data,
      contents: data.contents.filter(Boolean),
      extras: data.extras.filter(Boolean),
      image: { ...emptyImage, ...data.image },
    },
  };
}

/** A fresh, empty offering for the admin form. */
export const EMPTY_OFFERING_CONTENT: OfferingContent = {
  slug: '',
  category: 'bikefit',
  sortOrder: 0,
  title: '',
  summary: '',
  intro: '',
  goal: '',
  contents: [],
  extras: [],
  extrasNote: '',
  duration: '',
  ctaLabel: '',
  image: { ...emptyImage },
  metaDescription: '',
};

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
    : [];
}

/**
 * Content from a stored row, read defensively: unknown categories read as
 * Bikefit, a malformed jsonb list as empty, a malformed image as none.
 */
export function contentFromRow(row: {
  slug: string;
  category: string;
  sortOrder: number;
  title: string;
  summary: string;
  intro: string;
  goal: string;
  contents: unknown;
  extras: unknown;
  extrasNote: string;
  duration: string;
  ctaLabel: string;
  image: unknown;
  metaDescription: string;
}): OfferingContent {
  const image = imageRefSchema.safeParse(row.image ?? emptyImage);
  return {
    slug: row.slug,
    category: (OFFER_CATEGORIES as readonly string[]).includes(row.category)
      ? (row.category as OfferCategory)
      : 'bikefit',
    sortOrder: Number.isInteger(row.sortOrder) ? row.sortOrder : 0,
    title: row.title,
    summary: row.summary,
    intro: row.intro,
    goal: row.goal,
    contents: stringList(row.contents),
    extras: stringList(row.extras),
    extrasNote: row.extrasNote,
    duration: row.duration,
    ctaLabel: row.ctaLabel,
    image: image.success ? image.data : { ...emptyImage },
    metaDescription: row.metaDescription,
  };
}

/** The booking button's text. */
export function offeringCtaLabel(content: Pick<OfferingContent, 'ctaLabel'>): string {
  return content.ctaLabel.trim() || OFFER_CTA_LABEL;
}

/** Card text: the summary, else the intro. */
export function offeringSummary(content: Pick<OfferingContent, 'summary' | 'intro'>): string {
  return content.summary.trim() || content.intro.trim();
}

/** The editorial Duur of an offering that is asked for. */
export function offeringEditorialDuration(content: Pick<OfferingContent, 'duration'>): string {
  return content.duration.trim() || OFFER_DURATION_FALLBACK;
}

/** A textarea with one item per line → the list the schema takes. */
export function linesToList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

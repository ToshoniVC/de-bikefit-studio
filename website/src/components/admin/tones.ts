import type { VariantProps } from 'class-variance-authority';

import type { badgeVariants } from '@/components/ui/badge';

/**
 * Status colours for the admin, on the studio palette.
 *
 * `Badge` is shared with the webshop, so it stays as it is. Its `success` and
 * `warning` variants are Tailwind emerald and amber, which the studio palette
 * does not have; admin badges pass `className={badgeTone(variant)}` and
 * tailwind-merge lets that override the variant's colours:
 *  - success → mauve (done, active, connected, published);
 *  - warning → cream with a rose edge (needs attention).
 * The other variants already follow the shadcn variables that `.admin-root`
 * re-maps in `globals.css`: default = burgundy accent, secondary = muted bone,
 * outline = hairline, destructive = red.
 *
 * `FLASH_TONES` are the inline messages (action results, the Google round
 * trip, validation hints): a bone panel with a 4px edge, the shape of
 * `.studio-booking__alert` on the public booking form.
 *
 * A plain module on purpose (no 'use client'): server and client components
 * both import it.
 */

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>;

const BADGE_TONES: Partial<Record<BadgeVariant, string>> = {
  success: 'border-transparent bg-ds-mauve-500 text-ds-bone-50',
  warning: 'border-ds-rose-400 bg-ds-cream-300 text-ds-burgundy-700',
};

export function badgeTone(variant: BadgeVariant | null | undefined): string | undefined {
  return variant ? BADGE_TONES[variant] : undefined;
}

export const FLASH_TONES = {
  success: 'border-l-4 border-ds-mauve-500 bg-muted text-foreground',
  error: 'border-l-4 border-destructive bg-destructive/5 text-destructive',
  warning: 'border-l-4 border-ds-rose-400 bg-ds-cream-300/40 text-foreground',
  info: 'border-l-4 border-ds-bone-400 bg-muted text-muted-foreground',
} as const;

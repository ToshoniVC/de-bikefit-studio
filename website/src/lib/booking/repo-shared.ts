import 'server-only';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import { getCmsDb } from '@/db/cms';
import { cmsLocations } from '@/db/cms-schema';
import { CmsAuthError } from '@/lib/cms/auth';
import { revalidateContent } from '@/lib/cms/repo';
import { BOOKING_TAG } from './content';

/**
 * Small helpers shared by the booking write API (`./repo.ts`) and the service
 * catalogue (`./repo-services.ts`), split out on 16 Oct 2026 so neither file
 * grows past the size limit. Same contract as before: Dutch messages, cache
 * bust on the booking tag.
 */

export const ok = <T>(data: T) => ({ ok: true as const, data });
export const err = (message: string) => ({ ok: false as const, message });

export function forbidden(): never {
  throw new CmsAuthError('forbidden', 'Je hebt geen toestemming voor deze actie.');
}

export function issuesToMessage(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join(' ');
}

/** Drops keys whose value is `undefined`, so partial updates can be merged. */
export function defined<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

export function bust(): void {
  revalidateContent({ tags: [BOOKING_TAG] });
}

export async function locationExists(locationId: string | null): Promise<boolean> {
  if (!locationId) return true;
  const db = await getCmsDb();
  const [row] = await db
    .select({ id: cmsLocations.id })
    .from(cmsLocations)
    .where(eq(cmsLocations.id, locationId))
    .limit(1);
  return Boolean(row);
}

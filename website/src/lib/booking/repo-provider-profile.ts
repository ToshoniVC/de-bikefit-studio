import 'server-only';
import { eq } from 'drizzle-orm';
import { getCmsDb } from '@/db/cms';
import { cmsProviders, cmsUsers } from '@/db/cms-schema';
import { recordAudit, requireCmsUser } from '@/lib/cms/auth';
import { can } from '@/lib/cms/permissions';
import type { RepoResult } from '@/lib/cms/repo';
import { bust, err, forbidden, ok } from './repo-shared';

/**
 * A user with the role Aanbieder IS a provider (17 Oct 2026): the account and
 * the bookable profile are one thing to the studio, so the profile is created
 * with the account (Gebruikers → role Aanbieder, or a role change to it) and
 * never has to be "linked" by hand afterwards. Kept apart from `./repo.ts`
 * (file-size rule); `createProvider()` there stays the admin's way to make
 * a provider with a new login in one go.
 *
 * Idempotent: an existing profile is returned untouched. `provider.manage`
 * for anyone, or the signed-in user for their own account (`provider.self`),
 * so an older Aanbieder account can complete itself from Mijn agenda.
 */
export async function ensureProviderProfile(
  userId: string,
): Promise<RepoResult<{ providerId: string; created: boolean }>> {
  const actor = await requireCmsUser();
  const own = actor.id === userId;
  if (!(can(actor.role, 'provider.manage') || (own && can(actor.role, 'provider.self')))) {
    forbidden();
  }

  const db = await getCmsDb();
  const [user] = await db
    .select({ id: cmsUsers.id, name: cmsUsers.name, email: cmsUsers.email })
    .from(cmsUsers)
    .where(eq(cmsUsers.id, userId))
    .limit(1);
  if (!user) return err('Gebruiker niet gevonden.');

  const [existing] = await db
    .select({ id: cmsProviders.id })
    .from(cmsProviders)
    .where(eq(cmsProviders.userId, userId))
    .limit(1);
  if (existing) return ok({ providerId: existing.id, created: false });

  const displayName = user.name.trim() || user.email;
  const [provider] = await db
    .insert(cmsProviders)
    .values({ userId, displayName, googleCalendarId: null })
    .returning({ id: cmsProviders.id });

  await recordAudit(db, actor, {
    action: 'provider.create',
    entityType: 'cms_provider',
    entityId: provider.id,
    summary: `${displayName} (profiel bij de rol Aanbieder)`,
  });
  bust();
  return ok({ providerId: provider.id, created: true });
}

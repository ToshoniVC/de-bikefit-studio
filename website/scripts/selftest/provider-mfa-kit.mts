/**
 * Shared pieces of self-test section 5g (`./provider-mfa.mts`,
 * `./provider-mfa-roles.mts`): the provider's credentials, what part A–E
 * hands on to F–I, and small helpers around the per-browser cookie jars of
 * `./mfa-concurrency-kit.mts`.
 */
import { inBrowser, type Jar } from './mfa-concurrency-kit.mjs';
import { CTX, type MfaKit } from './mfa-kit.mjs';

export const PROVIDER = 'aanbieder-mfa@selftest.local';
export const PROVIDER_PASSWORD = 'Aanbieder-Tweestap-2026';

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

/** What parts F–I continue with. */
export type ProviderState = {
  /** The provider's CMS user id. */
  providerId: string;
  /** Its `cms_providers` row. */
  providerRowId: string;
  /** The provider's browser, signed in with MFA a moment ago. */
  jar: Jar;
  /** The provider's recovery codes; 0 and 1 are used. */
  recoveryCodes: string[];
  /** The self-test admin's browser: an MFA session with a fresh step-up. */
  adminJar: Jar;
  adminActingSessionId: string;
  /** Test-only: fresh recovery codes for the admin's re-authentication. */
  adminCodes: string[];
};

export function providerKit(kit: MfaKit) {
  const { db, auth, eq, cmsSessions, cmsUsers, resolveSession } = kit;
  const as = <T,>(jar: Jar, run: () => Promise<T>) => inBrowser(jar, run);
  const sessionOf = async (jar: Jar) => {
    const token = jar.get('cms_session');
    return token ? resolveSession(db, token) : null;
  };
  /** A password sign-in in a browser that starts without cookies. */
  const signIn = (jar: Jar, email: string, password: string) => {
    jar.clear();
    return as(jar, () => auth.login({ email, password, context: CTX }));
  };
  const sessionRow = async (id: string) =>
    (await db.select().from(cmsSessions).where(eq(cmsSessions.id, id)).limit(1))[0] ?? null;
  const userRow = async (id: string) =>
    (await db.select().from(cmsUsers).where(eq(cmsUsers.id, id)).limit(1))[0] ?? null;
  const near = (a: Date | null | undefined, b: number, slackMs = 5_000) =>
    !!a && Math.abs(a.getTime() - b) <= slackMs;
  return { as, sessionOf, signIn, sessionRow, userRow, near };
}

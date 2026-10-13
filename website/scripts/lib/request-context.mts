/**
 * Request-context stubs for CMS scripts (`cms-seed.mts`, `cms-rollout-aanbod.mts`).
 *
 * The write API (`src/lib/cms/repo.ts`) is `server-only` and resolves its
 * actor from the `cms_session` cookie via `next/headers`, none of which exists
 * in a plain Node process. Instead of bypassing the write API, a script gives
 * it the context it expects: three tiny in-process module stubs
 * (`server-only`, `next/headers`, `next/cache`) registered through Node's
 * `module.registerHooks` (Node ≥ 22.15), plus a REAL `cms_sessions` row for a
 * real admin, whose token goes into {@link cookieJar}. Every permission check,
 * block validation and audit write then runs exactly as in the browser.
 *
 * Call {@link installRequestContextStubs} before the first dynamic
 * `import('@/lib/cms/…')`; static imports of plain modules are fine.
 */
import nodeModule from 'node:module';

type StubResolveResult = { url: string; format?: string; shortCircuit?: boolean };
type StubLoadResult = { format: string; source?: string; shortCircuit?: boolean };
type SyncModuleHooks = {
  resolve?: (
    specifier: string,
    context: unknown,
    next: (specifier: string, context: unknown) => StubResolveResult,
  ) => StubResolveResult;
  load?: (
    url: string,
    context: unknown,
    next: (url: string, context: unknown) => StubLoadResult,
  ) => StubLoadResult;
};

/** The cookie store `next/headers` reads in these scripts. */
export const cookieJar = new Map<string, string>();
(globalThis as unknown as { __bikefitScriptCookies: Map<string, string> }).__bikefitScriptCookies =
  cookieJar;

const STUB_SOURCES: Record<string, string> = {
  // `server-only` throws unless resolved under the `react-server` condition.
  'server-only': 'export {};',

  // A cookie store backed by the Map above, so `readSessionCookie()` finds the
  // session token the script creates.
  'next/headers': `
    function jar() { return globalThis.__bikefitScriptCookies; }
    export async function cookies() {
      return {
        get: (name) => (jar().has(name) ? { name, value: jar().get(name) } : undefined),
        getAll: () => [...jar()].map(([name, value]) => ({ name, value })),
        has: (name) => jar().has(name),
        set: (name, value) => {
          if (name && typeof name === 'object') jar().set(name.name, name.value);
          else jar().set(name, value);
        },
        delete: (name) => { jar().delete(name); },
      };
    }
    export async function headers() { return new Headers(); }
    export async function draftMode() {
      return { isEnabled: false, enable() {}, disable() {} };
    }
  `,

  // Outside a request there is no cache to bust and no route to revalidate.
  'next/cache': `
    export function unstable_cache(fn) { return fn; }
    export function revalidateTag() {}
    export function updateTag() {}
    export function revalidatePath() {}
    export function expireTag() {}
    export function expirePath() {}
    export function unstable_noStore() {}
  `,
};

const STUB_PREFIX = 'bikefit-script-stub:';
let installed = false;

export function installRequestContextStubs(): void {
  if (installed) return;
  const registerHooks = (
    nodeModule as unknown as { registerHooks?: (hooks: SyncModuleHooks) => void }
  ).registerHooks;
  if (typeof registerHooks !== 'function') {
    console.error('✗ this script needs Node 22.15+ (module.registerHooks is unavailable).');
    process.exit(1);
  }
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (STUB_SOURCES[specifier]) {
        return { url: STUB_PREFIX + specifier, shortCircuit: true, format: 'module' };
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url.startsWith(STUB_PREFIX)) {
        return {
          format: 'module',
          shortCircuit: true,
          source: STUB_SOURCES[url.slice(STUB_PREFIX.length)],
        };
      }
      return nextLoad(url, context);
    },
  });
  installed = true;
}

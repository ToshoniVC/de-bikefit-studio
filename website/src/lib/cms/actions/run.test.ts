import { afterEach, describe, expect, it, vi } from 'vitest';
import { CmsAuthError, type CmsAuthErrorCode } from '@/lib/cms/guard';
import { runAction } from './run';
import { actionOk } from './state';

// `./auth` would pull in the database layer; the class is all `run.ts` needs
// from it, and `./auth` re-exports exactly this one from `./guard`.
vi.mock('@/lib/cms/auth', async () => ({
  CmsAuthError: (await import('@/lib/cms/guard')).CmsAuthError,
}));
// Stand-in for Next's control-flow errors (`redirect()`, `notFound()`).
vi.mock('next/navigation', () => ({
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message === 'NEXT_REDIRECT') throw error;
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
});

const failWith = (error: unknown) => () => runAction(async () => Promise.reject(error));

describe('runAction', () => {
  it('maps every guard failure to its own short Dutch message', async () => {
    const expected: Record<CmsAuthErrorCode, string> = {
      unauthenticated: 'Je sessie is verlopen. Meld je opnieuw aan.',
      mfa_required: 'Bevestig je aanmelding met tweestapsverificatie. Meld je opnieuw aan.',
      password_change_required:
        'Je gebruikt nog een tijdelijk wachtwoord. Kies eerst een nieuw wachtwoord.',
      forbidden: 'Je hebt geen toestemming voor deze actie.',
    };
    for (const [code, message] of Object.entries(expected) as Array<[CmsAuthErrorCode, string]>) {
      await expect(failWith(new CmsAuthError(code))(), code).resolves.toEqual({
        ok: false,
        message,
      });
    }
  });

  it('never shows the error’s own message', async () => {
    const leaky = new CmsAuthError('password_change_required', 'must_change_password=true for u1');
    const state = await failWith(leaky)();
    expect(state.message).not.toContain('must_change_password');
    expect(state.message).not.toContain('u1');
  });

  it('treats an unknown code as forbidden', async () => {
    const odd = new CmsAuthError('surprise' as CmsAuthErrorCode, 'x');
    await expect(failWith(odd)()).resolves.toEqual({
      ok: false,
      message: 'Je hebt geen toestemming voor deze actie.',
    });
  });

  it('logs other failures with a prefix and shows a generic message', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = new Error('relation "cms_pages" does not exist');
    await expect(failWith(boom)()).resolves.toEqual({
      ok: false,
      message: 'Er ging iets mis. Probeer het opnieuw.',
    });
    expect(log).toHaveBeenCalledWith('[cms] action failed', boom);
  });

  it('passes control flow through and returns a normal result untouched', async () => {
    await expect(failWith(new Error('NEXT_REDIRECT'))()).rejects.toThrow('NEXT_REDIRECT');
    const ok = actionOk('Opgeslagen.');
    await expect(runAction(async () => ok)).resolves.toBe(ok);
  });
});

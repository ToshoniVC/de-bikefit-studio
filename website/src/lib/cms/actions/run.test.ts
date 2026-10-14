import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CmsAuthError, type CmsAuthErrorCode } from '@/lib/cms/guard';
import { PasswordHasherBusyError } from '@/lib/cms/password';
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
      reauth_required:
        'Bevestig eerst je identiteit (wachtwoord en code) en probeer het dan opnieuw.',
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

  it('answers "try again" to a full password hasher, without logging it as a failure', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(failWith(new PasswordHasherBusyError())()).resolves.toEqual({
      ok: false,
      message: 'Het is even druk. Probeer het over een minuut opnieuw.',
    });
    expect(log).not.toHaveBeenCalled();
  });

  it('logs other failures as a fixed code only and shows a generic message', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = new Error('relation "cms_pages" does not exist');
    await expect(failWith(boom)()).resolves.toEqual({
      ok: false,
      message: 'Er ging iets mis. Probeer het opnieuw.',
    });
    expect(log).toHaveBeenCalledExactlyOnceWith('[cms] action_failed');
  });

  it('never logs a failed query’s SQL, bound values, cause or driver detail', async () => {
    const calls: Array<{ level: string; args: unknown[] }> = [];
    for (const level of ['debug', 'info', 'log', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        calls.push({ level, args });
      });
    }
    // Shaped like Drizzle's `DrizzleQueryError` around Neon's `NeonDbError`:
    // message, `query`, `params` and `cause` all hold what the action wrote.
    const failedQuery = Object.assign(
      new Error(
        'Failed query: insert into "cms_users" ("email", "password_hash") values ($1, $2)\nparams: kanarie@lek-test.invalid,$scrypt$kanarie-hash',
      ),
      {
        query: 'insert into "cms_users" ("email", "password_hash") values ($1, $2)',
        params: ['kanarie@lek-test.invalid', '$scrypt$kanarie-hash'],
        cause: Object.assign(
          new Error(
            'detail: Failing row contains (kanarie@lek-test.invalid, $scrypt$kanarie-hash).',
          ),
          {
            name: 'NeonDbError',
            code: '23505',
            detail: 'Key (email)=(kanarie@lek-test.invalid) already exists.',
          },
        ),
      },
    );

    await expect(failWith(failedQuery)()).resolves.toEqual({
      ok: false,
      message: 'Er ging iets mis. Probeer het opnieuw.',
    });
    // Exactly one console call in total, and it is `console.error`.
    expect(calls.map(({ level }) => level)).toEqual(['error']);
    const args = calls.map((call) => call.args);
    const canaries = [
      'kanarie',
      'lek-test',
      'scrypt',
      'Failed query',
      'params',
      'Failing row',
      '@',
      'insert into',
      'cms_users',
      '23505',
      'NeonDbError',
    ];
    for (const text of [JSON.stringify(args), inspect(args, { depth: 10 })]) {
      for (const canary of canaries) {
        expect(text.toLowerCase(), `${canary} leaked: ${text}`).not.toContain(canary.toLowerCase());
      }
    }
  });

  it('passes control flow through and returns a normal result untouched', async () => {
    await expect(failWith(new Error('NEXT_REDIRECT'))()).rejects.toThrow('NEXT_REDIRECT');
    const ok = actionOk('Opgeslagen.');
    await expect(runAction(async () => ok)).resolves.toBe(ok);
  });
});

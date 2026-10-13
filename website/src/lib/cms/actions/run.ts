import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { CmsAuthError, type CmsAuthErrorCode } from '@/lib/cms/auth';
import { actionError, type ActionState } from './state';

/** What a form shows per guard failure: short, Dutch, nothing internal. */
const AUTH_ERROR_MESSAGES: Record<CmsAuthErrorCode, string> = {
  unauthenticated: 'Je sessie is verlopen. Meld je opnieuw aan.',
  mfa_required: 'Bevestig je aanmelding met tweestapsverificatie. Meld je opnieuw aan.',
  password_change_required:
    'Je gebruikt nog een tijdelijk wachtwoord. Kies eerst een nieuw wachtwoord.',
  forbidden: 'Je hebt geen toestemming voor deze actie.',
};

/**
 * Runs a server-action body, converting `CmsAuthError` (thrown by
 * `requirePermission()` inside `repo.ts`) into a displayable state instead of a
 * 500.
 *
 * `redirect()` and `notFound()` signal through thrown control-flow errors, so
 * `unstable_rethrow` re-throws those untouched.
 *
 * Kept apart from `./state` because this module pulls in the database layer;
 * `./state` stays importable from client components.
 */
export async function runAction(body: () => Promise<ActionState>): Promise<ActionState> {
  try {
    return await body();
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof CmsAuthError) {
      return actionError(AUTH_ERROR_MESSAGES[error.code] ?? AUTH_ERROR_MESSAGES.forbidden);
    }
    console.error('[cms] action failed', error);
    return actionError('Er ging iets mis. Probeer het opnieuw.');
  }
}

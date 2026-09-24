import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { CmsAuthError } from '@/lib/cms/auth';
import { actionError, type ActionState } from './state';

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
      return actionError(
        error.code === 'unauthenticated'
          ? 'Je sessie is verlopen. Meld je opnieuw aan.'
          : 'Je hebt geen toestemming voor deze actie.',
      );
    }
    console.error('[cms] action failed', error);
    return actionError('Er ging iets mis. Probeer het opnieuw.');
  }
}

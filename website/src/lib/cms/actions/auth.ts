'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { changePassword, login, logout } from '@/lib/cms/auth';
import { clientIpFromHeaders } from '@/lib/request-ip';
import { runAction } from './run';
import { actionError, actionOk, field, type ActionState } from './state';

/**
 * Session server actions. Next's server actions carry an Origin/Host check of
 * their own, which is what protects these against cross-site posts — there is
 * deliberately no custom POST route handler for login or logout.
 */

/** Only ever redirect inside the admin, never to an attacker-supplied origin. */
function safeAdminPath(value: string, fallback = '/admin'): string {
  if (!value.startsWith('/admin')) return fallback;
  if (value.startsWith('//') || value.includes('\\')) return fallback;
  return value;
}

async function requestContext() {
  const headerList = await headers();
  return {
    userAgent: headerList.get('user-agent') ?? undefined,
    ipAddress: clientIpFromHeaders(headerList) ?? 'unknown',
  };
}

export async function loginAction(_prevState: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const email = field(form, 'email');
    const password = String(form.get('password') ?? '');
    const next = safeAdminPath(field(form, 'next'));

    if (!email || !password) return actionError('Vul je e-mailadres en wachtwoord in.');

    const result = await login({ email, password, context: await requestContext() });
    // `result.message` is already Dutch and safe: it never says whether the
    // account exists, and rate limiting has its own message.
    if (!result.ok) return actionError(result.message);

    redirect(result.data.mustChangePassword ? '/admin/password' : next);
  });
}

export async function logoutAction(): Promise<void> {
  await logout();
  redirect('/admin/login');
}

export async function changePasswordAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const currentPassword = String(form.get('currentPassword') ?? '');
    const newPassword = String(form.get('newPassword') ?? '');
    const repeatPassword = String(form.get('repeatPassword') ?? '');
    const next = field(form, 'next');

    if (!currentPassword || !newPassword) return actionError('Vul alle velden in.');
    if (newPassword !== repeatPassword) {
      return actionError('De twee nieuwe wachtwoorden zijn niet gelijk.');
    }
    if (newPassword === currentPassword) {
      return actionError('Kies een ander wachtwoord dan het huidige.');
    }

    const result = await changePassword({ currentPassword, newPassword });
    if (!result.ok) return actionError(result.message);

    if (next) redirect(safeAdminPath(next));
    return actionOk('Je wachtwoord is aangepast.');
  });
}

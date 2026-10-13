'use server';

import { revalidatePath } from 'next/cache';
import { runAction } from '@/lib/cms/actions/run';
import { actionError, actionOk, field, type ActionState } from '@/lib/cms/actions/state';
import {
  clearEmailApiKey,
  saveEmailServiceConfig,
  sendEmailServiceTest,
  setEmailApiKey,
} from './repo';

/**
 * `/admin/email` actions. Permission (`email.manage`) is enforced in
 * `./repo.ts`; `runAction` turns a refusal into a Dutch message. No action
 * ever returns the API key, not even masked: the page re-reads the status.
 */

const PATH = '/admin/email';

export async function saveEmailSettingsAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const result = await saveEmailServiceConfig({
      from: field(form, 'from'),
      replyTo: field(form, 'replyTo'),
      giftVoucherRecipient: field(form, 'giftVoucherRecipient'),
    });
    if (!result.ok) return actionError(result.message);
    revalidatePath(PATH);
    return actionOk('Opgeslagen.');
  });
}

export async function saveEmailApiKeyAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const result = await setEmailApiKey(field(form, 'apiKey'));
    if (!result.ok) return actionError(result.message);
    revalidatePath(PATH);
    return actionOk('API-sleutel versleuteld opgeslagen.');
  });
}

/** Takes no input: `useActionState` passes (state, form), both unused here. */
export async function clearEmailApiKeyAction(): Promise<ActionState> {
  return runAction(async () => {
    const result = await clearEmailApiKey();
    if (!result.ok) return actionError(result.message);
    revalidatePath(PATH);
    return actionOk('API-sleutel verwijderd. Zonder sleutel wordt er niets verstuurd.');
  });
}

export async function sendTestEmailAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const result = await sendEmailServiceTest(field(form, 'to'));
    if (!result.ok) return actionError(result.message);
    return result.data.sent ? actionOk(result.data.message) : actionError(result.data.message);
  });
}

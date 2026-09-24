/**
 * Shared shape for every admin server action.
 *
 * Client-safe on purpose: client components import `ActionState`/`IDLE_STATE`
 * for `useActionState`, so nothing here may reach into the database layer.
 * The server-side error wrapper lives in `./run` instead.
 *
 * Actions never throw at the UI: permission failures, validation failures and
 * repo errors all come back as `{ ok: false, message }` in Dutch. `payload`
 * carries the rare extra value a form needs to show once (e.g. a generated
 * temporary password) — never a secret that must stay server-side.
 */
export type ActionState = {
  ok: boolean | null;
  message: string;
  payload?: Record<string, string>;
};

export const IDLE_STATE: ActionState = { ok: null, message: '' };

export function actionOk(message: string, payload?: Record<string, string>): ActionState {
  return { ok: true, message, payload };
}

export function actionError(message: string): ActionState {
  return { ok: false, message };
}

/** Trimmed string field, or `''` when absent. */
export function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/** Trimmed string field, or `null` when empty — for nullable DB columns. */
export function nullableField(form: FormData, name: string): string | null {
  const value = field(form, name);
  return value === '' ? null : value;
}

export function boolField(form: FormData, name: string): boolean {
  const value = form.get(name);
  return value === 'on' || value === 'true' || value === '1';
}

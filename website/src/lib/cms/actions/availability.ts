'use server';

import { revalidatePath } from 'next/cache';
import { setAvailabilityExceptions, setBusinessHours } from '@/lib/booking/repo';
import { isValidYmd, todayYmd } from '@/lib/booking/time';
import type { CmsAvailabilityExceptionKind } from '@/db/cms-schema';
import { runAction } from './run';
import { actionError, actionOk, field, type ActionState } from './state';

/**
 * Business hours and date exceptions. The editors post the whole list as JSON
 * (`hours` / `exceptions`); it is re-validated here and then replaces the
 * provider's rows through `repo.ts`, which enforces `provider.manage` (any
 * provider) or `provider.self` (only the caller's own provider row).
 */

const WEEKDAY_NAMES = [
  'zondag',
  'maandag',
  'dinsdag',
  'woensdag',
  'donderdag',
  'vrijdag',
  'zaterdag',
];

type HoursInput = { weekday: number; startMinute: number; endMinute: number };
type ExceptionInput = {
  date: string;
  kind: CmsAvailabilityExceptionKind;
  startMinute: number | null;
  endMinute: number | null;
  note: string | null;
};

function isMinute(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1440;
}

function parseJsonArray(raw: string): unknown[] | null {
  try {
    const value: unknown = JSON.parse(raw || '[]');
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function parseHours(
  raw: string,
): { ok: true; rows: HoursInput[] } | { ok: false; message: string } {
  const list = parseJsonArray(raw);
  if (!list) return { ok: false, message: 'De openingsuren konden niet gelezen worden.' };
  if (list.length > 70) return { ok: false, message: 'Te veel tijdvakken.' };

  const rows: HoursInput[] = [];
  for (const item of list) {
    const row = item as Partial<HoursInput>;
    const weekday = row.weekday;
    if (typeof weekday !== 'number' || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      return { ok: false, message: 'Onbekende weekdag.' };
    }
    if (!isMinute(row.startMinute) || !isMinute(row.endMinute)) {
      return { ok: false, message: `Ongeldig uur op ${WEEKDAY_NAMES[weekday]}.` };
    }
    if (row.endMinute <= row.startMinute) {
      return {
        ok: false,
        message: `Op ${WEEKDAY_NAMES[weekday]} ligt een einduur vóór het beginuur.`,
      };
    }
    rows.push({ weekday, startMinute: row.startMinute, endMinute: row.endMinute });
  }

  rows.sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    if (previous.weekday === current.weekday && current.startMinute < previous.endMinute) {
      return { ok: false, message: `Op ${WEEKDAY_NAMES[current.weekday]} overlappen tijdvakken.` };
    }
  }
  return { ok: true, rows };
}

function parseExceptions(
  raw: string,
): { ok: true; rows: ExceptionInput[] } | { ok: false; message: string } {
  const list = parseJsonArray(raw);
  if (!list) return { ok: false, message: 'De uitzonderingen konden niet gelezen worden.' };
  if (list.length > 500) return { ok: false, message: 'Te veel uitzonderingen.' };

  const rows: ExceptionInput[] = [];
  const seen = new Set<string>();
  // The repo keeps past exceptions as history and ignores past dates it is sent.
  const today = todayYmd();
  for (const item of list) {
    const row = item as Partial<ExceptionInput>;
    if (typeof row.date !== 'string' || !isValidYmd(row.date)) {
      return { ok: false, message: 'Een uitzondering heeft geen geldige datum.' };
    }
    if (row.date < today) {
      return { ok: false, message: `${row.date} ligt in het verleden.` };
    }
    if (row.kind !== 'closed' && row.kind !== 'open') {
      return { ok: false, message: `${row.date}: onbekende soort uitzondering.` };
    }
    const start = row.startMinute ?? null;
    const end = row.endMinute ?? null;
    if ((start === null) !== (end === null)) {
      return { ok: false, message: `${row.date}: vul beide uren in, of geen van beide.` };
    }
    if (start !== null && end !== null) {
      if (!isMinute(start) || !isMinute(end) || end <= start) {
        return { ok: false, message: `${row.date}: het einduur moet na het beginuur liggen.` };
      }
    } else if (row.kind === 'open') {
      return { ok: false, message: `${row.date}: een extra open tijdvak heeft uren nodig.` };
    }
    const key = `${row.date}|${row.kind}|${start ?? ''}`;
    if (seen.has(key)) {
      return { ok: false, message: `${row.date}: dezelfde uitzondering staat er twee keer in.` };
    }
    seen.add(key);
    const note = typeof row.note === 'string' ? row.note.trim().slice(0, 300) : '';
    rows.push({
      date: row.date,
      kind: row.kind,
      startMinute: start,
      endMinute: end,
      note: note || null,
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return { ok: true, rows };
}

function revalidateAvailabilityViews(providerId: string): void {
  revalidatePath('/admin/agenda');
  revalidatePath(`/admin/providers/${providerId}`);
}

export async function setBusinessHoursAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const providerId = field(form, 'providerId');
    if (!providerId) return actionError('Onbekende aanbieder.');

    const parsed = parseHours(field(form, 'hours'));
    if (!parsed.ok) return actionError(parsed.message);

    const result = await setBusinessHours(providerId, parsed.rows);
    if (!result.ok) return actionError(result.message);

    revalidateAvailabilityViews(providerId);
    return actionOk('Openingsuren opgeslagen.');
  });
}

export async function setAvailabilityExceptionsAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const providerId = field(form, 'providerId');
    if (!providerId) return actionError('Onbekende aanbieder.');

    const parsed = parseExceptions(field(form, 'exceptions'));
    if (!parsed.ok) return actionError(parsed.message);

    const result = await setAvailabilityExceptions(providerId, parsed.rows);
    if (!result.ok) return actionError(result.message);

    revalidateAvailabilityViews(providerId);
    return actionOk('Uitzonderingen opgeslagen.');
  });
}

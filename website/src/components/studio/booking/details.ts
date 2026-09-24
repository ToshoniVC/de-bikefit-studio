import type { BookActionInput } from './types';

/**
 * The details form's values, validation and mapping onto `bookAction`'s input.
 * Pure — the server validates again (zod in `@/lib/booking/public-booking`);
 * this layer only exists so a visitor sees Dutch messages next to the field
 * before anything is sent.
 */

export type DetailsValues = {
  name: string;
  email: string;
  phone: string;
  age: string;
  childName: string;
  childAge: string;
  guardianName: string;
  guardianEmail: string;
  guardianPhone: string;
  street: string;
  city: string;
  bikeType: string;
  bikeModel: string;
  notes: string;
  /** Honeypot. */
  website: string;
};

export type DetailsField = keyof DetailsValues;

export const EMPTY_DETAILS: DetailsValues = {
  name: '',
  email: '',
  phone: '',
  age: '',
  childName: '',
  childAge: '',
  guardianName: '',
  guardianEmail: '',
  guardianPhone: '',
  street: '',
  city: '',
  bikeType: '',
  bikeModel: '',
  notes: '',
  website: '',
};

export type DetailsMode = {
  /** Jeugdfit: the parent is the contact, the child is the one being fitted. */
  guardian: boolean;
  /** The fit happens at the customer's place, so we need an address. */
  address: boolean;
};

/** "We fitten koers-, gravel-, mountain-, stads-, toer- en e-bikes." */
export const BIKE_TYPES = [
  'Koersfiets',
  'Gravelfiets',
  'Mountainbike',
  'Stadsfiets',
  'Toerfiets',
  'E-bike',
  'Andere',
] as const;

export const NOTES_MAX = 2000;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function isPhone(value: string): boolean {
  return /^[+\d\s()./-]+$/.test(value) && value.replace(/\D/g, '').length >= 8;
}

function isAge(value: string): boolean {
  const age = Number(value);
  return /^\d{1,3}$/.test(value) && age >= 1 && age <= 120;
}

/** The fields in the order they appear, so the first error can take focus. */
export function fieldOrder(mode: DetailsMode): DetailsField[] {
  const contact: DetailsField[] = mode.guardian
    ? ['childName', 'childAge', 'guardianName', 'guardianEmail', 'guardianPhone']
    : ['name', 'email', 'phone', 'age'];
  return [
    ...contact,
    ...(mode.address ? (['street', 'city'] as DetailsField[]) : []),
    'bikeType',
    'bikeModel',
    'notes',
  ];
}

export function validateDetails(
  raw: DetailsValues,
  mode: DetailsMode,
): Partial<Record<DetailsField, string>> {
  const v = trimmed(raw);
  const errors: Partial<Record<DetailsField, string>> = {};

  const email = (field: DetailsField, value: string) => {
    if (!value) errors[field] = 'Vul je e-mailadres in.';
    else if (!EMAIL.test(value)) errors[field] = 'Dit e-mailadres lijkt niet te kloppen.';
  };
  const phone = (field: DetailsField, value: string) => {
    if (!value) errors[field] = 'Vul je telefoonnummer in.';
    else if (!isPhone(value)) errors[field] = 'Dit telefoonnummer lijkt niet te kloppen.';
  };

  if (mode.guardian) {
    if (!v.childName) errors.childName = 'Vul de naam van je kind in.';
    if (!v.childAge) errors.childAge = 'Vul de leeftijd van je kind in.';
    else if (!isAge(v.childAge)) errors.childAge = 'Vul een leeftijd tussen 1 en 120 in.';
    if (!v.guardianName) errors.guardianName = 'Vul je naam in.';
    email('guardianEmail', v.guardianEmail);
    phone('guardianPhone', v.guardianPhone);
  } else {
    if (!v.name) errors.name = 'Vul je voornaam en naam in.';
    email('email', v.email);
    phone('phone', v.phone);
    if (v.age && !isAge(v.age))
      errors.age = 'Vul een leeftijd tussen 1 en 120 in, of laat het leeg.';
  }

  if (mode.address) {
    if (!v.street) errors.street = 'Vul de straat en het huisnummer in.';
    if (!v.city) errors.city = 'Vul de postcode en gemeente in.';
  }

  if (v.notes.length > NOTES_MAX) {
    errors.notes = `Houd het kort: maximaal ${NOTES_MAX} tekens.`;
  }

  return errors;
}

export function toBookInput(
  raw: DetailsValues,
  mode: DetailsMode,
): Omit<BookActionInput, 'serviceId' | 'providerId' | 'startsAt'> {
  const v = trimmed(raw);
  const bikeDetails = [
    v.bikeType ? `Type: ${v.bikeType}` : '',
    v.bikeModel ? `Merk en model: ${v.bikeModel}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const common = {
    address: mode.address ? [v.street, v.city].filter(Boolean).join(', ') : '',
    bikeDetails,
    notes: v.notes,
    website: raw.website,
  };

  if (mode.guardian) {
    return {
      ...common,
      name: v.childName,
      age: v.childAge ? Number(v.childAge) : null,
      email: v.guardianEmail,
      phone: v.guardianPhone,
      guardianName: v.guardianName,
      guardianEmail: v.guardianEmail,
      guardianPhone: v.guardianPhone,
    };
  }

  return {
    ...common,
    name: v.name,
    age: v.age ? Number(v.age) : null,
    email: v.email,
    phone: v.phone,
    guardianName: '',
    guardianEmail: '',
    guardianPhone: '',
  };
}

/** Maps a server-side field error (keyed by `BookActionInput`) back onto a form field. */
export function formFieldFor(inputKey: string, mode: DetailsMode): DetailsField | null {
  const guardianMap: Record<string, DetailsField> = {
    name: 'childName',
    age: 'childAge',
    email: 'guardianEmail',
    phone: 'guardianPhone',
  };
  if (mode.guardian && guardianMap[inputKey]) return guardianMap[inputKey];
  if (inputKey === 'address') return 'street';
  if (inputKey === 'bikeDetails') return 'bikeModel';
  return inputKey in EMPTY_DETAILS ? (inputKey as DetailsField) : null;
}

function trimmed(values: DetailsValues): DetailsValues {
  const out = { ...values };
  for (const key of Object.keys(out) as DetailsField[]) out[key] = out[key].trim();
  return out;
}

import { describe, expect, it } from 'vitest';
import { EMPTY_DETAILS, toBookInput, validateDetails, type DetailsValues } from './details';

const ADULT = { guardian: false, address: false };
const YOUTH = { guardian: true, address: false };

const adult = (phone: string): DetailsValues => ({
  ...EMPTY_DETAILS,
  name: 'Anna Peeters',
  email: 'anna@example.com',
  phone,
});
const youth = (guardianPhone: string): DetailsValues => ({
  ...EMPTY_DETAILS,
  childName: 'Tom',
  childAge: '12',
  guardianName: 'Anna Peeters',
  guardianEmail: 'anna@example.com',
  guardianPhone,
});

describe('booking form phone: one +32 prefix, adult and Jeugdfit guardian alike', () => {
  it.each(['0470 12 34 56', '+32 470 12 34 56', '0032470123456', '+32 0470123456'])(
    'adult %j is sent as +32 470 12 34 56',
    (phone) => {
      expect(validateDetails(adult(phone), ADULT)).toEqual({});
      expect(toBookInput(adult(phone), ADULT).phone).toBe('+32 470 12 34 56');
    },
  );

  it.each(['0470 12 34 56', '+32 470 12 34 56'])(
    'guardian %j is the contact phone and the guardian phone, normalized',
    (phone) => {
      expect(validateDetails(youth(phone), YOUTH)).toEqual({});
      const input = toBookInput(youth(phone), YOUTH);
      expect(input.phone).toBe('+32 470 12 34 56');
      expect(input.guardianPhone).toBe('+32 470 12 34 56');
    },
  );

  it('treats the "+32 " the field starts with as empty', () => {
    expect(validateDetails(adult('+32 '), ADULT).phone).toBe('Vul je telefoonnummer in.');
    expect(validateDetails(youth('+32'), YOUTH).guardianPhone).toBe('Vul je telefoonnummer in.');
  });

  it('refuses what is not a number we can call', () => {
    for (const phone of ['0470', '+32 470 12 34 56 78', 'bel me', '12345678901234567890']) {
      expect(validateDetails(adult(phone), ADULT).phone, phone).toBe(
        'Dit telefoonnummer lijkt niet te kloppen.',
      );
      expect(validateDetails(youth(phone), YOUTH).guardianPhone, phone).toBe(
        'Dit telefoonnummer lijkt niet te kloppen.',
      );
    }
  });

  it('keeps a foreign number', () => {
    expect(validateDetails(adult('+31 6 12345678'), ADULT)).toEqual({});
    expect(toBookInput(adult('+31 6 12345678'), ADULT).phone).toBe('+31612345678');
  });
});

import { describe, expect, it } from 'vitest';
import { assignmentRecipients } from './assignment-recipients';

describe('assignmentRecipients', () => {
  it('sends the to-do to the order-and-enquiry inbox when one is set', () => {
    expect(
      assignmentRecipients({
        inbox: 'planning@studio.invalid',
        adminEmails: ['toshoni@studio.invalid'],
      }),
    ).toEqual(['planning@studio.invalid']);
  });

  it('falls back to every active admin, once each, when no inbox is set', () => {
    expect(
      assignmentRecipients({
        inbox: '  ',
        adminEmails: [
          'Toshoni@studio.invalid',
          'toshoni@studio.invalid',
          ' second@studio.invalid ',
          '',
          'geen-adres',
        ],
      }),
    ).toEqual(['Toshoni@studio.invalid', 'second@studio.invalid']);
  });

  it('sends nothing to nobody', () => {
    expect(assignmentRecipients({ inbox: '', adminEmails: [] })).toEqual([]);
  });
});

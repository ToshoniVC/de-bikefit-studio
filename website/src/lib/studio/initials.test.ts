import { describe, expect, it } from 'vitest';
import { initialsFor } from './initials';

describe('initialsFor', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsFor('Rutger Roelandts')).toBe('RR');
    expect(initialsFor('Robin Van Lierde')).toBe('RV');
    expect(initialsFor('Goran Van de Walle')).toBe('GV');
  });

  it('copes with one word, extra spaces, lower case and accents', () => {
    expect(initialsFor('Rutger')).toBe('R');
    expect(initialsFor('  émile   dewaele ')).toBe('ÉD');
    expect(initialsFor('')).toBe('');
  });
});

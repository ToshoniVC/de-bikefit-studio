import { describe, expect, it } from 'vitest';
import { redirectTarget } from './redirect-target';

describe('redirectTarget', () => {
  it('carries the service context of a retired page over', () => {
    expect(redirectTarget('/afspraak', { dienst: 'coaching' })).toBe('/afspraak?dienst=coaching');
  });

  it('returns the stored target untouched when the request has no query', () => {
    expect(redirectTarget('/afspraak', {})).toBe('/afspraak');
    expect(redirectTarget('/ons-team?x=a%20b#team', {})).toBe('/ons-team?x=a%20b#team');
    expect(redirectTarget('/afspraak', { dienst: undefined })).toBe('/afspraak');
  });

  it('keeps the hash last and lets the stored parameters win', () => {
    expect(redirectTarget('/afspraak#boeken', { dienst: 'voetanalyse' })).toBe(
      '/afspraak?dienst=voetanalyse#boeken',
    );
    expect(redirectTarget('/afspraak?dienst=jeugdfit', { dienst: 'coaching', ref: 'mail' })).toBe(
      '/afspraak?dienst=jeugdfit&ref=mail',
    );
  });

  it('repeats multi-valued parameters and encodes values', () => {
    expect(redirectTarget('/x', { tag: ['a', 'b c'], q: 'é&x' })).toBe(
      '/x?tag=a&tag=b+c&q=%C3%A9%26x',
    );
  });

  it('never changes the destination host', () => {
    const target = redirectTarget('/afspraak', { next: '//evil.example', dienst: '@evil' });
    expect(target.startsWith('/afspraak?')).toBe(true);
    expect(new URL(target, 'https://studio.test').host).toBe('studio.test');
  });
});

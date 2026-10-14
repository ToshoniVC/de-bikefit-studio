import { describe, expect, it } from 'vitest';
import { analyticsPageView, CAMPAIGN_KEYS, MASKED_CANCEL_PATH } from './page-view';

const ORIGIN = 'https://studio.invalid';
const CANCEL_LOCATION = `${ORIGIN}${MASKED_CANCEL_PATH}`;

/**
 * Shaped like a real cancel token (32 random bytes in base64url: 43 characters
 * of `[A-Za-z0-9_-]`) but built from a fixed string. Not a real token.
 */
const TOKEN = 'Kanarie_GA4-'.repeat(4).slice(0, 43);

/** True when any 8 consecutive characters of the token occur in `value`. */
function containsTokenPart(value: string): boolean {
  for (let start = 0; start + 8 <= TOKEN.length; start += 1) {
    if (value.includes(TOKEN.slice(start, start + 8))) return true;
  }
  return false;
}

describe('analyticsPageView on the cancel link', () => {
  it('is tested with a dummy token shaped like a real one', () => {
    expect(TOKEN).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('reports /afspraak/annuleren/[token] instead of the token', () => {
    const view = analyticsPageView({
      pathname: `/afspraak/annuleren/${TOKEN}`,
      origin: ORIGIN,
      search: '',
    });
    expect(view).toEqual({
      page_path: '/afspraak/annuleren/[token]',
      page_location: 'https://studio.invalid/afspraak/annuleren/[token]',
    });
    expect(view.page_path).not.toContain(TOKEN);
    expect(view.page_location).not.toContain(TOKEN);
  });

  it('sends no query and no fragment, not even campaign keys', () => {
    const view = analyticsPageView({
      pathname: `/afspraak/annuleren/${TOKEN}`,
      origin: ORIGIN,
      search: `?utm_source=mail&utm_campaign=bevestiging&token=${TOKEN}#${TOKEN}`,
    });
    expect(view).toEqual({ page_path: MASKED_CANCEL_PATH, page_location: CANCEL_LOCATION });
  });

  it('masks a trailing slash, deeper segments and an empty token', () => {
    for (const pathname of [
      `/afspraak/annuleren/${TOKEN}/`,
      `/afspraak/annuleren/${TOKEN}/bevestigen`,
      `/afspraak/annuleren/${TOKEN}/a/b/`,
      '/afspraak/annuleren/',
    ]) {
      expect(analyticsPageView({ pathname, origin: ORIGIN }), pathname).toEqual({
        page_path: MASKED_CANCEL_PATH,
        page_location: CANCEL_LOCATION,
      });
    }
  });

  it('masks a re-cased, percent-encoded or doubled-slash copy of the link', () => {
    for (const pathname of [
      `/Afspraak/ANNULEREN/${TOKEN}`,
      `/afspraak/annuler%65n/${TOKEN}`,
      `/afspraak%2Fannuleren%2F${TOKEN}`,
      `/afspraak/annuler%65n/${TOKEN}%E0%A4%A`,
      `//afspraak//annuleren/${TOKEN}`,
      `afspraak/annuleren/${TOKEN}`,
    ]) {
      expect(analyticsPageView({ pathname, origin: ORIGIN }), pathname).toEqual({
        page_path: MASKED_CANCEL_PATH,
        page_location: CANCEL_LOCATION,
      });
    }
  });

  it('never returns a "?", a "#" or any part of the token', () => {
    const pathnames = [
      `/afspraak/annuleren/${TOKEN}`,
      `/afspraak/annuleren/${TOKEN}/`,
      `/afspraak/annuleren/${TOKEN}?token=${TOKEN}#${TOKEN}`,
    ];
    const searches = [
      '',
      '?utm_source=mail',
      `?ref=${TOKEN}&utm_content=${TOKEN}`,
      `?x=1#${TOKEN}`,
    ];
    for (const origin of [ORIGIN, 'http://localhost:3000']) {
      for (const pathname of pathnames) {
        for (const search of searches) {
          const { page_path, page_location } = analyticsPageView({ pathname, origin, search });
          for (const value of [page_path, page_location]) {
            expect(value, `${pathname} ${search}`).not.toMatch(/[?#]/);
            expect(containsTokenPart(value), `${pathname} ${search}`).toBe(false);
          }
        }
      }
    }
  });

  it('leaves /afspraak/annuleren without a token and look-alike paths alone', () => {
    for (const pathname of [
      '/afspraak/annuleren',
      '/afspraak/annuleren-of-verplaatsen',
      '/afspraak',
    ]) {
      expect(analyticsPageView({ pathname, origin: ORIGIN }), pathname).toEqual({
        page_path: pathname,
        page_location: `${ORIGIN}${pathname}`,
      });
    }
  });
});

describe('analyticsPageView on other pages', () => {
  it('drops the signed ref and the fragment on /afspraak/bevestigd', () => {
    const expected = {
      page_path: '/afspraak/bevestigd',
      page_location: 'https://studio.invalid/afspraak/bevestigd',
    };
    expect(
      analyticsPageView({
        pathname: '/afspraak/bevestigd',
        origin: ORIGIN,
        search: '?ref=abc.def',
      }),
    ).toEqual(expected);
    expect(
      analyticsPageView({
        pathname: '/afspraak/bevestigd',
        origin: ORIGIN,
        search: '?ref=abc.def#x',
      }),
    ).toEqual(expected);
    expect(
      analyticsPageView({ pathname: '/afspraak/bevestigd?ref=abc.def#x', origin: ORIGIN }),
    ).toEqual(expected);
  });

  it('drops the ?dienst= preselection of a booking link', () => {
    expect(
      analyticsPageView({ pathname: '/afspraak', origin: ORIGIN, search: '?dienst=bikefit' }),
    ).toEqual({ page_path: '/afspraak', page_location: 'https://studio.invalid/afspraak' });
  });

  it('keeps only the five utm keys, in a fixed order, re-serialised', () => {
    const view = analyticsPageView({
      pathname: '/aanbod',
      origin: ORIGIN,
      search:
        '?gclid=abc&utm_campaign=lente+2026&ref=xyz&utm_source=nieuwsbrief&utm_medium=email' +
        '&fbclid=def&utm_term=bikefit&utm_content=knop&dienst=bikefit',
    });
    expect(view).toEqual({
      page_path: '/aanbod',
      page_location:
        'https://studio.invalid/aanbod?utm_source=nieuwsbrief&utm_medium=email' +
        '&utm_campaign=lente+2026&utm_term=bikefit&utm_content=knop',
    });
    expect([...new URL(view.page_location).searchParams.keys()]).toEqual([...CAMPAIGN_KEYS]);
  });

  it('cannot be made to carry another key or a fragment through a campaign value', () => {
    const view = analyticsPageView({
      pathname: '/',
      origin: ORIGIN,
      search:
        '?utm_campaign=lente%26ref%3Dgeheim%23x&UTM_SOURCE=hoofdletters&utm_source=' +
        '&utm_medium=a&utm_medium=b',
    });
    expect(view.page_location).toBe(
      'https://studio.invalid/?utm_medium=a&utm_campaign=lente%26ref%3Dgeheim%23x',
    );
    const params = new URL(view.page_location).searchParams;
    expect([...params.keys()]).toEqual(['utm_medium', 'utm_campaign']);
    expect(params.get('utm_campaign')).toBe('lente&ref=geheim#x');
    expect(view.page_location).not.toContain('#');
  });

  it('cuts a fragment off the search before reading the campaign keys', () => {
    expect(
      analyticsPageView({
        pathname: '/aanbod',
        origin: ORIGIN,
        search: '?utm_source=nieuwsbrief#boeken',
      }),
    ).toEqual({
      page_path: '/aanbod',
      page_location: 'https://studio.invalid/aanbod?utm_source=nieuwsbrief',
    });
  });

  it('reports the root, nested paths and an origin with a port', () => {
    expect(analyticsPageView({ pathname: '/', origin: ORIGIN })).toEqual({
      page_path: '/',
      page_location: 'https://studio.invalid/',
    });
    expect(analyticsPageView({ pathname: '/aanbod/bikefit/racefiets', origin: ORIGIN })).toEqual({
      page_path: '/aanbod/bikefit/racefiets',
      page_location: 'https://studio.invalid/aanbod/bikefit/racefiets',
    });
    expect(
      analyticsPageView({
        pathname: '/afspraak',
        origin: 'http://localhost:3000',
        search: '?utm_source=test',
      }),
    ).toEqual({
      page_path: '/afspraak',
      page_location: 'http://localhost:3000/afspraak?utm_source=test',
    });
  });

  it('tolerates a trailing slash on the origin, a path without "/" and a bare search', () => {
    expect(
      analyticsPageView({ pathname: '/contact?x=1#formulier', origin: 'https://studio.invalid/' }),
    ).toEqual({ page_path: '/contact', page_location: 'https://studio.invalid/contact' });
    expect(
      analyticsPageView({ pathname: '', origin: ORIGIN, search: 'utm_source=zonder-vraagteken' }),
    ).toEqual({
      page_path: '/',
      page_location: 'https://studio.invalid/?utm_source=zonder-vraagteken',
    });
  });

  it('needs no browser: it never reads window or location itself', () => {
    expect(typeof window).toBe('undefined');
    expect(analyticsPageView({ pathname: '/', origin: ORIGIN }).page_location).toBe(`${ORIGIN}/`);
  });
});

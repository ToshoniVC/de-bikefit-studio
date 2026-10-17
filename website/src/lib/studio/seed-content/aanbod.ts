import { OFFER_CATEGORY_LABELS, OFFER_INDEX_PATH } from '@/lib/offers/catalogue';
import { editorialImage } from '@/lib/studio/editorial-images';
import { CADEAUBON_CARD } from './cadeaubon';
import {
  HERO_SUBTITLE,
  AANBOD_INTRO,
  JUNIOR_TEXT,
  MOTION_ANALYSIS_TEXT,
  TEAM_INTRO,
  TEAM_MEMBERS,
} from './copy';
import {
  BOOKING_PATH,
  CONTACT_BLOCK,
  INSPECTION_CARDS,
  PHONE_HREF,
  PHONE_LABEL,
  PROCESS_STEPS,
  type SeedBlock,
  type SeedPage,
} from './shared';

/**
 * The redesigned public site of 13 Oct 2026: the offer overview ("Aanbod"),
 * audiences ("Voor wie"), the bikefit page and the team — plus the menus and
 * the redirects. Plain data, no I/O. The offerings themselves are not pages
 * since 17 Oct 2026: they are rows in `cms_offerings` (`src/lib/offers/defaults.ts`,
 * written by `cms:bootstrap`) and the overview blocks read them at render time.
 *
 * Used by `npm run cms:seed` (fresh databases) and by the staging rollout
 * `npm run cms:rollout-aanbod`, which applies exactly these pages, menus and
 * redirects to an existing database (dry run, backup, restore).
 *
 * COPY PROVENANCE
 *   work block 2026-10-13-aanbod-staging-brief.md (Toshoni via Winston): hero,
 *     aanbod intro, the junior text, the 3D text and the team intro — verbatim
 *     (the seven offers: `src/lib/offers/defaults.ts`).
 *   prototype/index.html, prototype/bikefit.html, content/index.html,
 *     content/about.html: everything reused from the earlier site (process,
 *     "Vier dingen, één positie", "Waarom", "Op locatie", persona copy, the
 *     callout) and Rutger's own first-person text.
 *   Short connective lines (group ledes, section titles) are neutral and claim
 *   nothing beyond those sources. No prices, durations, credentials, titles,
 *   years or achievements are added; Robin's and Goran's profiles carry only
 *   their name and the fact that they are part of the team.
 *   Toshoni's site review of the same day (work block
 *     2026-10-13-page-cleanup): no "Ninove" kicker on /aanbod, /voor-wie and
 *     /ons-team, no second heading above the audiences or the profiles, and
 *     "jeugd" for the young riders. `cms:patch-page-cleanup` applies exactly
 *     that to an existing database (see `page-cleanup.ts`).
 *   Toshoni's gift voucher request of the same day: the "Overige" group on
 *     /aanbod with the voucher card. The voucher page itself is `cadeaubon.ts`.
 */

const CALLOUT: SeedBlock = {
  type: 'cta',
  data: {
    variant: 'accent',
    title: 'Comfort is een keuze. Maak ze.',
    body: '',
    primaryCta: { label: 'Afspraak maken →', href: BOOKING_PATH, external: false },
    secondaryCta: { label: PHONE_LABEL, href: PHONE_HREF, external: false },
  },
};

export const OFFER_GROUPS = [
  {
    category: 'bikefit',
    title: OFFER_CATEGORY_LABELS.bikefit,
    lede: 'Je fiets, je zadel, je voeten en je schoenplaatjes, afgestemd op jou.',
  },
  {
    category: 'begeleiding',
    title: OFFER_CATEGORY_LABELS.begeleiding,
    lede: 'Inzicht en opvolging die met je meegroeit.',
  },
];

/**
 * "Overige" with the gift voucher (Toshoni, 13 Oct 2026), after the existing
 * groups — on /aanbod only; home and /bikefit keep their own selection.
 */
export const OTHER_OFFER_GROUP = {
  category: 'overige',
  title: OFFER_CATEGORY_LABELS.overige,
  lede: '',
};

// --------------------------------------------------------------- pages ----

const HOME: SeedPage = {
  slug: '',
  title: 'Home',
  translationGroup: 'home',
  source: 'work block 2026-10-13 (hero, aanbod) + prototype/index.html + content/about.html',
  metaTitle: 'De Bikefit Studio — Meer plezier. Op jouw fiets.',
  metaDescription:
    'Bikefit, voet- en zadelanalyse, schoenplaatjes, lactaattest en coaching in Ninove. Persoonlijke fietsbegeleiding, in de studio, dichtbij of bij jou thuis.',
  structuredDataType: 'WebPage',
  blocks: [
    {
      type: 'hero',
      data: {
        variant: 'full',
        eyebrow: 'De Bikefit Studio · Ninove',
        title: 'Meer plezier.',
        titleEmphasis: 'Op jouw fiets.',
        subtitle: HERO_SUBTITLE,
        primaryCta: { label: 'Afspraak maken →', href: BOOKING_PATH, external: false },
        secondaryCta: { label: 'Bekijk ons aanbod', href: OFFER_INDEX_PATH, external: false },
        image: editorialImage('flemish-cyclists'),
      },
    },
    {
      type: 'offerCatalogue',
      data: {
        variant: 'default',
        eyebrow: 'Aanbod',
        title: 'Wat we voor je doen',
        lede: 'Twee soorten hulp, één vertrekpunt: jij en je fiets.',
        groups: OFFER_GROUPS,
        // Prices only on /aanbod and the offer pages (Toshoni, 13 Oct 2026).
        showPrices: false,
        cta: { label: 'Bekijk het volledige aanbod', href: OFFER_INDEX_PATH, external: false },
      },
    },
    {
      type: 'imageText',
      data: {
        variant: 'gray',
        eyebrow: 'Voor wie',
        title: 'Voor elke fietser',
        paragraphs: [
          'Of je nu zeven of zeventig bent, koerst of pendelt, een weekendrijder of een doordeweekse toerist — iedereen verdient het om te genieten van alles wat een fiets te bieden heeft.',
        ],
        bullets: [
          'Jong en minder jong',
          'Beginners en ervaren fietsers',
          'Recreatief en competitief',
          'Koers, gravel en mountainbike',
          'Woon-werkverkeer en e-bike',
        ],
        cta: { label: 'Voor wie is dit?', href: '/voor-wie', external: false },
        image: editorialImage('junior-coaching'),
        imagePosition: 'left',
      },
    },
    {
      type: 'imageText',
      data: {
        variant: 'dark',
        eyebrow: 'Bikefit',
        title: 'Jij blijft het vertrekpunt',
        paragraphs: [MOTION_ANALYSIS_TEXT],
        cta: { label: 'Zo verloopt een bikefit', href: '/bikefit', external: false },
        image: editorialImage('bikefit-studio'),
        imagePosition: 'right',
      },
    },
    {
      type: 'cta',
      data: {
        variant: 'gray',
        title: 'Goede begeleiding begint bij de juiste mensen.',
        body: 'We kiezen ons team op ervaring, vakkennis en de nodige diploma’s, maar ook op de manier waarop iemand luistert.',
        primaryCta: { label: 'Maak kennis met ons team', href: '/ons-team', external: false },
        secondaryCta: null,
      },
    },
    CONTACT_BLOCK,
    CALLOUT,
  ],
};

const AANBOD: SeedPage = {
  slug: 'aanbod',
  title: 'Aanbod',
  translationGroup: 'offer',
  source: 'work block 2026-10-13 (aanbod intro); the offerings are rows in cms_offerings',
  metaTitle: 'Ons aanbod — bikefit en begeleiding',
  metaDescription:
    'Bikefit bij aankoop of op je huidige fiets, voetanalyse, zadelanalyse, schoenplaatjes afstellen, lactaattest en coaching in Ninove.',
  structuredDataType: 'WebPage',
  blocks: [
    {
      type: 'hero',
      data: {
        variant: 'pageHead',
        eyebrow: 'Aanbod',
        title: 'Ons aanbod',
        titleEmphasis: '',
        subtitle: AANBOD_INTRO,
        primaryCta: null,
        secondaryCta: null,
      },
    },
    {
      type: 'offerCatalogue',
      data: {
        variant: 'default',
        eyebrow: '',
        title: '',
        lede: '',
        groups: [...OFFER_GROUPS, OTHER_OFFER_GROUP],
        // The gift voucher is not an offering: a fixed card under Overige.
        extraCards: [CADEAUBON_CARD],
        showPrices: true,
        cta: null,
      },
    },
    CALLOUT,
  ],
};

const VOOR_WIE: SeedPage = {
  slug: 'voor-wie',
  title: 'Voor wie',
  translationGroup: 'audience',
  source: 'work block 2026-10-13 (audiences, junior text) + content/index.html persona copy',
  metaTitle: 'Voor wie — elke fietser, op elke leeftijd',
  metaDescription:
    'Voor jong en minder jong, beginners en ervaren fietsers, recreatief en competitief, koers, gravel en mountainbike, woon-werk en e-bike. Extra aandacht voor de jeugd.',
  structuredDataType: 'WebPage',
  blocks: [
    {
      type: 'hero',
      data: {
        variant: 'pageHead',
        eyebrow: 'Voor wie',
        title: 'Voor elke fietser',
        titleEmphasis: '',
        subtitle:
          'Of je nu zeven of zeventig bent, koerst of pendelt, een weekendrijder of een doordeweekse toerist — iedereen verdient het om te genieten van alles wat een fiets te bieden heeft.',
        primaryCta: null,
        secondaryCta: null,
      },
    },
    {
      type: 'audience',
      data: {
        variant: 'gray',
        // No section heading: the audiences follow the page head directly.
        eyebrow: '',
        title: '',
        lede: '',
        items: [
          {
            number: '01',
            title: 'Jonge fietsers',
            body: 'Kinderen groeien snel — een fiets die vandaag past, klopt volgend seizoen al niet meer. We volgen de pasvorm op terwijl ze groeien.',
            featured: true,
          },
          {
            number: '02',
            title: 'Beginners en ervaren fietsers',
            body: 'Je eerste kilometers of al jaren onderweg: we bekijken wat jij nodig hebt.',
            featured: false,
          },
          {
            number: '03',
            title: 'Recreatief en competitief',
            body: 'Voor de weekendrit die fris moet eindigen, niet stijf en pijnlijk de ochtend erna, en voor wie een sportief doel voor ogen heeft.',
            featured: false,
          },
          {
            number: '04',
            title: 'Koers, gravel en mountainbike',
            body: 'De principes blijven dezelfde: het lichaam van de fietser moet bij de fiets passen. We fitten koers-, gravel-, mountain-, stads-, toer- en e-bikes.',
            featured: false,
          },
          {
            number: '05',
            title: 'Woon-werk en e-bike',
            body: 'Vijf dagen per week, weer of geen weer. Een pasvorm die het volhoudt naast de koude handen en de natte broek, ook op een e-bike.',
            featured: false,
          },
          {
            number: '06',
            title: 'Wielertoeristen',
            body: 'Lange dagen, zware tassen, verre horizonten — een pasvorm waar je op kilometer 200 nog op kan rekenen, maakt van de tocht wat ze hoort te zijn.',
            featured: false,
          },
        ],
      },
    },
    {
      type: 'imageText',
      data: {
        variant: 'default',
        eyebrow: 'Jeugd',
        title: 'Jonge fietsers groeien',
        paragraphs: [JUNIOR_TEXT],
        cta: { label: 'Bekijk het aanbod', href: OFFER_INDEX_PATH, external: false },
        image: editorialImage('junior-coaching'),
        imagePosition: 'right',
      },
    },
    {
      type: 'cta',
      data: {
        variant: 'accent',
        title: 'Benieuwd wat bij jou past?',
        body: '',
        primaryCta: { label: 'Bekijk het aanbod →', href: OFFER_INDEX_PATH, external: false },
        secondaryCta: { label: 'Afspraak maken', href: BOOKING_PATH, external: false },
      },
    },
  ],
};

const BIKEFIT: SeedPage = {
  slug: 'bikefit',
  title: 'De bikefit',
  translationGroup: 'bikefit',
  source: 'prototype/bikefit.html + work block 2026-10-13 (3D text, offer structure)',
  metaTitle: 'De bikefit — hoe het werkt',
  metaDescription:
    'Wat een bikefit is, hoe hij verloopt en hoe we 3D-bewegingsanalyse gebruiken. Bikefit bij aankoop of op je huidige fiets, voet- en zadelanalyse en schoenplaatjes, in Ninove.',
  structuredDataType: 'WebPage',
  blocks: [
    {
      type: 'hero',
      data: {
        variant: 'pageHead',
        eyebrow: 'Bikefit · Ninove',
        title: 'De bikefit',
        titleEmphasis: '',
        subtitle:
          'Een fiets die niet bij jouw lichaam past, kost je op drie manieren: pijn, verloren kracht, en kortere ritten. Een bikefit lijnt de fiets uit op jou — niet omgekeerd.',
        primaryCta: { label: 'Bekijk de bikefitdiensten', href: '#aanbod', external: false },
        secondaryCta: null,
      },
    },
    {
      type: 'imageText',
      data: {
        variant: 'default',
        eyebrow: 'Waarom een bikefit',
        title: 'Waarom is een bikefit belangrijk?',
        paragraphs: [
          'Een fiets die niet bij jouw lichaam past, kost je op drie manieren: pijn, verloren kracht, en kortere ritten. Een bikefit lijnt de fiets uit op jou — niet omgekeerd — zodat elke rit beter voelt en je langer gezond blijft op de fiets.',
          'Voor de meeste volwassenen is dat om de 18 tot 24 maanden zinvol, of telkens als er iets verandert: een nieuwe fiets, een blessure, een grote verandering in gewicht of soepelheid, of een nieuw doel. Voor kinderen vaker — zij groeien, de pasvorm groeit niet mee.',
        ],
        quote:
          'Geen pijn. Geen lichaam dat eerder opgeeft dan de weg. Geen fiets die tegen je vecht. Gewoon de rit.',
        image: editorialImage('flemish-cyclists'),
        imagePosition: 'right',
      },
    },
    {
      type: 'imageText',
      data: {
        variant: 'dark',
        eyebrow: '3D-bewegingsanalyse',
        title: 'Meten om beter te kijken',
        paragraphs: [MOTION_ANALYSIS_TEXT],
        image: editorialImage('bikefit-studio'),
        imagePosition: 'left',
      },
    },
    {
      type: 'services',
      data: {
        variant: 'gray',
        eyebrow: 'Wat we bekijken',
        title: 'Vier dingen, één positie',
        lede: 'We kijken naar jou op de fiets: houding, trapbeweging, zadelpositie en bewegingspatronen. Daaruit bouwen we stap voor stap jouw positie op.',
        columns: 4,
        cards: INSPECTION_CARDS,
      },
    },
    {
      type: 'process',
      data: {
        variant: 'default',
        eyebrow: 'Werkwijze',
        title: 'Hoe verloopt een bikefit?',
        lede: 'Een gesprek, een blik op jou en je fiets, en stap voor stap aanpassen tot alles klopt. We haasten ons niet — als het klaar is, is het klaar.',
        steps: PROCESS_STEPS,
      },
    },
    {
      type: 'imageText',
      data: {
        variant: 'dark',
        eyebrow: 'Op locatie',
        title: 'Kan een bikefit ook bij mij thuis?',
        paragraphs: [
          'Ja — voor groepen, clubs en gezinnen komen we op locatie. Voor de meeste individuele fits werken we liever in de studio, omdat we daar meer controle hebben.',
          'Maar als je niet naar ons kan komen, komen wij naar jou. Neem contact op en we bekijken het samen.',
        ],
        imagePosition: 'left',
      },
    },
    {
      type: 'imageText',
      data: {
        variant: 'default',
        eyebrow: 'Jonge fietsers',
        title: 'Kinderen groeien. De pasvorm groeit niet mee.',
        paragraphs: [
          'Een fiets die vandaag past, klopt volgend seizoen al niet meer, en een lichaam in groei went aan alles wat je het oplegt. Voor jonge wedstrijdrijders die al echt uren op het zadel zitten, kost een slechte pasvorm niet alleen watts op koersdag; ze legt gewoontes vast die nog jaren later meegaan.',
          'We volgen de pasvorm op terwijl ze groeien.',
        ],
        bullets: [
          'Aandacht voor groei en veranderende lichaamsverhoudingen',
          'Vaker terugkomen dan volwassenen, want zij groeien door',
        ],
        cta: { label: 'Meer voor jonge fietsers', href: '/voor-wie', external: false },
        imagePosition: 'right',
      },
    },
    {
      type: 'offerCatalogue',
      data: {
        variant: 'gray',
        eyebrow: 'Aanbod',
        title: 'Onze bikefitdiensten',
        lede: 'Kies de dienst die bij je vraag past. Twijfel je? Bel ons, dan kijken we samen.',
        groups: [OFFER_GROUPS[0]],
        showPrices: false,
        cta: { label: 'Bekijk het volledige aanbod', href: OFFER_INDEX_PATH, external: false },
      },
    },
    CALLOUT,
  ],
};

const ONS_TEAM: SeedPage = {
  slug: 'ons-team',
  title: 'Ons team',
  translationGroup: 'team',
  source: 'work block 2026-10-13 (team intro, names) + content/about.html §1 (Rutger)',
  metaTitle: 'Ons team',
  metaDescription:
    'Goede begeleiding begint bij de juiste mensen. Maak kennis met het team van De Bikefit Studio in Ninove.',
  structuredDataType: 'AboutPage',
  blocks: [
    {
      type: 'hero',
      data: {
        variant: 'pageHead',
        eyebrow: 'Ons team',
        title: 'Ons team',
        titleEmphasis: '',
        subtitle: TEAM_INTRO,
        primaryCta: null,
        secondaryCta: null,
      },
    },
    {
      type: 'team',
      data: {
        variant: 'default',
        // No section heading: the three profiles follow "Ons team" directly.
        eyebrow: '',
        title: '',
        lede: '',
        members: TEAM_MEMBERS,
      },
    },
    CALLOUT,
  ],
};

/** Every page the offer rollout owns, in rollout order. The offerings themselves are rows (`cms:bootstrap`). */
export const AANBOD_PAGES: SeedPage[] = [HOME, AANBOD, VOOR_WIE, BIKEFIT, ONS_TEAM];

// Menus and the `/over-ons` redirect live in `navigation.ts`.
export { AANBOD_REDIRECTS, FOOTER_MENU, MAIN_MENU, RETIRED_PAGE_SLUG } from './navigation';

export {
  HERO_SUBTITLE,
  AANBOD_INTRO,
  JUNIOR_TEXT,
  MOTION_ANALYSIS_TEXT,
  TEAM_INTRO,
  TEAM_MEMBERS,
} from './copy';

/**
 * Verbatim copy of the 13 Oct 2026 redesign, supplied by Toshoni via Winston
 * (work block 2026-10-13-aanbod-staging-brief.md), and the team profiles.
 * The junior text follows Toshoni's site review of the same day: "jeugd"
 * instead of "junioren", and the four youth categories named.
 * Only Rutger has a source-backed bio (content/about.html §1); Robin and Goran
 * carry their name and team membership only. Plain data.
 */

export const HERO_SUBTITLE =
  'Van een fiets die beter past tot begeleiding die met je meegroeit. We luisteren naar jouw verhaal en helpen je op weg, in de studio, dichtbij of bij jou thuis.';

export const AANBOD_INTRO =
  'Elke fietser is anders. Daarom werkt De Bikefit Studio uitsluitend met ervaren, gediplomeerde professionals. Samen zoeken we wat bij jou past: van je eerste kilometers tot een nieuw sportief doel. Persoonlijke fietsbegeleiding, dichtbij — in de studio, op locatie of, waar mogelijk, bij jou thuis.';

export const JUNIOR_TEXT =
  'Jonge fietsers groeien. Hun fiets groeit niet vanzelf mee. Daarom besteden we extra aandacht aan de jeugd, met betaalbare begeleiding en opvolging op maat. Of je nu miniem, aspirant, nieuweling of junior bent, er blijft ruimte om te groeien, bij te leren en vooral graag te fietsen.';

export const MOTION_ANALYSIS_TEXT =
  'We gebruiken de nieuwste 3D-bewegingsanalyse om je houding en trapbeweging vanuit verschillende hoeken te bekijken. Die inzichten combineren we met jouw ervaring en de blik van onze fitter. Technologie helpt ons meten; jij blijft het vertrekpunt.';

export const TEAM_INTRO =
  'Goede begeleiding begint bij de juiste mensen. We kiezen ons team op ervaring, vakkennis en de nodige diploma’s, maar ook op de manier waarop iemand luistert. Je krijgt een aanpak die bij jou past, met heldere uitleg en aandacht voor jouw doelen.';

/**
 * Second bio line on an interim profile, so the card reads as unfinished on
 * purpose rather than as a finished one-line bio.
 */
export const TEAM_PROFILE_PENDING = 'Een uitgebreid profiel volgt binnenkort.';

/**
 * Team members. Only Rutger has a source-backed bio (content/about.html §1).
 * Open fields per person: docs/content-placeholders.md, T-rows.
 */
export const TEAM_MEMBERS = [
  {
    name: 'Rutger Roelandts',
    role: 'Oprichter',
    bio: [
      'Ik zit op een fiets zolang ik me kan herinneren. Negentien jaar competitie, en een heel leven daarbuiten gewoon fietsen — naar school, naar het werk, het heuvelland in op zondag.',
      'Daarom heb ik De Bikefit Studio opgericht. Iedereen verdient het om te genieten van alles wat een fiets te bieden heeft. Mijn werk is ervoor te zorgen dat jouw fiets je dat ook toelaat.',
    ],
    internalNote:
      'Register T-01–T-04. Bio: Rutgers eigen tekst uit content/about.html §1 (eerder gepubliceerd op /over-ons), ingekort; akkoord van Rutger nodig. Rol “Oprichter” volgt uit die tekst. Kwalificaties: niets vermeld. Foto: nog geen echte portretfoto (nu initialen).',
  },
  {
    name: 'Robin Van Lierde',
    role: '',
    bio: ['Robin maakt deel uit van het team van De Bikefit Studio.', TEAM_PROFILE_PENDING],
    internalNote:
      'OPEN (register T-05–T-08): bio, rol, kwalificaties/specialisaties en portretfoto nog op te vragen bij Robin. Niets invullen zonder bron; geen gegenereerd portret gebruiken. Verwijder de regel “profiel volgt” zodra de echte bio er staat.',
  },
  {
    name: 'Goran Van de Walle',
    role: '',
    bio: ['Goran maakt deel uit van het team van De Bikefit Studio.', TEAM_PROFILE_PENDING],
    internalNote:
      'OPEN (register T-09–T-12): bio, rol, kwalificaties/specialisaties en portretfoto nog op te vragen bij Goran. Niets invullen zonder bron; geen gegenereerd portret gebruiken. Verwijder de regel “profiel volgt” zodra de echte bio er staat.',
  },
];

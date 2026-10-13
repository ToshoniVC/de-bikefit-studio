/**
 * Seeds (and publishes) the Dutch public site.
 *
 *   npm run cms:seed                # create-or-update every page, then publish
 *   npm run cms:seed -- --only-missing   # never touch a page/menu that exists
 *   npm run cms:seed -- --refresh-slug afspraak
 *                                   # re-seed ONE page's draft blocks and
 *                                   # republish it; nothing else is touched
 *
 * Idempotent: the same input always produces the same published output, and a
 * second run changes nothing a reviewer would notice. Note that the default run
 * DOES overwrite draft blocks of the seeded pages — that is what makes it a
 * repeatable definition of the launch content. Use `--only-missing` once real
 * editing has started.
 *
 * `--refresh-slug <slug>` (also `--refresh-slug=<slug>`; `/` or `home` for the
 * home page) is for an environment where the pages already exist and have
 * been edited — e.g. staging getting the new `booking` block on `/afspraak`.
 * It replaces that page's draft blocks with the seed definition and publishes,
 * and leaves its title/SEO fields, every other page, the menus, the settings
 * and the redirects exactly as they are. If the page does not exist yet it is
 * created in full. It cannot be combined with `--only-missing`.
 *
 * ---------------------------------------------------------------------------
 * COPY PROVENANCE — every string below is lifted from the source material.
 * Nothing is invented: no prices, no street address, no commercial claims, no
 * testimonials. The one e-mail address is the confirmed CONTACT_EMAIL.
 *
 *   /, /aanbod, /aanbod/*, src/lib/studio/seed-content/aanbod.ts — the 13 Oct 2026
 *   /voor-wie, /bikefit,   redesign (work block 2026-10-13-aanbod-staging-brief.md
 *   /ons-team, menus       + the earlier prototype copy); provenance is in that
 *                          file's header. Also used by `cms:rollout-aanbod`.
 *                          `/over-ons` is no longer seeded: it redirects to
 *                          `/ons-team`.
 *   /veelgestelde-vragen   content/about.html §2 = prototype/bikefit.html
 *                          #vragen (identical 8 Q&A)
 *   /afspraak              src/lib/studio/seed-content/appointment.ts:
 *                          content/booking.html (step order: dienst → datum &
 *                          tijd → gegevens → bevestiging; tone notes) + the
 *                          `booking` block (online booking, decided 24 Sep
 *                          2026: no payment) + the "wat breng je mee" / "hoe
 *                          lang duurt het" answers from content/about.html +
 *                          "Andere vraag?" (Toshoni's review, 13 Oct 2026).
 *                          `/contact` is no longer seeded: it redirects here.
 *   /privacy               .winston work block 2026-09-24-legal-pages.md,
 *   /algemene-voorwaarden  pages 1 and 2 (standard Belgian texts, to be read
 *                          by a lawyer before production). Identity from the
 *                          KBO register (Qarakter BV, Weversstraat 7, 1730
 *                          Asse, BE 1036.912.281). `[E-MAILADRES]` is filled
 *                          in at seed time from settings `contact.email`, else
 *                          CONTACT_EMAIL (confirmed by Toshoni, 13 Oct 2026).
 *
 * ---------------------------------------------------------------------------
 * WHY THE MODULE STUBS BELOW
 *
 * The brief requires publishing to go through `repo.publishPage()` so the
 * snapshots are the real thing — same validation, same audit entries, same
 * cache busting as the admin UI. `repo.ts` is a `server-only` module that
 * resolves its actor from the `cms_session` cookie via `next/headers`, none of
 * which exists in a plain Node process.
 *
 * So instead of bypassing the write API, this script gives it the request
 * context it expects: three tiny in-process module stubs (`server-only`,
 * `next/headers`, `next/cache`) registered through Node's `module.registerHooks`,
 * plus a REAL `cms_sessions` row for a real admin user. Every permission check,
 * every block validation and every audit write therefore runs exactly as it
 * does in the browser. The session is revoked again before the script exits.
 */
import { config } from 'dotenv';
import { randomBytes } from 'node:crypto';
// Pure modules (no `server-only`, no Next imports): safe to load before the stubs.
import { escapeHtml } from '@/lib/html';
import {
  AANBOD_PAGES,
  AANBOD_REDIRECTS,
  FOOTER_MENU,
  MAIN_MENU,
} from '@/lib/studio/seed-content/aanbod';
import { AFSPRAAK_PAGE, CONTACT_REDIRECT } from '@/lib/studio/seed-content/appointment';
import { CADEAUBON_PAGE } from '@/lib/studio/seed-content/cadeaubon';
import {
  CALLOUT_BLOCK,
  CONTACT_EMAIL,
  PHONE_HREF,
  PHONE_LABEL,
  type SeedPage,
} from '@/lib/studio/seed-content/shared';
import { cookieJar, installRequestContextStubs } from './lib/request-context.mjs';

config({ path: '.env.local' });

// Must run before any `@/lib/cms/*` import (all of them are dynamic below).
installRequestContextStubs();

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

/** The eight Q&A from content/about.html §2 (identical in bikefit.html#vragen). */
const FAQ_ITEMS = [
  {
    question: 'Waarom is een bikefit belangrijk?',
    answer:
      'Een fiets die niet bij jouw lichaam past, kost je op drie manieren: pijn, verloren kracht, en kortere ritten. Een bikefit lijnt de fiets uit op jou — niet omgekeerd — zodat elke rit beter voelt en je langer gezond blijft op de fiets.',
  },
  {
    question: 'Hoe vaak moet ik een bikefit laten doen?',
    answer:
      'Voor de meeste volwassenen om de 18 tot 24 maanden — of telkens als er iets verandert. Een nieuwe fiets, een blessure, een grote verandering in gewicht of soepelheid, of een nieuw doel zijn allemaal goede redenen om terug te komen. Voor kinderen vaker: zij groeien, de pasvorm groeit niet mee.',
  },
  {
    question: 'Hoe verloopt een bikefit?',
    answer:
      'We beginnen met een gesprek over jouw lichaam, je doelen en je klachten. Daarna kijken we naar jou op de fiets — houding, trapbeweging, zadelpositie, bewegingspatronen. We passen stap voor stap aan, met feedback na elke aanpassing, tot alles klopt. Je vertrekt met begrip waarom jouw fiets staat zoals ze staat.',
  },
  {
    question: 'Kan een bikefit ook bij mij thuis?',
    answer:
      'Ja — voor groepen, clubs en gezinnen komen we op locatie. Voor de meeste individuele fits werken we liever in de studio, omdat we daar meer controle hebben, maar als je niet naar ons kan komen, komen wij naar jou. Neem contact op en we bekijken het samen.',
  },
  {
    question: 'Wat breng ik mee voor een bikefit?',
    answer:
      'Je fiets (proper en in werkende staat), de schoenen en fietskleding waarin je écht rijdt, en eventuele notities over wat je dwars zit. Meer hebben we niet nodig. De rest doen wij.',
  },
  {
    question: 'Hoe lang duurt een bikefit?',
    answer:
      'Reken op 90 minuten voor een standaard bikefit voor volwassenen. Een jeugdfit is korter — ongeveer 60 minuten. Complexe gevallen, eerste keren, of fits na een blessure kunnen tot twee uur duren. We haasten ons niet — als het klaar is, is het klaar.',
  },
  {
    question: 'Moet ik nieuwe onderdelen kopen?',
    answer:
      'Soms. Vaak niet. We werken altijd eerst met wat je al hebt; als een zadel, stuurpen of paar cleats echt niet bij jouw lichaam past, zeggen we het — met uitleg waarom, zonder druk.',
  },
  {
    question: 'Doen jullie ook e-bikes?',
    answer:
      'Ja. De principes blijven dezelfde — het lichaam van de fietser moet bij de fiets passen. We fitten koers-, gravel-, mountain-, stads-, toer- en e-bikes.',
  },
];

/**
 * The legal pages' contact address. The texts carry the placeholder
 * `[E-MAILADRES]` verbatim; `main()` replaces it with `contact.email` from the
 * site settings, or with the confirmed CONTACT_EMAIL when that is empty.
 */
const LEGAL_EMAIL_PLACEHOLDER = '[E-MAILADRES]';
const LEGAL_FALLBACK_EMAIL = CONTACT_EMAIL;

/** Privacyverklaring — work block 2026-09-24-legal-pages.md, page 1 (verbatim + KBO substitutions). */
const PRIVACY_HTML = `<p><em>Laatst bijgewerkt: 24 september 2026</em></p>

<h2>1. Wie zijn wij?</h2>
<p>De Bikefit Studio is een handelsnaam van <strong>Qarakter BV</strong>, met maatschappelijke zetel te Weversstraat 7, 1730 Asse, ingeschreven in de Kruispuntbank van Ondernemingen onder het nummer <strong>BE 1036.912.281</strong> (RPR Brussel, Nederlandstalige afdeling). Wij zijn de verwerkingsverantwoordelijke voor de persoonsgegevens die je via deze website en bij een bikefit aan ons toevertrouwt.</p>
<p>Vragen over deze verklaring of over je gegevens? Mail naar <a href="mailto:[E-MAILADRES]">[E-MAILADRES]</a> of bel <a href="tel:+32473952633">0473 95 26 33</a>.</p>

<h2>2. Welke gegevens verwerken wij, en waarom?</h2>
<h3>Als je een afspraak maakt</h3>
<p>Via het afsprakenformulier of telefonisch verzamelen wij je naam, e-mailadres, telefoonnummer, de gekozen dienst, datum en tijdstip, en optioneel je leeftijd, gegevens over je fiets en een korte omschrijving van je klachten of doelen. Bij een jeugdfit vragen wij de contactgegevens van een ouder of voogd en de naam en leeftijd van het kind. Bij een fit aan huis vragen wij het adres waar de fit doorgaat.</p>
<p>Wij gebruiken deze gegevens om de afspraak vast te leggen, te bevestigen en voor te bereiden, om je te bereiken bij wijzigingen en om de dienst uit te voeren. Rechtsgrond: de uitvoering van de overeenkomst die je met ons sluit (art. 6.1.b AVG) en, voor de gegevens over je klachten of gezondheid, je uitdrukkelijke toestemming (art. 9.2.a AVG). Die omschrijving is vrijblijvend: laat het veld leeg als je liever niets deelt, dan bespreken we het ter plaatse.</p>
<h3>Agenda van de bikefitter</h3>
<p>Een afspraak wordt ingeschreven in de agenda van de bikefitter die de fit uitvoert. Daarvoor gebruiken wij Google Agenda (Google Ireland Ltd). In die agenda staan enkel de dienst, het tijdstip, je naam en de contactgegevens die nodig zijn om de afspraak uit te voeren.</p>
<h3>Bevestiging en herinneringen per e-mail</h3>
<p>Wij sturen je een bevestiging van je afspraak, een agenda-uitnodiging en, waar van toepassing, een herinnering of een annulatiebevestiging. Deze e-mails versturen wij via Resend (Resend, Inc.). Wij sturen geen nieuwsbrieven of reclame zonder je aparte toestemming.</p>
<h3>Facturatie en boekhouding</h3>
<p>Als wij een factuur opmaken, verwerken wij de gegevens die daarvoor wettelijk verplicht zijn. Rechtsgrond: een wettelijke verplichting (art. 6.1.c AVG).</p>
<h3>Technische gegevens en beveiliging</h3>
<p>Onze servers registreren kortstondig technische gegevens zoals je IP-adres en het tijdstip van een aanvraag, om misbruik van het afsprakenformulier te voorkomen en de website veilig te houden. Rechtsgrond: ons gerechtvaardigd belang bij een veilige, werkende website (art. 6.1.f AVG).</p>
<h3>Statistieken</h3>
<p>Enkel als je daarvoor toestemming geeft via de cookiebanner, gebruiken wij Google Analytics 4 om te zien hoe de website gebruikt wordt (bezochte pagina’s, herkomst van bezoekers, gebruikt toestel). IP-adressen worden daarbij geanonimiseerd. Rechtsgrond: je toestemming (art. 6.1.a AVG), die je op elk moment kunt intrekken via de link “Cookies” onderaan de website.</p>

<h2>3. Hoe lang bewaren wij je gegevens?</h2>
<ul>
<li>Afspraak- en contactgegevens: tot drie jaar na je laatste afspraak, zodat wij je bij een volgende fit verder kunnen helpen. Daarna verwijderen of anonimiseren wij ze.</li>
<li>Omschrijving van klachten of doelen: tot drie jaar na je laatste afspraak, of eerder als je erom vraagt.</li>
<li>Facturen en boekhoudkundige stukken: de wettelijke bewaartermijn (tot tien jaar).</li>
<li>Technische logbestanden: maximaal dertig dagen.</li>
<li>Statistieken (Google Analytics): maximaal veertien maanden.</li>
</ul>

<h2>4. Met wie delen wij je gegevens?</h2>
<p>Wij verkopen je gegevens nooit. Wij delen ze enkel met leveranciers die ons helpen om de website en de afspraken te laten werken, en die enkel in onze opdracht handelen:</p>
<ul>
<li><strong>Vercel Inc.</strong> – hosting van de website (Verenigde Staten; deelnemer aan het EU-VS Data Privacy Framework).</li>
<li><strong>Neon Inc.</strong> – databank waarin afspraken bewaard worden (servers in Frankfurt, Europese Unie).</li>
<li><strong>Google Ireland Ltd.</strong> – Google Agenda van de bikefitter en, na toestemming, Google Analytics.</li>
<li><strong>Resend, Inc.</strong> – verzenden van bevestigings- en herinneringsmails (Verenigde Staten; standaardcontractbepalingen van de Europese Commissie).</li>
</ul>
<p>Wanneer gegevens buiten de Europese Economische Ruimte terechtkomen, gebeurt dat op basis van een adequaatheidsbesluit van de Europese Commissie of van standaardcontractbepalingen. Wij geven je gegevens verder enkel door als een wet ons daartoe verplicht.</p>

<h2>5. Cookies</h2>
<p>Deze website gebruikt zo weinig mogelijk cookies:</p>
<ul>
<li><strong>cms_consent</strong> – onthoudt je keuze in de cookiebanner (twaalf maanden). Noodzakelijk.</li>
<li><strong>cms_session</strong> – enkel voor medewerkers die inloggen op het beheergedeelte (veertien dagen). Noodzakelijk.</li>
<li><strong>_ga, _ga_*</strong> – Google Analytics, enkel na jouw toestemming (maximaal veertien maanden). Statistisch.</li>
</ul>
<p>Zonder toestemming plaatsen wij geen statistische cookies en laden wij geen script van Google Analytics. Je keuze kun je altijd aanpassen via de link “Cookies” onderaan elke pagina.</p>

<h2>6. Jouw rechten</h2>
<p>Je hebt het recht om je gegevens in te kijken, te laten verbeteren of te laten wissen, om de verwerking te laten beperken, om bezwaar te maken tegen een verwerking op basis van ons gerechtvaardigd belang, en om je gegevens in een gangbaar bestandsformaat te ontvangen. Toestemming die je gaf, kun je op elk moment intrekken; dat verandert niets aan de rechtmatigheid van wat ervoor gebeurde.</p>
<p>Mail je vraag naar <a href="mailto:[E-MAILADRES]">[E-MAILADRES]</a>. Wij antwoorden binnen een maand. Om zeker te zijn dat wij met de juiste persoon spreken, kunnen wij je vragen om je identiteit te bevestigen.</p>
<p>Ben je niet tevreden met hoe wij met je gegevens omgaan? Dan kun je een klacht indienen bij de Gegevensbeschermingsautoriteit, Drukpersstraat 35, 1000 Brussel, <a href="https://www.gegevensbeschermingsautoriteit.be" rel="noopener">www.gegevensbeschermingsautoriteit.be</a>, <a href="mailto:contact@apd-gba.be">contact@apd-gba.be</a>.</p>

<h2>7. Beveiliging</h2>
<p>Wij beveiligen je gegevens met versleutelde verbindingen (HTTPS), versleutelde opslag van toegangssleutels, beperkte toegang voor medewerkers en logging van wijzigingen in het beheergedeelte. Geen enkel systeem is volledig waterdicht; als er toch iets misgaat met je gegevens, brengen wij jou en, waar nodig, de Gegevensbeschermingsautoriteit op de hoogte zoals de wet dat voorschrijft.</p>

<h2>8. Minderjarigen</h2>
<p>Voor een jeugdfit verwerken wij gegevens van kinderen. Dat doen wij enkel met de betrokkenheid van een ouder of voogd, die de afspraak maakt en de contactpersoon is.</p>

<h2>9. Wijzigingen</h2>
<p>Wij passen deze verklaring aan wanneer onze werking of de wetgeving verandert. De datum bovenaan zegt wanneer dat voor het laatst gebeurde. Belangrijke wijzigingen kondigen wij aan op deze pagina.</p>`;

/** Algemene voorwaarden — work block 2026-09-24-legal-pages.md, page 2 (verbatim + KBO substitutions). */
const TERMS_HTML = `<p><em>Versie van 24 september 2026</em></p>

<h2>Artikel 1 – Wie wij zijn</h2>
<p>Deze algemene voorwaarden gelden voor alle diensten van <strong>Qarakter BV</strong>, handelend onder de naam De Bikefit Studio, met maatschappelijke zetel te Weversstraat 7, 1730 Asse, KBO/btw-nummer BE 1036.912.281, RPR Brussel, Nederlandstalige afdeling, bereikbaar via <a href="mailto:[E-MAILADRES]">[E-MAILADRES]</a> en <a href="tel:+32473952633">0473 95 26 33</a>. Hierna “wij”. De klant die een dienst boekt, hierna “jij”.</p>

<h2>Artikel 2 – Toepassing</h2>
<p>Door een afspraak te maken via onze website, per e-mail of telefonisch, aanvaard je deze voorwaarden. Afwijkingen gelden enkel als wij ze schriftelijk bevestigen. Als een bepaling ongeldig zou zijn, blijven de andere bepalingen gelden.</p>

<h2>Artikel 3 – Onze diensten</h2>
<p>Wij bieden bikefits aan (onder meer volwassenenfit, jeugdfit, gezinspakket en fit aan huis) en inspanningstesten. Een bikefit is een afstelling van je fiets op jouw lichaam en manier van fietsen, uitgevoerd door een bikefitter. Het is <strong>geen medische behandeling en vervangt geen doktersbezoek</strong>. Bij pijn, letsels of medische vragen raadpleeg je een arts of kinesitherapeut. Een inspanningstest voer je uit op eigen verantwoordelijkheid; je bevestigt vooraf dat je gezond genoeg bent om een inspanning te leveren en meldt ons relevante medische aandoeningen.</p>
<p>Wij verbinden ons tot een zorgvuldige uitvoering naar best vermogen (inspanningsverbintenis). Een specifiek resultaat, zoals het verdwijnen van klachten of een bepaalde prestatie, kunnen wij niet garanderen.</p>

<h2>Artikel 4 – Afspraken en bevestiging</h2>
<p>Een afspraak komt tot stand zodra wij ze bevestigen, per e-mail of mondeling. Bij een online boeking ontvang je een bevestiging per e-mail met datum, tijdstip, locatie en een link om te annuleren. Controleer die gegevens en verwittig ons bij een vergissing. Wij mogen een boeking weigeren of een voorgesteld tijdstip aanpassen, bijvoorbeeld bij overboeking of overmacht; in dat geval stellen wij een nieuw moment voor of betaal je niets.</p>

<h2>Artikel 5 – Prijzen en betaling</h2>
<p>Onze prijzen worden meegedeeld voor de afspraak en zijn, tenzij anders vermeld, uitgedrukt in euro en inclusief btw. De prijs geldt voor de dienst zoals afgesproken; extra werk of onderdelen worden vooraf besproken en apart aangerekend. Betaling gebeurt na de dienst, ter plaatse of via factuur binnen veertien dagen na factuurdatum. Bij laattijdige betaling zijn van rechtswege en na ingebrekestelling de wettelijke interesten en een forfaitaire schadevergoeding verschuldigd binnen de grenzen van boek XIX van het Wetboek van economisch recht.</p>

<h2>Artikel 6 – Annuleren en verplaatsen</h2>
<ul>
<li>Je kunt een afspraak kosteloos annuleren of verplaatsen tot <strong>48 uur</strong> voor het afgesproken tijdstip, via de link in je bevestigingsmail of telefonisch.</li>
<li>Annuleer je later, of kom je niet opdagen, dan mogen wij een vergoeding van 50% van de prijs van de geboekte dienst aanrekenen, omdat de gereserveerde tijd niet meer aan iemand anders gegeven kan worden.</li>
<li>Kom je te laat, dan proberen wij de fit binnen de resterende tijd uit te voeren; de volledige prijs blijft verschuldigd.</li>
<li>Moeten wij zelf annuleren (ziekte, overmacht), dan verwittigen wij je zo snel mogelijk en stellen wij een nieuwe datum voor. Je betaalt nooit voor een dienst die niet is uitgevoerd.</li>
</ul>

<h2>Artikel 7 – Herroepingsrecht</h2>
<p>Bij een boeking op afstand (via de website) heb je als consument in principe veertien dagen om de overeenkomst te herroepen. Voor diensten met betrekking tot vrijetijdsbesteding waarvoor een bepaalde datum of periode van uitvoering is afgesproken, geldt dat recht niet (art. VI.53, 12° van het Wetboek van economisch recht). Voor een afspraak op een vast tijdstip gelden daarom de annuleringsregels van artikel 6.</p>

<h2>Artikel 8 – Wat wij van jou verwachten</h2>
<ul>
<li>Je geeft ons juiste en volledige gegevens en meldt vooraf klachten, letsels of beperkingen die voor de fit of de test van belang zijn.</li>
<li>Je brengt je fiets in goede en veilige staat mee, samen met je fietskledij, schoenen en pedalen. Aanpassingen aan je fiets gebeuren in overleg; je blijft eigenaar en verantwoordelijk voor je fiets en materiaal.</li>
<li>Minderjarigen worden vergezeld door een ouder of voogd, die de afspraak maakt en aanwezig is.</li>
<li>Bij een fit aan huis zorg je voor een geschikte, veilige ruimte en eventueel een fietstrainer, in overleg met ons.</li>
</ul>

<h2>Artikel 9 – Aansprakelijkheid</h2>
<p>Wij zijn enkel aansprakelijk voor schade die het rechtstreekse gevolg is van een fout van onze kant, en, behalve bij opzet of zware fout, beperkt tot het bedrag dat je voor de betrokken dienst betaalde. Wij zijn niet aansprakelijk voor indirecte schade, voor schade die voortvloeit uit onjuiste of onvolledige informatie die je ons gaf, uit gebreken aan je fiets of materiaal, of uit het niet opvolgen van ons advies. Niets in dit artikel beperkt onze aansprakelijkheid voor lichamelijke schade of voor wat wettelijk niet uitgesloten kan worden.</p>

<h2>Artikel 10 – Intellectuele eigendom</h2>
<p>Meetgegevens, fitrapporten, foto’s en video’s die wij tijdens een fit maken, mag je vrij gebruiken voor persoonlijke doeleinden. Onze methodes, teksten en beeldmateriaal op de website blijven onze eigendom en mogen niet zonder toestemming worden overgenomen.</p>

<h2>Artikel 11 – Privacy</h2>
<p>Hoe wij met je persoonsgegevens omgaan, lees je in onze <a href="/privacy">privacyverklaring</a>. Door te boeken bevestig je dat je ze gelezen hebt.</p>

<h2>Artikel 12 – Klachten</h2>
<p>Niet tevreden? Laat het ons zo snel mogelijk weten via <a href="mailto:[E-MAILADRES]">[E-MAILADRES]</a>, bij voorkeur binnen acht dagen na de dienst, dan zoeken wij samen een oplossing. Kom je er met ons niet uit, dan kun je als consument terecht bij de Consumentenombudsdienst, North Gate II, Koning Albert II-laan 8 bus 1, 1000 Brussel, <a href="https://consumentenombudsdienst.be" rel="noopener">consumentenombudsdienst.be</a>.</p>

<h2>Artikel 13 – Toepasselijk recht en bevoegde rechtbank</h2>
<p>Op onze overeenkomsten is het Belgische recht van toepassing. Geschillen worden voorgelegd aan de rechtbanken van het gerechtelijk arrondissement waar onze maatschappelijke zetel gevestigd is, onverminderd de dwingende regels die voor consumenten een andere bevoegde rechtbank aanwijzen.</p>

<h2>Artikel 14 – Wijzigingen</h2>
<p>Wij kunnen deze voorwaarden aanpassen. De versie die geldt, is die welke op de website stond op het moment dat je je afspraak maakte.</p>`;

const PAGES: SeedPage[] = [
  // ------------------------- /, /aanbod, /aanbod/*, /voor-wie, /bikefit, /ons-team
  ...AANBOD_PAGES,
  // ------------------------------------------------- /aanbod/cadeaubon ---
  CADEAUBON_PAGE,

  // ----------------------------------------------- /veelgestelde-vragen ---
  {
    slug: 'veelgestelde-vragen',
    title: 'Veelgestelde vragen',
    translationGroup: 'faq',
    source: 'content/about.html §2 (identical to prototype/bikefit.html#vragen)',
    metaTitle: 'Veelgestelde vragen over een bikefit',
    metaDescription:
      'Waarom een bikefit, hoe vaak, hoe lang hij duurt, wat je meebrengt, of het ook aan huis kan en of we e-bikes doen — kort en eerlijk beantwoord.',
    structuredDataType: 'FAQPage',
    blocks: [
      {
        type: 'hero',
        data: {
          variant: 'pageHead',
          eyebrow: 'Goed om te weten · Ninove',
          title: 'Veelgestelde vragen',
          titleEmphasis: '',
          subtitle: '',
          primaryCta: null,
          secondaryCta: null,
        },
      },
      {
        type: 'faq',
        data: {
          variant: 'default',
          eyebrow: '',
          title: '',
          lede: '',
          collapsible: false,
          emitStructuredData: true,
          items: FAQ_ITEMS,
        },
      },
      CALLOUT_BLOCK,
    ],
  },

  // ---------------------------------------------------------- /afspraak ---
  AFSPRAAK_PAGE,

  // ----------------------------------------------------------- /privacy ---
  {
    slug: 'privacy',
    title: 'Privacyverklaring',
    translationGroup: 'privacy',
    source: 'work block 2026-09-24-legal-pages.md page 1',
    metaTitle: 'Privacyverklaring',
    metaDescription:
      'Hoe De Bikefit Studio (Qarakter BV) je gegevens verwerkt als je een afspraak maakt, welke cookies we gebruiken en welke rechten je hebt.',
    structuredDataType: 'WebPage',
    blocks: [
      {
        type: 'hero',
        data: {
          variant: 'pageHead',
          eyebrow: 'Juridisch',
          title: 'Privacyverklaring',
          titleEmphasis: '',
          subtitle:
            'Welke gegevens we verwerken als je een afspraak maakt of deze website bezoekt, waarom, hoe lang we ze bewaren en welke rechten je hebt.',
          primaryCta: null,
          secondaryCta: null,
        },
      },
      {
        type: 'richText',
        data: { variant: 'default', eyebrow: '', title: '', html: PRIVACY_HTML },
      },
    ],
  },

  // ---------------------------------------------- /algemene-voorwaarden ---
  {
    slug: 'algemene-voorwaarden',
    title: 'Algemene voorwaarden',
    translationGroup: 'terms',
    source: 'work block 2026-09-24-legal-pages.md page 2',
    metaTitle: 'Algemene voorwaarden',
    metaDescription:
      'Algemene voorwaarden van De Bikefit Studio (Qarakter BV): afspraken, betaling, kosteloos annuleren tot 48 uur vooraf, aansprakelijkheid en klachten.',
    structuredDataType: 'WebPage',
    blocks: [
      {
        type: 'hero',
        data: {
          variant: 'pageHead',
          eyebrow: 'Juridisch',
          title: 'Algemene voorwaarden',
          titleEmphasis: '',
          subtitle:
            'Wat je van ons mag verwachten, en wat wij van jou verwachten, wanneer je een bikefit of inspanningstest boekt.',
          primaryCta: null,
          secondaryCta: null,
        },
      },
      {
        type: 'richText',
        data: { variant: 'default', eyebrow: '', title: '', html: TERMS_HTML },
      },
    ],
  },
];

/**
 * Same values `cms-bootstrap.mts` writes, repeated here so a database that was
 * never bootstrapped still ends up with a complete site. Existing rows are
 * never overwritten — settings are the operator's, not the seed's.
 */
const DEFAULT_SETTINGS: Record<string, unknown> = {
  site: {
    name: 'De Bikefit Studio',
    tagline: 'Pijnvrij fietsen begint hier',
    strapline: 'Professionele bikefit · Ninove',
    mission:
      'Iedereen verdient het om te genieten van alles wat een fiets te bieden heeft. Ons werk is ervoor te zorgen dat jouw fiets je dat ook toelaat.',
    logoMediaId: null,
  },
  contact: {
    phoneLabel: PHONE_LABEL,
    phoneHref: PHONE_HREF,
    email: CONTACT_EMAIL,
    addressLines: [],
    postalCode: '',
    city: 'Ninove',
    country: 'BE',
    hours: 'Op afspraak',
    website: 'www.debikefitstudio.be',
  },
  seo: {
    defaultMetaTitle: 'De Bikefit Studio — professionele bikefit in Ninove',
    titleTemplate: '%s · De Bikefit Studio',
    defaultMetaDescription:
      'Fiets met comfort. Een bikefit lijnt de fiets uit op jou — niet omgekeerd — zodat elke rit beter voelt en je langer gezond blijft op de fiets.',
    defaultOgImageMediaId: null,
    // Staging must stay out of search results until launch.
    allowIndexing: false,
  },
  organization: {
    type: 'LocalBusiness',
    legalName: 'De Bikefit Studio',
    vatNumber: '',
    sameAs: [],
    priceRange: '',
    areaServed: ['Ninove', 'Oost-Vlaanderen'],
    latitude: null,
    longitude: null,
  },
  analytics: {
    ga4MeasurementId: '',
    enabled: false,
  },
};

/** The prototype's old URL, `/over-ons` → `/ons-team` and `/contact` → `/afspraak` (13 Oct 2026). */
const REDIRECTS = [
  {
    fromPath: '/bikefit.html',
    toPath: '/bikefit',
    statusCode: 301 as const,
    notes: 'Oude statische prototypepagina.',
  },
  ...AANBOD_REDIRECTS,
  CONTACT_REDIRECT,
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const onlyMissing = process.argv.includes('--only-missing');
const SEED_USER_EMAIL = 'seed@debikefitstudio.local';

/**
 * `--refresh-slug afspraak` / `--refresh-slug=afspraak` → `'afspraak'`;
 * `/`, `''` or `home` → `''` (the home page); absent → `null`.
 */
function parseRefreshSlug(args: string[]): string | null {
  let raw: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--refresh-slug') {
      raw = args[index + 1];
      if (raw === undefined || raw.startsWith('--')) {
        throw new Error('--refresh-slug needs a slug, e.g. --refresh-slug afspraak');
      }
      break;
    }
    if (arg.startsWith('--refresh-slug=')) {
      raw = arg.slice('--refresh-slug='.length);
      break;
    }
  }
  if (raw === undefined) return null;
  const slug = raw.trim().replace(/^\/+/, '').replace(/\/+$/, '');
  return slug === 'home' ? '' : slug;
}

function log(symbol: string, message: string) {
  console.log(`${symbol} ${message}`);
}

/** A password nobody will ever use: the seed account signs in via a session. */
function throwawayPassword(): string {
  return `Seed${randomBytes(18).toString('base64url')}9`;
}

function usesLegalEmail(page: SeedPage): boolean {
  return page.blocks.some(
    (block) =>
      typeof block.data.html === 'string' && block.data.html.includes(LEGAL_EMAIL_PLACEHOLDER),
  );
}

/**
 * Fills `[E-MAILADRES]` in a block's `html` (text and `mailto:` alike). The
 * result is then sanitised like any other block write: `repo.updateBlock()`
 * runs the rich-text allowlist in `src/lib/cms/actions/sanitize.ts`.
 */
function withLegalEmail(data: Record<string, unknown>, email: string): Record<string, unknown> {
  if (typeof data.html !== 'string' || !data.html.includes(LEGAL_EMAIL_PLACEHOLDER)) return data;
  return { ...data, html: data.html.split(LEGAL_EMAIL_PLACEHOLDER).join(escapeHtml(email)) };
}

async function main() {
  const refreshSlug = parseRefreshSlug(process.argv.slice(2));
  const refreshing = refreshSlug !== null;
  if (refreshing && onlyMissing) {
    throw new Error('--refresh-slug and --only-missing cannot be combined');
  }
  const pages = refreshing ? PAGES.filter((page) => page.slug === refreshSlug) : PAGES;
  if (refreshing && pages.length === 0) {
    const known = PAGES.map((page) => (page.slug ? page.slug : 'home')).join(', ');
    throw new Error(`--refresh-slug: no seeded page "${refreshSlug}" (known: ${known})`);
  }

  const { getCmsDb, cmsDriver } = await import('@/db/cms');
  const { and, asc, eq } = await import('drizzle-orm');
  const schema = await import('@/db/cms-schema');
  const { cmsNavigation, cmsPages, cmsRedirects, cmsSiteSettings, cmsUsers, DEFAULT_LOCALE } =
    schema;

  log('→', `driver: ${cmsDriver()}`);
  const db = await getCmsDb();
  const locale = DEFAULT_LOCALE;

  // --- 1. An actor, and a real session for it ------------------------------
  const { hashPassword } = await import('@/lib/cms/password');
  const { createSession, revokeSession } = await import('@/lib/cms/session');

  let [actor] = await db
    .select({ id: cmsUsers.id, email: cmsUsers.email })
    .from(cmsUsers)
    .where(and(eq(cmsUsers.role, 'admin'), eq(cmsUsers.isActive, true)))
    .orderBy(asc(cmsUsers.createdAt))
    .limit(1);

  if (!actor) {
    [actor] = await db
      .insert(cmsUsers)
      .values({
        email: SEED_USER_EMAIL,
        name: 'Seed',
        role: 'admin',
        passwordHash: await hashPassword(throwawayPassword()),
        mustChangePassword: true,
        isActive: true,
      })
      .returning({ id: cmsUsers.id, email: cmsUsers.email });
    log('+', `no admin found — created the seed account ${actor.email}`);
  } else {
    log('=', `publishing as ${actor.email}`);
  }

  const session = await createSession(db, actor.id, { userAgent: 'cms-seed' });
  cookieJar.set('cms_session', session.token);

  try {
    const repo = await import('@/lib/cms/repo');

    if (refreshing) {
      log('=', 'settings, menus and redirects left untouched (--refresh-slug)');
    }

    // --- 2. Site settings (create only; never overwrite an operator) -------
    for (const [key, value] of refreshing ? [] : Object.entries(DEFAULT_SETTINGS)) {
      const [existing] = await db
        .select({ key: cmsSiteSettings.key })
        .from(cmsSiteSettings)
        .where(and(eq(cmsSiteSettings.locale, locale), eq(cmsSiteSettings.key, key)))
        .limit(1);

      if (existing) {
        log('=', `setting ${locale}/${key} already set — left untouched`);
        continue;
      }
      const result = await repo.updateSiteSetting(
        locale,
        key as Parameters<typeof repo.updateSiteSetting>[1],
        value,
      );
      if (!result.ok) throw new Error(`setting ${key}: ${result.message}`);
      log('+', `setting ${locale}/${key} created`);
    }

    // --- 3. Navigation ----------------------------------------------------
    const menus = [
      ['main', MAIN_MENU],
      ['footer', FOOTER_MENU],
    ] as const;
    for (const [menuKey, items] of refreshing ? [] : menus) {
      const [existing] = await db
        .select({ items: cmsNavigation.items })
        .from(cmsNavigation)
        .where(and(eq(cmsNavigation.locale, locale), eq(cmsNavigation.menuKey, menuKey)))
        .limit(1);

      const populated = Array.isArray(existing?.items) && existing.items.length > 0;
      if (populated && onlyMissing) {
        log('=', `menu ${locale}/${menuKey} already has items — skipped (--only-missing)`);
        continue;
      }

      const result = await repo.updateNavigation(locale, menuKey, items);
      if (!result.ok) throw new Error(`menu ${menuKey}: ${result.message}`);
      log(populated ? '~' : '+', `menu ${locale}/${menuKey} — ${items.length} items`);
    }

    // --- 4. Pages ---------------------------------------------------------
    // The legal pages' contact address: settings `contact.email`, else the
    // unverified fallback (see LEGAL_FALLBACK_EMAIL).
    let legalEmail = LEGAL_FALLBACK_EMAIL;
    if (pages.some(usesLegalEmail)) {
      const [contactRow] = await db
        .select({ value: cmsSiteSettings.value })
        .from(cmsSiteSettings)
        .where(and(eq(cmsSiteSettings.locale, locale), eq(cmsSiteSettings.key, 'contact')))
        .limit(1);
      const stored = (contactRow?.value as { email?: unknown } | undefined)?.email;
      const fromSettings = typeof stored === 'string' ? stored.trim() : '';
      if (fromSettings) {
        legalEmail = fromSettings;
        log('=', `legal pages: e-mail ${legalEmail} (from settings ${locale}/contact.email)`);
      } else {
        log(
          '=',
          `legal pages: settings ${locale}/contact.email is empty — writing ${LEGAL_FALLBACK_EMAIL}`,
        );
      }
    }

    for (const spec of pages) {
      const path = spec.slug ? `/${spec.slug}` : '/';

      const [existing] = await db
        .select({ id: cmsPages.id, status: cmsPages.status })
        .from(cmsPages)
        .where(and(eq(cmsPages.locale, locale), eq(cmsPages.slug, spec.slug)))
        .limit(1);

      if (existing && onlyMissing) {
        log('=', `page ${path} exists — skipped (--only-missing)`);
        continue;
      }

      let pageId: string;
      if (existing) {
        pageId = existing.id;
      } else {
        const created = await repo.createPage({
          locale,
          slug: spec.slug,
          title: spec.title,
          translationGroup: spec.translationGroup,
        });
        if (!created.ok) throw new Error(`page ${path}: ${created.message}`);
        pageId = created.data.id;
      }

      if (refreshing && existing) {
        // Only the blocks are the seed's business on a refresh; the title and
        // SEO fields may have been edited on that environment since.
        log('=', `page ${path} — title and SEO fields left untouched (--refresh-slug)`);
      } else {
        const updated = await repo.updatePage(pageId, {
          slug: spec.slug,
          title: spec.title,
          translationGroup: spec.translationGroup,
          metaTitle: spec.metaTitle,
          metaDescription: spec.metaDescription,
          structuredDataType: spec.structuredDataType,
          noIndex: false,
        });
        if (!updated.ok) throw new Error(`page ${path}: ${updated.message}`);
      }

      // Replace the draft blocks with the seed definition, in order.
      const current = await repo.getPageForEdit(pageId);
      for (const block of current?.blocks ?? []) {
        const removed = await repo.deleteBlock(block.id);
        if (!removed.ok) throw new Error(`page ${path}: ${removed.message}`);
      }
      for (const blockSpec of spec.blocks) {
        const added = await repo.addBlock(
          pageId,
          blockSpec.type as Parameters<typeof repo.addBlock>[1],
        );
        if (!added.ok) throw new Error(`page ${path} (${blockSpec.type}): ${added.message}`);
        const written = await repo.updateBlock(
          added.data.id,
          withLegalEmail(blockSpec.data, legalEmail),
        );
        if (!written.ok) throw new Error(`page ${path} (${blockSpec.type}): ${written.message}`);
      }

      const published = await repo.publishPage(pageId);
      if (!published.ok) throw new Error(`page ${path}: ${published.message}`);

      log(
        existing ? '~' : '+',
        `page ${path} — ${spec.blocks.length} blocks, published  [${spec.source}]`,
      );
    }

    // --- 5. Redirects -----------------------------------------------------
    for (const redirect of refreshing ? [] : REDIRECTS) {
      const [existing] = await db
        .select({ id: cmsRedirects.id })
        .from(cmsRedirects)
        .where(eq(cmsRedirects.fromPath, redirect.fromPath))
        .limit(1);

      if (existing) {
        log('=', `redirect ${redirect.fromPath} already exists — left untouched`);
        continue;
      }
      const result = await repo.createRedirect(redirect);
      if (!result.ok) throw new Error(`redirect ${redirect.fromPath}: ${result.message}`);
      log('+', `redirect ${redirect.fromPath} → ${redirect.toPath} (${redirect.statusCode})`);
    }
  } finally {
    // The seed session exists only for the duration of this script.
    await revokeSession(db, session.token);
    cookieJar.clear();
  }

  console.log('');
  log(
    '✓',
    refreshing
      ? `refresh complete — /${refreshSlug} re-seeded and published in ${locale}`
      : `seed complete — ${pages.length} pages published in ${locale}`,
  );
  console.log('  Indexing stays off until seo.allowIndexing is switched on in /admin.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('✗ seed failed');
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
  });

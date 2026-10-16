# Register tijdelijke inhoud — De Bikefit Studio

Canonieke checklist van **alle** tijdelijke of onbevestigde inhoud op de publieke site, bijgehouden
sinds de herwerking van 13 oktober 2026 (Aanbod, Voor wie, Bikefit, Ons team). Toshoni vroeg om
nu met tijdelijke inhoud te werken en alles bij te houden tot het definitief is. Elke rij heeft een
vaste ID; IDs worden nooit hergebruikt of hernummerd.

**Regels.**

- Vul nooit een feitelijk gat met een verzonnen detail: geen prijzen, duur, diploma's, jaartallen,
  prestaties of merken zonder bron.
- Wijzig je de inhoud, pas dan in hetzelfde werk de rij aan. Zet de status op *afgerond* met datum
  zodra de definitieve inhoud gepubliceerd is. Verwijder geen rijen.
- "CMS" betekent: `/admin` → **Pagina's** → de pagina (titel zoals in de lijst) → het blok →
  **Inhoud bewerken** → het veld → **Blok opslaan** → **Publiceren**. De blokken *Dienst (aanbod)*
  en *Team* tonen bovenaan een korte hint die naar dit register verwijst.
- De seedtekst staat in `src/lib/offers/defaults.ts` (diensten) en `src/lib/studio/seed-content/`
  (pagina's, team). Pas die mee aan zodat een nieuwe omgeving dezelfde inhoud krijgt.
  `src/lib/studio/seed-content/placeholders.test.ts` faalt als een dienst, teamlid of beeld uit de
  seed hier geen rij heeft.

**Status:** **open** = nog tijdelijk · **te bevestigen** = voorstel staat online, wacht op
akkoord · **bevestigd** = aangeleverd door Toshoni, mag blijven · **afgerond** = definitief (met
datum).

## Overzicht

| Reeks | Onderwerp | Rijen | Open | Te bevestigen | Bevestigd | Afgerond |
| --- | --- | --- | --- | --- | --- | --- |
| P | Prijzen | 7 | 7 | 0 | 0 | 0 |
| D | Duur | 7 | 6 | 0 | 0 | 1 |
| E | Inhoud, extra's, pakketten | 8 | 1 | 7 | 0 | 0 |
| T | Team | 13 | 10 | 2 | 1 | 0 |
| B | AI-beelden en lege beeldvakken | 5 | 5 | 0 | 0 | 0 |
| K | Online boeken per dienst | 6 | 5 | 1 | 0 | 0 |
| G | Bestaande hiaten in aangeraakte inhoud | 7 | 2 | 1 | 2 | 2 |
| C | Cadeaubon (bestelformulier) | 4 | 3 | 1 | 0 | 0 |
| | **Totaal** | **57** | **39** | **12** | **3** | **3** |

## 1. Prijzen (P)

Plaats: CMS → de dienstpagina → blok *Dienst (aanbod)* → veld **Prijslabel** (vrije tekst) of
**Prijs in eurocent** (bedrag, bv. `12000` = € 120,00).

- Nu staat in **Prijslabel** de bewerkbare tekst "Prijs op aanvraag"; **Prijs in eurocent** is
  leeg. Voor een aanbod gekoppeld aan boekingsdiensten zijn deze twee redactionele velden
  **niet** de publieke prijsbron: kaart en detail tonen "Prijs op aanvraag" tot de dienstprijzen
  en de variantweergave zijn goedgekeurd.
- Voor een **niet-gekoppeld** aanbod: vul na bevestiging **Prijs in eurocent** in (de tekst
  "Prijs op aanvraag" verbergt een ingevuld bedrag nooit) of vervang **Prijslabel** door bv.
  "vanaf € 120". Een ander prijslabel dan "Prijs op aanvraag" wint van het bedrag.
- Voor een **gekoppeld** aanbod: de admin beheert de bedragen en `show_price` op de afzonderlijke
  diensten in `/admin` → **Diensten**; de publieke variantweergave volgt pas na Toshoni's besluit.
- Nooit € 0 invullen. Een niet-gekoppeld aanbod met een bedrag in eurocent krijgt ook een prijs
  in de gestructureerde data (JSON-LD); een gekoppeld aanbod publiceert daar geen zelfstandige
  redactionele prijs.
- De prijs verschijnt op de dienstpagina (bovenaan en bij **Kostprijs**) en op de kaarten van
  het overzicht `/aanbod`. Die kaarten lezen de dienstpagina zelf; er is geen tweede plek om aan te
  passen. De overzichten op de home en op `/bikefit` tonen nooit een prijs (beslissing Toshoni,
  13 okt 2026), ook niet als **Prijzen tonen** daar aan staat. Een ingevuld blok *Prijzen*
  verschijnt evenmin buiten `/aanbod` en de dienstpagina's; op andere pagina's blijft het weg.

| ID | Pagina (titel in CMS) | Nu | Nodig | Status |
| --- | --- | --- | --- | --- |
| P-01 | `/aanbod/bikefit-nieuwe-fiets` (*Bikefit – aankoop nieuwe fiets*) | Prijs op aanvraag | bevestigde prijs, of bewust "op aanvraag" laten | open |
| P-02 | `/aanbod/bikefit-huidige-fiets` (*Bikefit – huidige fiets*) | Prijs op aanvraag | idem; afstemmen met Volwassenenfit/Jeugdfit (K-01, K-06) | open |
| P-03 | `/aanbod/voetanalyse` (*Voetanalyse*) | Prijs op aanvraag | idem | open |
| P-04 | `/aanbod/zadelanalyse` (*Zadelanalyse*) | Prijs op aanvraag | idem | open |
| P-05 | `/aanbod/afstellen-schoenplaatjes` (*Afstellen schoenplaatjes*) | Prijs op aanvraag | idem | open |
| P-06 | `/aanbod/lactaattest` (*Lactaattest*) | Prijs op aanvraag | idem | open |
| P-07 | `/aanbod/coaching` (*Coaching*) | Prijs op aanvraag | idem; per sessie, per maand of per traject? | open |

Een redactionele aanbodprijs verandert **niets** aan de online boeking (zie K-06): die toont
enkel de prijs van de gekozen dienst zelf (Volwassene of Jeugd), uit `/admin` → **Diensten**.
Voor P-02 wordt geen zelfstandige of gedeelde prijs gepubliceerd; na goedkeuring moet de
aanbodpagina beide varianten uit de gekoppelde diensten afleiden.

## 2. Duur (D)

Plaats: CMS → de dienstpagina → blok *Dienst (aanbod)* → veld **Duur** (vrije tekst, bv. "ongeveer
90 minuten"). Voor niet-gekoppeld aanbod getoond bovenaan en bij **Duur**; een leeg veld toont
"Duur in overleg". Voor gekoppeld aanbod wordt die tekst publiek vervangen door de duur per
boekbare dienst uit `cms_services`.

| ID | Pagina (titel in CMS) | Nu | Nodig | Status |
| --- | --- | --- | --- | --- |
| D-01 | `/aanbod/bikefit-nieuwe-fiets` (*Bikefit – aankoop nieuwe fiets*) | Duur in overleg | bevestigde duur | open |
| D-02 | `/aanbod/bikefit-huidige-fiets` (*Bikefit – huidige fiets*) | Volwassene: 1 u 30 min · Jeugd: 1 uur (uit gekoppelde `cms_services`, bij seed) | publieke duur volgt de boekbare diensten automatisch; redactionele aanbodduur wordt hier niet getoond | afgerond 2026-10-16 |
| D-03 | `/aanbod/voetanalyse` (*Voetanalyse*) | Duur in overleg | bevestigde duur | open |
| D-04 | `/aanbod/zadelanalyse` (*Zadelanalyse*) | Duur in overleg | bevestigde duur | open |
| D-05 | `/aanbod/afstellen-schoenplaatjes` (*Afstellen schoenplaatjes*) | Duur in overleg | bevestigde duur | open |
| D-06 | `/aanbod/lactaattest` (*Lactaattest*) | Duur in overleg | bevestigde duur | open |
| D-07 | `/aanbod/coaching` (*Coaching*) | Traject en opvolging in overleg | bevestigde opzet en opvolgritme (geen vast ritme beloven zonder bevestiging) | open |

De planningsduur van een **boekbare** dienst staat in `/admin` → **Diensten** → veld
**Duur (minuten)** (Volwassenenfit 90, Jeugdfit 60: echte, bestaande seedwaarden).
Bij een gekoppeld aanbod toont de publieke detailpagina elke boekbare variant met de actuele
dienstduur; het redactionele veld **Duur** van het aanbod wordt dan genegeerd. Voor een
niet-gekoppeld aanbod blijft dat veld de publieke tekst. Een duur op de aanbodpagina wijzigt
de planningsduur van een dienst niet.

## 3. Inhoud, mogelijke extra's en pakketten (E)

Plaats: CMS → de dienstpagina → blok *Dienst (aanbod)* → velden **Doel**, **Inhoud (één punt per
regel)**, **Mogelijke extra's (één per regel)** en **Uitleg bij de extra's**. De tekst is het
voorstel uit de werkopdracht van 13 oktober ("Suggested service content"). De uitleg bij de extra's
is overal: "Wat er precies bij komt en wat het kost, spreken we altijd vooraf samen met je af."

| ID | Pagina | Nu (voorstel) | Nodig | Status |
| --- | --- | --- | --- | --- |
| E-01 | `/aanbod/bikefit-nieuwe-fiets` | extra's: afstelling van je nieuwe fiets na de aankoop; aanvullende voet- of zadelanalyse | bevestigen wat er echt bij kan | te bevestigen |
| E-02 | `/aanbod/bikefit-huidige-fiets` | inhoud noemt 3D-bewegingsanalyse (G-06); extra's: vervolgafspraak; gerichte voet- of zadelanalyse; nieuwe onderdelen apart | idem; is een vervolgafspraak inbegrepen of apart? | te bevestigen |
| E-03 | `/aanbod/voetanalyse` | extra's: schoenplaatjes afstellen; volledige bikefit. Inlegzolen bewust niet vermeld | idem; worden er inlegzolen aangeboden of verkocht? | te bevestigen |
| E-04 | `/aanbod/zadelanalyse` | extra's: ruimer bikefittraject; ander zadel of onderdelen indien nodig. Drukmeting bewust niet vermeld | idem; is er een drukmeetsysteem? | te bevestigen |
| E-05 | `/aanbod/afstellen-schoenplaatjes` | extra's: voetanalyse; volledige bikefit; nieuwe schoenplaatjes indien nodig | idem; plaatjes nooit "inbegrepen" zonder bevestiging | te bevestigen |
| E-06 | `/aanbod/lactaattest` | inhoud: stapsgewijze inspanning met lactaatmetingen; extra's: coaching; vervolgmeting in overleg | idem; protocol en materiaal (fiets of eigen fiets op trainer?) | te bevestigen |
| E-07 | `/aanbod/coaching` | extra's: lactaattest; bikefit; aanvullende opvolging in overleg | idem; vorm van de opvolging (online, in de studio, ritme) | te bevestigen |
| E-08 | alle zeven dienstpagina's | geen pakketten of combinatieprijzen vermeld | bevestigen of er pakketten of combinaties zijn; zo ja: welke diensten, welke prijs | open |

## 4. Team (T)

Plaats: CMS → *Ons team* (`/ons-team`) → blok *Team* → **Teamleden** → de persoon → velden **Rol**,
**Bio (alinea's, enkel gecontroleerde tekst)** en **Afbeelding**. Er is geen apart veld voor
kwalificaties: die komen, met bron, in **Bio** of kort in **Rol**. Het veld **Interne notitie (niet
publiek)** herhaalt per persoon de open rijen. Zonder **Afbeelding** toont de site de initialen.

Robin en Goran hebben een neutrale tussenkaart: naam, initialen en twee regels, "*Naam* maakt deel
uit van het team van De Bikefit Studio." en "Een uitgebreid profiel volgt binnenkort." Verwijder
die tweede regel zodra de echte bio er staat.

| ID | Persoon — veld | Nu | Nodig | Status |
| --- | --- | --- | --- | --- |
| T-01 | Rutger Roelandts — Bio | twee alinea's, ingekorte eigen tekst uit `content/about.html` §1 (eerder op `/over-ons`), o.a. "Negentien jaar competitie" | akkoord van Rutger op de korte versie | te bevestigen |
| T-02 | Rutger Roelandts — Rol | "Oprichter" (volgt uit zijn eigen tekst) | bevestigen | te bevestigen |
| T-03 | Rutger Roelandts — Kwalificaties | niets vermeld | diploma's of opleidingen, enkel met bron | open |
| T-04 | Rutger Roelandts — Afbeelding | leeg → initialen "RR" | echte portretfoto (geen AI-beeld), met akkoord | open |
| T-05 | Robin Van Lierde — Bio | "Robin maakt deel uit van het team van De Bikefit Studio." + "Een uitgebreid profiel volgt binnenkort." | korte bio, aangeleverd door Robin zelf | open |
| T-06 | Robin Van Lierde — Rol | leeg (niet getoond) | rol of functie | open |
| T-07 | Robin Van Lierde — Kwalificaties en specialisaties | niets vermeld | enkel met bron | open |
| T-08 | Robin Van Lierde — Afbeelding | leeg → initialen "RV" | echte portretfoto, met akkoord | open |
| T-09 | Goran Van de Walle — Bio | "Goran maakt deel uit van het team van De Bikefit Studio." + "Een uitgebreid profiel volgt binnenkort." | korte bio, aangeleverd door Goran zelf | open |
| T-10 | Goran Van de Walle — Rol | leeg (niet getoond) | rol of functie | open |
| T-11 | Goran Van de Walle — Kwalificaties en specialisaties | niets vermeld | enkel met bron | open |
| T-12 | Goran Van de Walle — Afbeelding | leeg → initialen "GV" | echte portretfoto, met akkoord | open |
| T-13 | Algemene claim: `/aanbod` → blok *Hero* → **Ondertitel** ("uitsluitend met ervaren, gediplomeerde professionals"); `/ons-team` → *Hero* → **Ondertitel** en home → blok *Oproep* → **Tekst** ("de nodige diploma's") | aangeleverd door Toshoni | blijft algemeen; geen individuele diploma's noemen zonder bron | bevestigd |

## 5. Beelden: AI-gegenereerd, tijdelijk of leeg (B)

Drie gegenereerde sfeerbeelden van fictieve, algemene personen (herkomst en prompts:
[`editorial-images.md`](./editorial-images.md), manifest `src/lib/studio/editorial-images.json`).
Ze zijn **nooit** een portret van Rutger, Robin of Goran. Daarnaast laat de rollout twee
beeldvakken op `/bikefit` bewust leeg (B-04, B-05): daar toont de site het decoratieve vlak met
verloop en ring, zonder foto. De compacte paginakoppen (*Hero*, variant paginakop) tonen nooit
een beeld en staan hier daarom niet.

Vervangen kan op twee manieren:

1. **Per plaats in het CMS:** echte foto uploaden via `/admin` → **Media**, dan op elke plaats
   hieronder het veld **Afbeelding** (blok *Hero*, *Beeld + tekst* of *Dienst (aanbod)*) op die
   foto zetten, met Nederlandse alt-tekst, en publiceren.
2. **Alles in één keer:** `npm run images:import -- --slot <slot> --src <bestand> --version 2` en
   daarna de staging-rollout (`staging-runbook.md` §9). Dat vervangt het beeld op alle plaatsen.

| ID | Slot → bestand | Gebruikt op (pagina → blok → veld **Afbeelding**) | Nodig | Status |
| --- | --- | --- | --- | --- |
| B-01 | `flemish-cyclists` → `public/images/editorial/flemish-cyclists-v1.webp` | home → *Hero* ("Meer plezier."); `/bikefit` → *Beeld + tekst* "Waarom is een bikefit belangrijk?"; `/aanbod/lactaattest` → *Dienst (aanbod)* | echte foto van fietsers, beeldrechten en toestemming geregeld | open |
| B-02 | `bikefit-studio` → `public/images/editorial/bikefit-studio-v1.webp` | home → *Beeld + tekst* "Jij blijft het vertrekpunt"; `/bikefit` → *Beeld + tekst* "Meten om beter te kijken"; *Dienst (aanbod)* op `/aanbod/bikefit-nieuwe-fiets`, `/aanbod/bikefit-huidige-fiets`, `/aanbod/voetanalyse`, `/aanbod/zadelanalyse`, `/aanbod/afstellen-schoenplaatjes` | echte foto van een bikefit in de studio | open |
| B-03 | `junior-coaching` → `public/images/editorial/junior-coaching-v1.webp` | home → *Beeld + tekst* "Voor elke fietser"; `/voor-wie` → *Beeld + tekst* "Jonge fietsers groeien"; `/aanbod/coaching` → *Dienst (aanbod)* | echte foto, schriftelijke toestemming van ouders bij minderjarigen | open |
| B-04 | geen (leeg) | `/bikefit` → *Beeld + tekst* "Kan een bikefit ook bij mij thuis?" (donker, beeld links) | echte foto van een fit op locatie, of bewust leeg laten; hangt af van K-04 en G-07 | open |
| B-05 | geen (leeg) | `/bikefit` → *Beeld + tekst* "Kinderen groeien. De pasvorm groeit niet mee." (beeld rechts) | echte foto van een jonge fietser, schriftelijke toestemming van ouders; of B-03 hergebruiken | open |

## 6. Online boeken per dienst (K)

Zie [`booking-architecture.md`](./booking-architecture.md) §14. Plaats: CMS → de dienstpagina →
blok *Dienst (aanbod)* → veld **Online boeken via dienst(en)** (slug uit `/admin` → **Diensten**,
één per regel). Leeg = de knop "Boek een afspraak voor deze dienst" leidt naar een contactvraag
(bellen of mailen naar het adres uit G-01) die de dienst noemt.

| ID | Onderwerp | Nu | Nodig | Status |
| --- | --- | --- | --- | --- |
| K-01 | *Bikefit – huidige fiets* | gekoppeld aan de bestaande diensten `volwassenenfit` (90 min) en `jeugdfit` (60 min). Sinds 16 okt 2026 toont `/afspraak` dit aanbod **één keer**, met daaronder "Voor wie?": **Volwassene** en **Jeugd** (veld **Keuzelabel onder een aanbod** in **Diensten**); de gekozen dienst bepaalt duur, beschikbaarheid, formulier (ouder bij Jeugd) en wat geboekt wordt | bevestigen dat dit dezelfde dienst is | te bevestigen |
| K-02 | De andere zes diensten | veld leeg → contactvraag, niet online boekbaar | per dienst: echte duur (D-rij) en aanbieder(s) die het zelf bevestigen (K-05); dan dienst aanmaken in **Diensten** en de slug invullen | open |
| K-03 | *Lactaattest* vs. bestaande dienst Inspanningstest | niet gekoppeld (niet bevestigd dat het dezelfde meting is) | beslissen: koppelen, of Inspanningstest uitzetten | open |
| K-04 | Bestaande diensten Gezinspakket, Fit aan huis (en Inspanningstest, K-03) | actief en rechtstreeks te kiezen op `/afspraak`, naast *Bikefit – huidige fiets* (beslissing Toshoni 16 okt 2026: behouden tot Max of Toshoni anders beslist); niet in het aanbod | beslissen: behouden of uitzetten (zacht, door een beheerder; bestaande boekingen blijven). Raakt G-07 | open |
| K-05 | Aanbieders per dienst | ongewijzigd: enkel de bestaande aanbieder op de vijf oude diensten. Sinds 16 okt 2026 maakt een aanbieder geen diensten meer aan en past ze niet aan; hij of zij schrijft zich enkel in voor actieve diensten (**Mijn agenda** → **Diensten**) | wie biedt welke nieuwe dienst aan, enkel door de persoon zelf bevestigd; een nieuwe dienst maakt een beheerder aan | open |
| K-06 | Prijzen in de boekingswidget | geen bedrag: **Prijs (euro)** leeg en **Prijs tonen op de website** uit bij alle diensten. Onder *Bikefit – huidige fiets* toont de widget per keuze "Prijs op aanvraag"; zodra een beheerder voor **die dienst** een bedrag invult en toont, staat dat bedrag er (Volwassene en Jeugd elk hun eigen prijs, nooit gekopieerd of per aanbieder) | goedgekeurde bedragen voor Volwassenenfit en Jeugdfit (vast of "vanaf"?) van Toshoni (geblokkeerd tot hij beslist); dan per dienst **Prijs (euro)** + **Prijs tonen** | open |

## 7. Bestaande hiaten in aangeraakte inhoud (G)

| ID | Waar (exacte plaats) | Nu | Nodig | Status |
| --- | --- | --- | --- | --- |
| G-01 | Publiek e-mailadres: `/admin` → **Instellingen** → Contact → **E-mail** (footer, contactvraag bij niet-boekbare diensten); `/afspraak` → *Vrije tekst* "Voor je komt" → "Andere vraag?"; `/privacy` en `/algemene-voorwaarden` (tekst) | `info@debikefitstudio.be`, bevestigd door Toshoni (review 13 okt 2026); in de instellingen gezet door `cms:patch-page-cleanup` (staging) en door de seed/bootstrap; blok *Contact* op home laat zijn eigen veld **E-mail** leeg | — | bevestigd |
| G-02 | Adres van de studio: **Instellingen** → Contact → **Adresregels** en **Postcode**; blok *Contact* → **Adresregels** op home (sinds 13 okt niet meer op `/afspraak`; `/contact` verwijst door naar `/afspraak`); `/admin` → **Locaties** → "De Bikefit Studio, Ninove" → **Adresregels** | enkel "Ninove", geen straat en postcode; JSON-LD laat het adres weg | adres van de studio (optioneel ook **Kaart-embed URL** in blok *Contact*) | open |
| G-03 | `/afspraak` | "Vier manieren om te boeken" is op vraag van Toshoni verwijderd (review 13 okt 2026, `cms:patch-page-cleanup`); de pagina begint nu bij "Kies je moment" | — (de keuze in de widget zelf volgt K-02 – K-04) | afgerond 2026-10-13 |
| G-04 | `/veelgestelde-vragen` (niet in deze rollout) | antwoorden noemen jeugdfit en 60/90 minuten | nakijken na D-01 – D-07 | open |
| G-05 | Korte verbindingszinnen: inleidingen van de groepen Bikefit/Begeleiding in blok *Aanbod (overzicht)* (home, `/aanbod`, `/bikefit`); sectietitels op home ("Wat we voor je doen"), `/voor-wie` ("Waar je ook staat", op vraag van Toshoni verwijderd op 13 okt 2026) en `/bikefit` ("Meten om beter te kijken", "Onze bikefitdiensten") | neutraal geschreven door de implementatie, zonder nieuwe claims | nagekeken en aanvaard door Winston (review 13 okt 2026), geen wijziging nodig | afgerond 2026-10-13 |
| G-06 | "nieuwste 3D-bewegingsanalyse": `/bikefit` en home → *Beeld + tekst* → **Alinea's**; `/aanbod/bikefit-huidige-fiets` → **Inhoud** | tekst aangeleverd door Toshoni; geen merk of toestel genoemd | merk of toestel enkel noemen met bron | bevestigd |
| G-07 | "bij jou thuis / op locatie": home → *Hero* → **Ondertitel**; `/aanbod` → *Hero* → **Ondertitel**; `/bikefit` → *Beeld + tekst* "Kan een bikefit ook bij mij thuis?" | tekst aangeleverd (hero, aanbod) of uit het prototype (`/bikefit`); belooft fits aan huis | na K-04 nakijken: wordt Fit aan huis uitgezet, dan deze zinnen aanpassen | te bevestigen |

## 8. Cadeaubon (C)

Sinds 13 oktober 2026 (vraag van Toshoni): `/aanbod` → groep **Overige** → kaart *Cadeaubon* →
`/aanbod/cadeaubon`, met een bestelformulier (bedrag naar keuze, persoonlijke boodschap,
contactgegevens). **Bestel nu** mailt de aanvraag naar de studio; factuur en betaallink maakt de
studio zelf op. Er is geen betaling, factuur, boncode of automatische mail naar de klant. Zolang
C-01 of C-02 open is, krijgt elke bezoeker "Je bestelling is niet verstuurd" met het
telefoonnummer, en blijft alles wat de bezoeker invulde staan. Uitleg en instellingen:
`docs/booking-runbook.md` § Cadeaubon.

| ID | Waar (exacte plaats) | Nu | Nodig | Status |
| --- | --- | --- | --- | --- |
| C-01 | E-mailverzending (Resend): **Beheer → E-mail** (`/admin/email`: API-sleutel en afzender), of de omgevingsvariabelen `RESEND_API_KEY` en `EMAIL_FROM` in Vercel (Arend; hebben voorrang) | niet ingesteld op staging en productie (preflight Arend, 13 okt 2026): elke bestelling meldt "niet verstuurd" | Resend-account, een afzenderdomein dat in Resend geverifieerd is (DNS), dan sleutel en afzender in `/admin/email` (of de variabelen) en een testbericht; de afzender is nooit het adres van de bezoeker | open |
| C-02 | Ontvanger van de bestellingen: **Beheer → E-mail** (`/admin/email`) → *Ontvanger cadeaubonbestellingen*, of omgevingsvariabele `GIFT_VOUCHER_RECIPIENT` (heeft voorrang). Bewust los van het publieke adres (G-01): geen automatische terugval op `info@debikefitstudio.be` | leeg: elke bestelling meldt "niet verstuurd". Het gevraagde publieke adres `info@debikefitstudio.be` blijft in footer en contacttekst; het domein gaf op 13 okt 2026 geen DNS (NXDOMAIN), dus mail daarheen zou niet aankomen | een werkende mailbox kiezen (Toshoni) en die in de instelling of de variabele zetten | open |
| C-03 | `/aanbod/cadeaubon` (*Cadeaubon*) → blok *Cadeaubon (bestelformulier)* → **Inleiding**, **Korte omschrijving**, **Titel boven het formulier** | neutraal geschreven door de implementatie: bedrag en boodschap naar keuze, factuur en betaallink na de bestelling | nakijken door Toshoni | te bevestigen |
| C-04 | Voorwaarden van de bon: geldigheid, vorm (digitaal of op papier), levering, minimum- en maximumbedrag | nergens vermeld; het formulier aanvaardt technisch € 1 tot € 5.000 (daarboven: "bel ons best even") | beslissing van de studio; daarna in de **Inleiding** en zo nodig in de algemene voorwaarden | open |

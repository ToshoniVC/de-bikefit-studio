# Register tijdelijke inhoud — De Bikefit Studio

Canonieke checklist van alle tijdelijke of onbevestigde inhoud op de publieke site, bijgehouden
sinds de herwerking van 13 oktober 2026 (Aanbod, Voor wie, Bikefit, Ons team). Toshoni vroeg om
nu met tijdelijke inhoud te werken en alles bij te houden tot het definitief is.

**Regels.** Vul nooit een feitelijk gat met een verzonnen detail (geen prijzen, duur, diploma's,
jaartallen, prestaties of merken zonder bron). Pas een rij aan in hetzelfde werk als de inhoud;
zet de status op *afgerond* met datum zodra de definitieve inhoud gepubliceerd is. Waar "CMS"
staat, gebeurt de wijziging in `/admin` → Pagina's → de pagina → het blok → het veld, gevolgd door
**Publiceren**. De seedtekst staat in `src/lib/offers/defaults.ts` en
`src/lib/studio/seed-content/aanbod.ts`; pas die mee aan zodat een nieuwe omgeving dezelfde
inhoud krijgt.

Status: **open** = nog tijdelijk · **te bevestigen** = voorstel staat online, wacht op akkoord ·
**bevestigd** = aangeleverd door Toshoni, mag blijven · **afgerond** = definitief.

## 1. Prijzen (7)

Veld: blok *Dienst (aanbod)* → **Prijs in eurocent** (bedrag) of **Prijslabel** (vrije tekst,
wint). Leeg = de site toont "Prijs op aanvraag", op de kaart in het aanbod én op de dienstpagina.
Nooit € 0 invullen.

| ID | Pagina | Nu | Nodig | Status |
| --- | --- | --- | --- | --- |
| P-01 | `/aanbod/bikefit-nieuwe-fiets` | Prijs op aanvraag | bevestigde prijs of bewust "op aanvraag" | open |
| P-02 | `/aanbod/bikefit-huidige-fiets` | Prijs op aanvraag | idem | open |
| P-03 | `/aanbod/voetanalyse` | Prijs op aanvraag | idem | open |
| P-04 | `/aanbod/zadelanalyse` | Prijs op aanvraag | idem | open |
| P-05 | `/aanbod/afstellen-schoenplaatjes` | Prijs op aanvraag | idem | open |
| P-06 | `/aanbod/lactaattest` | Prijs op aanvraag | idem | open |
| P-07 | `/aanbod/coaching` | Prijs op aanvraag | idem (traject of per sessie?) | open |

Een prijs in het aanbod verandert **niets** aan de online boeking. Wie een prijs ook in de
boekingswidget wil tonen, vult die apart in bij *Afspraken → Diensten* (prijs + "toon prijs").

## 2. Duur (7)

Veld: blok *Dienst (aanbod)* → **Duur** (vrije tekst).

| ID | Pagina | Nu | Nodig | Status |
| --- | --- | --- | --- | --- |
| D-01 | `/aanbod/bikefit-nieuwe-fiets` | Duur in overleg | bevestigde duur | open |
| D-02 | `/aanbod/bikefit-huidige-fiets` | Duur in overleg | bevestigde duur (zie K-01) | open |
| D-03 | `/aanbod/voetanalyse` | Duur in overleg | bevestigde duur | open |
| D-04 | `/aanbod/zadelanalyse` | Duur in overleg | bevestigde duur | open |
| D-05 | `/aanbod/afstellen-schoenplaatjes` | Duur in overleg | bevestigde duur | open |
| D-06 | `/aanbod/lactaattest` | Duur in overleg | bevestigde duur | open |
| D-07 | `/aanbod/coaching` | Traject en opvolging in overleg | bevestigde opzet en opvolgritme | open |

De planningsduur van een **boekbare** dienst staat los hiervan in *Afspraken → Diensten*
(Volwassenenfit 90 min, Jeugdfit 60 min — echte, bestaande waarden). Die worden niet gewijzigd
door een duur op de aanbodpagina.

## 3. Inhoud en mogelijke extra's (7)

Velden: **Doel**, **Inhoud**, **Mogelijke extra's**, **Uitleg bij de extra's**. De tekst is het
voorstel uit de werkopdracht van 13 oktober ("Suggested service content"); de uitleg bij de extra's
zegt overal dat omvang en prijs vooraf samen worden afgesproken.

| ID | Pagina | Nu | Nodig | Status |
| --- | --- | --- | --- | --- |
| E-01 | `/aanbod/bikefit-nieuwe-fiets` | voorstel: afstelling na aankoop; voet- of zadelanalyse | bevestiging van wat er echt bij kan | te bevestigen |
| E-02 | `/aanbod/bikefit-huidige-fiets` | voorstel: vervolgafspraak; voet-/zadelanalyse; onderdelen apart | idem | te bevestigen |
| E-03 | `/aanbod/voetanalyse` | voorstel: schoenplaatjes; bikefit. Geen inlegzolen vermeld | idem; of er inlegzolen worden aangeboden (nu bewust niet) | te bevestigen |
| E-04 | `/aanbod/zadelanalyse` | voorstel: ruimer traject; ander zadel/onderdelen. Geen drukmeting vermeld | idem; of er een drukmeetsysteem is (nu bewust niet) | te bevestigen |
| E-05 | `/aanbod/afstellen-schoenplaatjes` | voorstel: voetanalyse; bikefit; nieuwe plaatjes indien nodig | idem; plaatjes nooit "inbegrepen" | te bevestigen |
| E-06 | `/aanbod/lactaattest` | voorstel: coaching; vervolgmeting in overleg | idem; protocol en materiaal | te bevestigen |
| E-07 | `/aanbod/coaching` | voorstel: lactaattest; bikefit; extra opvolging | idem; vast opvolgritme pas na bevestiging | te bevestigen |
| E-08 | alle dienstpagina's | geen pakketten of combinatieprijzen | bevestigen of er pakketten zijn | open |

## 4. Team

Pagina `/ons-team`, blok *Team*. Het veld **Interne notitie** (niet publiek) herhaalt per persoon
wat ontbreekt.

| ID | Persoon / veld | Nu | Nodig | Status |
| --- | --- | --- | --- | --- |
| T-01 | Rutger Roelandts — Bio | ingekorte eigen tekst uit `content/about.html` §1 (eerder op `/over-ons`) | akkoord van Rutger op de korte versie | te bevestigen |
| T-02 | Rutger Roelandts — Rol | "Oprichter" (volgt uit zijn eigen tekst) | bevestigen | te bevestigen |
| T-03 | Rutger Roelandts — Kwalificaties | niets vermeld | diploma's/opleidingen, enkel met bron | open |
| T-04 | Rutger Roelandts — Foto | initialen "RR" | echte portretfoto (geen AI-beeld) | open |
| T-05 | Robin Van Lierde — Bio | "Robin maakt deel uit van het team van De Bikefit Studio." | korte bio van Robin zelf | open |
| T-06 | Robin Van Lierde — Rol | leeg | rol/functie | open |
| T-07 | Robin Van Lierde — Kwalificaties en specialisaties | niets vermeld | enkel met bron | open |
| T-08 | Robin Van Lierde — Foto | initialen "RV" | echte portretfoto | open |
| T-09 | Goran Van de Walle — Bio | "Goran maakt deel uit van het team van De Bikefit Studio." | korte bio van Goran zelf | open |
| T-10 | Goran Van de Walle — Rol | leeg | rol/functie | open |
| T-11 | Goran Van de Walle — Kwalificaties en specialisaties | niets vermeld | enkel met bron | open |
| T-12 | Goran Van de Walle — Foto | initialen "GV" | echte portretfoto | open |
| T-13 | Aanbod-inleiding (`/aanbod`) | "werkt uitsluitend met ervaren, gediplomeerde professionals" | algemene claim, aangeleverd door Toshoni; geen individuele diploma's vermelden zonder bron | bevestigd |

## 5. Beelden (AI, tijdelijk)

Drie gegenereerde sfeerbeelden van fictieve, algemene personen (`docs/editorial-images.md`). Ze
zijn **nooit** een portret van Rutger, Robin of Goran. Vervangen door echte studiofotografie via
*Media*, of met `npm run images:import -- --slot <slot> --src <bestand> --version 2` en daarna de
staging-rollout.

| ID | Slot / bestand | Gebruikt op | Nodig | Status |
| --- | --- | --- | --- | --- |
| B-01 | `flemish-cyclists` → `public/images/editorial/flemish-cyclists-v1.webp` | home (hero), `/bikefit` (Waarom), `/aanbod/lactaattest` | echte foto, rechten geregeld | open |
| B-02 | `bikefit-studio` → `public/images/editorial/bikefit-studio-v1.webp` | home (Bikefit), `/bikefit` (3D-analyse), de vijf Bikefit-dienstpagina's | echte foto in de studio | open |
| B-03 | `junior-coaching` → `public/images/editorial/junior-coaching-v1.webp` | home (Voor wie), `/voor-wie` (Junioren), `/aanbod/coaching` | echte foto, toestemming ouders bij minderjarigen | open |

## 6. Online boeken per dienst

Zie `docs/booking-architecture.md` §14. Veld: blok *Dienst (aanbod)* → **Online boeken via
dienst(en)**. Leeg = de boekknop leidt naar een contactvraag (bellen/mailen) die de dienst noemt.

| ID | Onderwerp | Nu | Nodig | Status |
| --- | --- | --- | --- | --- |
| K-01 | "Bikefit – huidige fiets" | gekoppeld aan de bestaande diensten Volwassenenfit (90 min) en Jeugdfit (60 min) | bevestigen dat dit dezelfde dienst is | te bevestigen |
| K-02 | De andere zes diensten | niet online boekbaar (contactvraag) | per dienst: echte duur + aanbieder(s) die ze zelf bevestigen, dan dienst aanmaken in *Afspraken → Diensten* en de slug invullen | open |
| K-03 | Lactaattest vs. bestaande dienst Inspanningstest | niet gekoppeld (niet bevestigd dat het dezelfde meting is) | beslissen: koppelen, of Inspanningstest uitzetten | open |
| K-04 | Bestaande diensten Gezinspakket en Fit aan huis | blijven actief en boekbaar via `/afspraak` zonder dienstkeuze; komen niet meer voor in het aanbod | beslissen: behouden of uitzetten (zacht; boekingen blijven) | open |
| K-05 | Aanbieders per dienst | ongewijzigd (enkel de bestaande aanbieder op de vijf oude diensten) | wie biedt welke nieuwe dienst aan — enkel door de persoon zelf bevestigd | open |

## 7. Bestaande hiaten in aangeraakte inhoud

| ID | Waar | Nu | Nodig | Status |
| --- | --- | --- | --- | --- |
| G-01 | Instellingen → Contact → e-mail | leeg; de contactvraag toont dan enkel bellen, de juridische pagina's gebruiken het onbevestigde `info@debikefitstudio.be` | publiek e-mailadres | open |
| G-02 | Instellingen → Contact → adres | geen straat en postcode | adres van de studio | open |
| G-03 | `/afspraak` (niet in deze rollout) | toont nog "Vier manieren om te boeken" (Volwassenenfit, Jeugdfit, Gezinspakket, Fit aan huis) | afstemmen op het nieuwe aanbod na K-02–K-04 | open |
| G-04 | `/veelgestelde-vragen` (niet in deze rollout) | antwoorden noemen jeugdfit en 60/90 minuten | nakijken na D-01–D-07 | open |
| G-05 | Korte verbindingszinnen (groepsinleidingen, sectietitels op home, `/voor-wie`, `/bikefit`) | neutraal geschreven door de implementatie, zonder nieuwe claims | redactie door Winston | te bevestigen |
| G-06 | "nieuwste 3D-bewegingsanalyse" (`/bikefit`, home, Bikefit – huidige fiets) | tekst aangeleverd door Toshoni; geen merk of toestel genoemd | bevestigd; merk enkel noemen met bron | bevestigd |

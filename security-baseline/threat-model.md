# Threat model worksheet

Fill-in worksheet for GOV-02. Copy it to `mappings/<project>-threat-model.md` (or into the
project's own repository), fill every table, and delete the example rows. The example rows
describe a generic booking site ("the example site"), not a real project.

## How to use

| Item      | Rule                                                                                                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who       | Security owner (GOV-01) plus one person who knows the code                                                                                                                                                                      |
| Time box  | 2–4 h for the first version, 30–60 min per review                                                                                                                                                                               |
| Inputs    | Architecture notes, data model, list of integrations, [control-matrix.md](control-matrix.md)                                                                                                                                    |
| Output    | Filled tables; every "mitigate" decision becomes a finding in the project mapping with a gate ([adoption-guide.md](adoption-guide.md))                                                                                          |
| Method    | STRIDE per trust boundary: Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege (category definitions and the OWASP Threat Modeling Cheat Sheet: [references.md](references.md)) |
| Done when | Every data flow that crosses a boundary has at least one STRIDE row, and every row has a decision, an owner and a due date                                                                                                      |

## System description

| Field                                          | Value |
| ---------------------------------------------- | ----- |
| System name                                    |       |
| Purpose (one sentence)                         |       |
| Profiles (P1–P4)                               |       |
| Users and roles                                |       |
| Components (frontend, backend, database, jobs) |       |
| Hosting and regions                            |       |
| Third parties (processors, APIs, scripts)      |       |
| Out of scope                                   |       |
| Version assessed (commit SHA, date)            |       |

Example: public pages and a booking form without accounts (P1); a staff back office for bookings
and content (P2); a webhook receiver for a calendar provider and a nightly retention job (P4).
Hosted on a platform-as-a-service with a managed relational database in the EU; a mail provider
sends confirmations.

## Assets and data classification

| Class        | Definition                      | Examples                                                                                      | Minimum handling                                                      |
| ------------ | ------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Public       | Intended for anyone             | Published pages, prices, opening hours                                                        | Integrity only                                                        |
| Internal     | Not secret, not for publication | Draft pages, analytics totals                                                                 | Access-controlled                                                     |
| Confidential | Personal data and business data | Booking name, e-mail, phone, staff names                                                      | DAT-01 to DAT-07, LOG-02                                              |
| Restricted   | Harm if disclosed even once     | Special-category data (Art. 9, e.g. health notes), credentials, session tokens, secrets, keys | Confidential plus encryption at rest, no logging, need-to-know access |

| Asset                                       | Class        | Location                     | Owner | Controls               | Notes                                        |
| ------------------------------------------- | ------------ | ---------------------------- | ----- | ---------------------- | -------------------------------------------- |
|                                             |              |                              |       |                        |                                              |
| Example: booking records                    | Confidential | Database `bookings`          | Owner | DAT-01, DAT-03, ACC-02 | Retention 24 months                          |
| Example: free-text health remarks           | Restricted   | Database `bookings.notes`    | Owner | DAT-01, DAT-02, LOG-02 | Needs an Art. 9 condition or must be removed |
| Example: staff password hashes and sessions | Restricted   | Database `users`, `sessions` | Owner | IAM-03, SES-01         |                                              |
| Example: mail provider API key              | Restricted   | Platform secret store        | Owner | DAT-06, SUP-06         | Rotate on staff departure                    |

## Actors and trust boundaries

| Actor                               | Trust                      | Entry points               | Example                                                               |
| ----------------------------------- | -------------------------- | -------------------------- | --------------------------------------------------------------------- |
|                                     |                            |                            |                                                                       |
| Example: anonymous visitor          | Untrusted                  | Public pages, booking form | Also bots and scrapers                                                |
| Example: staff editor / staff admin | Authenticated, privileged  | `/admin`                   | Phishing target                                                       |
| Example: calendar provider          | Semi-trusted service       | Webhook endpoint           | Signed requests                                                       |
| Example: CI system                  | Trusted with deploy rights | Deploy token               | Runs third-party code                                                 |
| Example: attacker                   | Hostile                    | All of the above           | Credential stuffer, bot operator, compromised dependency, ex-employee |

| Boundary     | Between                                         | Notes                                |
| ------------ | ----------------------------------------------- | ------------------------------------ |
|              |                                                 |                                      |
| Example: TB1 | Internet ↔ hosting edge                         | TLS terminates here                  |
| Example: TB2 | Edge ↔ application runtime                      | Edge must not cache personal data    |
| Example: TB3 | Application ↔ database                          | Credentials in platform secret store |
| Example: TB4 | Application ↔ third-party APIs (mail, calendar) | Outbound TLS, inbound signatures     |
| Example: TB5 | CI/CD ↔ production                              | Deploy token, protected branch       |
| Example: TB6 | Staff browser ↔ back office                     | Privileged session                   |

## Data flows

| ID           | From              | To            | Data                          | Class        | Protocol and auth            | Boundary | Controls                        |
| ------------ | ----------------- | ------------- | ----------------------------- | ------------ | ---------------------------- | -------- | ------------------------------- |
|              |                   |               |                               |              |                              |          |                                 |
| Example: DF1 | Visitor browser   | App           | Booking form fields           | Confidential | HTTPS, no auth, rate-limited | TB1, TB2 | INP-01, INP-07, WEB-01          |
| Example: DF2 | App               | Database      | Booking record                | Confidential | TLS, service account         | TB3      | DAT-07, WEB-01                  |
| Example: DF3 | App               | Mail provider | Confirmation with cancel link | Confidential | HTTPS, API key               | TB4      | DAT-06, DAT-07, WEB-05          |
| Example: DF4 | Calendar provider | App webhook   | Event change                  | Internal     | HTTPS, signature             | TB4      | ACC-04                          |
| Example: DF5 | Staff browser     | Back office   | Bookings, content edits       | Confidential | HTTPS, session, MFA          | TB6      | IAM-04, SES-01 – SES-05, ACC-01 |
| Example: DF6 | CI                | Hosting       | Build and deploy              | Internal     | Deploy token                 | TB5      | SUP-05, OPS-02                  |

## STRIDE per boundary

Scales: Likelihood and Impact are Low (1), Medium (2) or High (3); risk = likelihood × impact.
Decision rules: High risk (6–9) is mitigated, or covered by a signed exception (≤ 90 days,
[Risk acceptance](control-matrix.md#risk-acceptance)), before gate G1; Medium risk (3–4) the same
before G2; Low risk (1–2) is recorded with a one-line rationale. "Transfer" means a contract or
provider takes the risk; record the contract clause.

| Boundary / flow    | STRIDE | Threat                                                      | Existing control | Gap                                          | L   | I   | Decision                                      | Owner | Due |
| ------------------ | ------ | ----------------------------------------------------------- | ---------------- | -------------------------------------------- | --- | --- | --------------------------------------------- | ----- | --- |
|                    |        |                                                             |                  |                                              |     |     |                                               |       |     |
| Example: TB1 / DF1 | S      | Bots submit bookings with someone else's e-mail address     | INP-07           | No confirmation step before the slot is held | 3   | 1   | Mitigate                                      | Owner | G1  |
| Example: TB1 / DF1 | T      | Client changes the price or duration field                  | INP-01           | Price sent from the client                   | 2   | 2   | Mitigate: server recomputes from service ID   | Dev   | G1  |
| Example: TB6 / DF5 | S      | Credential stuffing against staff login                     | IAM-04, IAM-09   | None                                         | 3   | 3   | Mitigate (controls in place)                  | Owner | G1  |
| Example: TB4 / DF4 | S      | Forged calendar webhook frees booked slots                  | ACC-04           | Replay window not checked                    | 2   | 2   | Mitigate                                      | Dev   | G1  |
| Example: TB2       | I      | Edge caches a confirmation page with another visitor's data | WEB-05           | `no-store` not sent yet                      | 1   | 3   | Accept (risk 3, exception until fix)          | Owner | G2  |
| Example: TB2 / DF1 | D      | Bot fills every slot for next week                          | INP-07           | No per-phone limit                           | 2   | 2   | Mitigate: business limit per e-mail and phone | Dev   | G2  |
| Example: TB3 / DF5 | R      | Staff deletes a booking and nobody can tell who             | LOG-01           | Admin actions not logged                     | 2   | 2   | Mitigate                                      | Dev   | G2  |
| Example: TB5 / DF6 | E      | Compromised CI action steals the deploy token               | SUP-05           | Actions pinned to tags                       | 1   | 3   | Mitigate: pin to SHA                          | Dev   | G1  |

## Abuse cases

| ID           | As a …                   | I want to …                       | So that …                        | Expected defence                 | Test                |
| ------------ | ------------------------ | --------------------------------- | -------------------------------- | -------------------------------- | ------------------- |
|              |                          |                                   |                                  |                                  |                     |
| Example: AC1 | bot operator             | submit thousands of bookings      | real customers find no slot      | INP-07, business limits          | AT-29               |
| Example: AC2 | former employee          | reuse my old session or account   | I can still read bookings        | SES-05, OPS-07                   | AT-16, AT-59        |
| Example: AC3 | attacker                 | guess or stuff the admin password | I take over the back office      | IAM-02, IAM-04, IAM-09           | AT-04, AT-06, AT-10 |
| Example: AC4 | curious customer         | change the ID in my cancel link   | I cancel someone else's booking  | ACC-02, DAT-07 (≥ 128-bit token) | AT-20               |
| Example: AC5 | attacker with CMS access | store a script in a page          | I run code in visitors' browsers | INP-03, WEB-03                   | AT-25, AT-32        |

## Assumptions

| ID           | Assumption                                               | Why it matters                        | How we would notice it is false | Owner |
| ------------ | -------------------------------------------------------- | ------------------------------------- | ------------------------------- | ----- |
|              |                                                          |                                       |                                 |       |
| Example: AS1 | The hosting platform patches the OS and TLS stack        | Server hardening is out of our hands  | Provider security bulletins     | Owner |
| Example: AS2 | Staff devices use disk encryption and a screen lock      | Session theft from an unlocked laptop | Yearly staff check              | Owner |
| Example: AS3 | The mail provider keeps message logs for at most 30 days | Cancel links in mail logs             | DPA and provider settings       | Owner |

## Review triggers

Update the worksheet, then record the review below, when any of these happens:

| Trigger                                | Examples                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| New integration                        | Third-party API, webhook, SDK, embedded script, new processor                |
| New data category                      | First health data, payments, minors' data, new form field with personal data |
| Authentication or authorization change | Login, MFA, recovery, sessions, roles, federation                            |
| Before production                      | Gate G2 of the first production release and of every new profile             |
| Other                                  | Major framework upgrade, security incident, 12 months since the last review  |

When a new data category is special-category data or processing becomes large-scale, also decide
whether a data protection impact assessment is required (GDPR Art. 35) and record the decision.

| Date | Trigger | Sections changed | Reviewer | Commit SHA |
| ---- | ------- | ---------------- | -------- | ---------- |
|      |         |                  |          |            |

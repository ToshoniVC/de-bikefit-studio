# Security baseline

Version: 1.0.0

Date: 2026-10-13

Status: **proposed template for Toshoni's review**; not yet an adopted release policy or a claim that any control is live

A reusable, provider-independent security baseline proposal for Toshoni's coding projects. It states what a
project MUST, SHOULD or MAY do, how each requirement is verified, and which external standard backs
it. Whether a project meets it is recorded per project in a mapping, never in this text. Project
release gates in existing runbooks remain authoritative until this template is adopted for that
project. The Bikefit security work uses its own staged validation and production approval gates.

## Purpose

- One measurable target for every project, so that "secure enough" means the same thing everywhere.
- Repeatable assessments: every control has a verification method, an evidence artefact and
  acceptance tests.
- Independence from vendors: requirements name outcomes; products appear only as replaceable
  implementation choices.

## Scope

| In scope                                                                                              | Out of scope                                                                                                          |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Web applications we build and operate: public sites, back offices, customer accounts                  | Certification against ISO/IEC 27001, SOC 2 or PCI DSS; the baseline borrows requirements but certifies nothing        |
| APIs, workers, CLIs and scheduled jobs (profile P4)                                                   | Processing card numbers directly (P3 payments go through a hosted payment page)                                       |
| Code, dependencies, CI/CD, configuration, hosting and infrastructure accounts, operational procedures | Mobile and desktop apps, WebRTC, machine-learning model security; each would be added as a profile in a MINOR release |
| Personal data handled by these systems (GDPR, ePrivacy)                                               | Legal advice; privacy notices and processing agreements are reviewed by the owner or counsel                          |
|                                                                                                       | Physical security and management of staff devices beyond OPS-07                                                       |

## How to read

1. **Profiles**: pick the profiles your project combines ([control-matrix.md](control-matrix.md#profiles)).
2. **Control matrix**: the canonical list of controls with the level per profile, verification and
   standard reference ([control-matrix.md](control-matrix.md)).
3. **Topic documents**: defaults, procedures and example implementations for the harder areas. They
   explain controls; they never add new ones.
4. **Acceptance tests**: how each control is checked and which evidence to keep
   ([acceptance-tests.md](acceptance-tests.md)).
5. **Adoption**: how a project records its status, findings, exceptions and gates
   ([adoption-guide.md](adoption-guide.md)).

## Normative language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT",
"RECOMMENDED", "NOT RECOMMENDED", "MAY" and "OPTIONAL" in this baseline are to be interpreted as
described in BCP 14 (RFC 2119, RFC 8174) when, and only when, they appear in all capitals.

In the control matrix, `M` means MUST, `S` means SHOULD and `–` means not applicable for that
profile. A MUST can only be deferred through
[Risk acceptance](control-matrix.md#risk-acceptance); a SHOULD deviation needs a one-line rationale.

## Standards vs implementation choices

| Layer                 | What it is                                                                                                             | How it is marked                                                                | Changes when                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Standard              | An external requirement we cite: OWASP ASVS 5.0, NIST SP 800-63B-4, W3C CSP3, IETF RFCs, GDPR, SLSA                    | "Standard ref" column with version; full list in [references.md](references.md) | The publisher releases a new version                                                                         |
| Baseline requirement  | Our own measurable MUST or SHOULD; it may be stricter than the standard it cites                                       | Control ID, for example `IAM-02`                                                | A MINOR or MAJOR release of this baseline                                                                    |
| Implementation choice | A replaceable default that satisfies a requirement: library, provider, tool, parameter set, file format or code sketch | The words "Implementation choice (replaceable)"                                 | Any time, by the project, if the replacement meets the same requirement and the acceptance test still passes |

Rules:

- A requirement never depends on a product. A control text that only one product can satisfy is a bug.
- Where the baseline is stricter than its source, the topic document says so (for example the
  30-minute reset link against the 24 hours that SP 800-63B-4 allows).
- Where the baseline deviates from a cited standard, the deviation and its reason stand next to the
  requirement.
- Examples use reserved names (`example.com`, `example.org`, `example.invalid`) and placeholders,
  never real hosts, accounts or secrets.

## Versioning

The baseline uses Semantic Versioning 2.0.0.

| Change                                                                                                             | Bump  | Example                                                  |
| ------------------------------------------------------------------------------------------------------------------ | ----- | -------------------------------------------------------- |
| A control is removed, or tightened so that an existing Implemented-verified status could become non-compliant      | MAJOR | Minimum password length 15 → 16; a SHOULD becomes a MUST |
| A new control or a new profile; existing statuses stay valid and the new control starts as Missing in each mapping | MINOR | A new INP control for a new input type                   |
| Wording, links, references or examples; nothing that passed fails, nothing that failed passes                      | PATCH | A moved URL                                              |

Control IDs are never reused; a retired ID stays in the changelog. Each mapping records the baseline
version it was assessed against.

## Review cadence

- At least every 6 months; next review due 2027-04-13.
- Within 30 days of a new version of a cited standard (for example ASVS 5.x, SP 800-63B revision,
  CSP3 as Recommendation, SLSA 1.3, a new OWASP Top 10 edition), and after an incident or finding
  that exposes a gap.
- Every review re-checks the links in [references.md](references.md), updates the "Checked" column
  and records the outcome in the changelog, including "no change".

## File index

| File                                       | Contents                                                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [README.md](README.md)                     | Purpose, scope, conventions, versioning, changelog                                                                                                            |
| [control-matrix.md](control-matrix.md)     | Profiles, profile selection, 64 controls, risk acceptance                                                                                                     |
| [threat-model.md](threat-model.md)         | Fill-in threat-model worksheet with worked example rows                                                                                                       |
| [identity-session.md](identity-session.md) | Local identity, passwords, MFA, recovery, throttling and session defaults                                                                                     |
| [headers-csp.md](headers-csp.md)           | Security headers, CSP and its roll-out, cookies, security.txt                                                                                                 |
| [supply-chain-ci.md](supply-chain-ci.md)   | Dependencies, patch SLAs, CI/CD hardening, secret scanning, SBOM, provenance                                                                                  |
| [acceptance-tests.md](acceptance-tests.md) | AT-01 – AT-59 with runnable examples                                                                                                                          |
| [adoption-guide.md](adoption-guide.md)     | Adoption steps, status legend, gates, mapping template                                                                                                        |
| [references.md](references.md)             | Primary sources with versions and check results                                                                                                               |
| Project mappings                           | Created only after project-specific scope, owner and evidence have been reviewed; use the template in [adoption-guide.md](adoption-guide.md#mapping-template) |

## Changelog

### 1.0.0 (2026-10-13)

- First release: 4 profiles, 64 controls in 10 domains (GOV 3, IAM 11, SES 5, ACC 4, INP 7, WEB 7,
  DAT 7, SUP 9, LOG 4, OPS 7), 59 acceptance tests, threat-model worksheet, topic documents and
  adoption guide.
- Sources checked on 2026-10-13: OWASP ASVS 5.0.0, NIST SP 800-63B-4 (final, July 2025), OWASP Top
  10:2025, W3C CSP Level 3 (Working Draft), W3C WebAuthn Level 3 (Recommendation), SLSA v1.2,
  CycloneDX 1.7, SPDX 3.0, RFC 9116 and the GDPR.

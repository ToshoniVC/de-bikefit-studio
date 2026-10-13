# Supply chain and CI/CD

Dependency and pipeline policy. Covers SUP-01 – SUP-09 in [control-matrix.md](control-matrix.md)
and the detection side of DAT-06. Every section states the provider-neutral requirement first.
Tools, services and file formats shown afterwards are examples, each labelled
Implementation choice (replaceable); GitHub Actions and Dependabot appear only as examples.

## Requirements and example implementations

| Topic                | Provider-neutral requirement                                                         | Implementation choice (replaceable)                                                      |
| -------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Exact install        | Install exactly what the lockfile says; fail on drift (SUP-01)                       | `npm ci`                                                                                 |
| Composition analysis | Fail on High or Critical runtime advisories with a fix (SUP-02)                      | `npm audit --omit=dev --json` plus a gate script                                         |
| Update PRs           | Grouped update PRs at least weekly to the integration branch (SUP-03)                | Dependabot `groups`, `target-branch`, `cooldown`                                         |
| New dependencies     | Checklist before merge (SUP-04)                                                      | Pull request template section                                                            |
| CI hardening         | Least privilege, pinned steps, no secrets for fork code, protected branches (SUP-05) | GitHub Actions `permissions:`, SHA pins, branch protection; OpenSSF Scorecard as checker |
| Secret scanning      | Pre-commit and CI (SUP-06)                                                           | gitleaks via the pre-commit framework and a CI step                                      |
| SBOM                 | CycloneDX or SPDX per release (SUP-07)                                               | `npm sbom`                                                                               |
| Provenance           | SLSA Build L1, aiming at L2 (SUP-08)                                                 | Hosted build records; platform attestations                                              |
| Runtime              | Supported LTS only (SUP-09)                                                          | Node.js Active or Maintenance LTS                                                        |

## Lockfile and exact install

Control: SUP-01.

- The lockfile is committed. CI and every deploy install with the exact-lockfile command, which
  fails when manifest and lockfile disagree (verified for `npm ci`: it exits with an error instead
  of updating the lockfile).
- Packages come only from the public registry or a configured mirror; scoped internal packages are
  bound to their registry so a public package with the same name cannot replace them (dependency
  confusion, ASVS 5.0 V15.2.4).
- Lockfile diffs are reviewed: unexpected registries in resolved URLs or unexpected new packages
  block the merge.
- Install scripts run code at install time. Disabling them (`--ignore-scripts`) is RECOMMENDED where
  the build allows it; otherwise the new-dependency checklist reviews them.

## Composition analysis gate

Control: SUP-02.

| Rule                   | Value                                                                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| When                   | Every pull request, and at least daily on the default branch (advisories appear without code changes)                                                                      |
| Blocking               | Critical or High advisory (CVSS v4.0 rating 7.0–10.0 or the advisory database's equivalent) in a runtime dependency, with a fixed version available                        |
| Reported, not blocking | Development-only dependencies and advisories without a fix; both follow the SLAs below. Build tools that shape the shipped artefact (bundlers, compilers) count as runtime |
| Exceptions             | A reviewed file in the repository; each entry has package, advisory ID, reason, owner and an expiry at most 30 days ahead; the gate fails on expired or longer exceptions  |

Implementation choice (replaceable): npm plus a gate script, tested with npm 11.19.0 on a real
audit report:

```bash
npm audit --omit=dev --json > audit.json || true   # npm exits 1 whenever it finds anything
node scripts/sca-gate.mjs audit.json security-exceptions.json
```

```js
// scripts/sca-gate.mjs: block High/Critical runtime advisories that have a fix,
// unless an unexpired exception (max. 30 days ahead) covers the package.
import { readFileSync } from "node:fs";

const [auditPath, exceptionsPath] = process.argv.slice(2);
const audit = JSON.parse(readFileSync(auditPath, "utf8"));
const exceptions = exceptionsPath
  ? JSON.parse(readFileSync(exceptionsPath, "utf8"))
  : [];
const today = new Date().toISOString().slice(0, 10);
const limit = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);

let failed = false;
for (const e of exceptions) {
  if (e.expires > limit) {
    console.error(`EXCEPTION TOO LONG ${e.package} expires ${e.expires}`);
    failed = true;
  }
}
const waived = new Set(
  exceptions.filter((e) => e.expires >= today).map((e) => e.package),
);
for (const v of Object.values(audit.vulnerabilities ?? {})) {
  const blocking =
    ["high", "critical"].includes(v.severity) && v.fixAvailable !== false;
  if (blocking && !waived.has(v.name)) {
    console.error(`BLOCK ${v.severity} ${v.name} ${v.range}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
```

Exception file entry: `{"package": "example-lib", "advisory": "GHSA-xxxx-xxxx-xxxx", "reason":
"not reachable: only used in the import CLI", "owner": "security owner", "expires": "2026-11-12"}`.
The example waives per package; replace it with advisory IDs if your tool exposes them reliably.

## Patch SLAs

Control: SUP-03. ASVS 5.0 V15.1.1 asks for documented, risk-based remediation time frames; the
numbers are this baseline's choice.

| Severity                                                                                 | Remediate within    | Justification                                                                                                     |
| ---------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Critical (CVSS 9.0–10.0) or known-exploited (for example listed in the CISA KEV catalog) | 7 days              | Exploits for internet-facing web stacks appear within days; small sites are scanned automatically like large ones |
| High (7.0–8.9)                                                                           | 30 days             | Leaves time to test an upgrade in a small team without leaving a serious hole open for long                       |
| Medium (4.0–6.9)                                                                         | 90 days             | Makes "next release" measurable for projects that release roughly quarterly                                       |
| Low (0.1–3.9)                                                                            | Next routine update | Rarely exploitable on its own                                                                                     |

- The clock starts when the advisory is published with a fixed version, or when a mitigation is
  known if there is no fix. Without a fix: mitigate (configuration, feature off) or record an
  exception, and re-check weekly.
- A documented "not reachable" analysis justifies an exception, never a silent skip.
- A monthly report lists open advisories with their age; any advisory past its SLA is a finding.

## Automated update PRs

Control: SUP-03.

- Version updates at least weekly; minor and patch updates grouped per ecosystem into one PR;
  majors as separate PRs.
- Security updates as soon as available, never delayed by grouping or cooldown.
- Version updates target the integration branch (for example `staging`). Some tools always open
  security updates against the default branch; retarget or forward-port them so they still pass the
  normal branch flow, within the SLA.
- A cooldown of at least 3 days for version updates (not security updates) is RECOMMENDED, so that
  freshly published malicious versions are more likely to be caught and removed first.
- CI runs the full check set on every update PR; update PRs are merged by a person, not
  automatically, for runtime dependencies.

Implementation choice (replaceable): Dependabot. Checked in the Dependabot options reference on
2026-10-13: with `target-branch` set, security updates still use the default branch and the
options of that ecosystem do not apply to them; `cooldown` affects version updates only.

```yaml
# .github/dependabot.yml (example)
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    target-branch: staging
    cooldown:
      default-days: 3
    groups:
      minor-and-patch:
        update-types: [minor, patch]
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    target-branch: staging
```

## New-dependency review

Control: SUP-04. Copy this checklist into the pull request that adds a direct dependency.

| Check           | Pass criterion                                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Necessity       | No existing dependency covers it, and writing it ourselves would take more than about 50 lines                                                                            |
| Maintenance     | Release or commit in the last 12 months; security issues get answers                                                                                                      |
| Adoption        | At least 10,000 weekly downloads, or a written reason (niche, vendor SDK)                                                                                                 |
| Maintainers     | At least 2 maintainers or an organisation account                                                                                                                         |
| Licence         | MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or 0BSD; anything else needs the owner's approval                                                                        |
| Install scripts | None, or reviewed `preinstall`, `install` and `postinstall` scripts in the package and its new transitive packages                                                        |
| Name            | Exact name taken from the official documentation or repository; no typosquat (swapped characters, look-alike scopes); the package's repository link points to that source |
| Footprint       | Number of new transitive packages stated; more than 20 needs a reason                                                                                                     |
| Vulnerabilities | No open High or Critical advisory                                                                                                                                         |
| Provenance      | Registry signatures or provenance verified where the ecosystem offers it (for npm: `npm audit signatures`); SHOULD                                                        |

## CI hardening

Control: SUP-05.

| Requirement                   | Pass criterion                                                                                                                                                                                 | Implementation choice (replaceable): GitHub Actions                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Least-privilege token         | Default token is read-only; jobs request extra scopes explicitly                                                                                                                               | `permissions: contents: read` at workflow level                                                                                               |
| Pinned third-party steps      | Every third-party action or step pinned to a full 40-character commit SHA with a version comment; container images pinned by digest                                                            | `uses: owner/action@<40-hex-sha> # vX.Y.Z`                                                                                                    |
| No secrets for untrusted code | Workflows that run code from forks get no secrets and no write token                                                                                                                           | No `pull_request_target` or `workflow_run` job that checks out the pull request's code (GitHub's secure-use guide warns against exactly this) |
| No script injection           | Untrusted event fields (titles, branch names) never interpolated into shell; passed through environment variables                                                                              | `env: TITLE: ${{ github.event.pull_request.title }}` then `"$TITLE"`                                                                          |
| Protected branches            | Default and integration branches: changes only by pull request, required status checks, no force push, no deletion; at least one approving review when the project has two or more maintainers | Branch protection rules or rulesets                                                                                                           |
| Deploy credentials            | Only the deploy job can read them; production needs an approval (OPS-02); short-lived credentials SHOULD replace long-lived tokens                                                             | Environments with required reviewers                                                                                                          |
| Periodic check                | Quarterly run of a scorecard tool; findings on token permissions, pinning, dangerous workflows and branch protection become findings                                                           | OpenSSF Scorecard                                                                                                                             |

Implementation choice (replaceable): GitHub Actions workflow skeleton; `<40-hex-sha>` stands for
the full commit SHA of the release named in the comment:

```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main, staging]
  schedule:
    - cron: "17 5 * * *" # daily composition analysis
permissions:
  contents: read
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<40-hex-sha> # vX.Y.Z
        with:
          fetch-depth: 0 # full history for the secret scan
      - run: npm ci
      - run: npm audit --omit=dev --json > audit.json || true
      - run: node scripts/sca-gate.mjs audit.json security-exceptions.json
      # gitleaks installed beforehand from a pinned release with a verified checksum (not shown)
      - run: gitleaks git --redact --report-format sarif --report-path gitleaks.sarif .
      - run: npm test
```

## Secret scanning

Control: SUP-06 (detection for DAT-06).

- Every contributor installs the pre-commit hook during onboarding; CI scans every push; the first
  CI run after adoption scans the full history (fetch full history, not a shallow clone).
- A confirmed finding is rotated or revoked at its source within 24 h. Removing it from history is
  not a fix. Check the provider's access logs for use, record a finding, and open an incident
  (OPS-05) if personal data may be exposed. History rewrites on shared branches need an explicit
  decision by the owner.
- Allowlist entries for false positives are reviewed in a pull request and carry a reason.

Implementation choice (replaceable): gitleaks and the pre-commit framework. Commands checked
against the gitleaks README and its `.pre-commit-hooks.yaml` on 2026-10-13 (exit code 1 means leaks
found or an error):

```bash
# Developer machine (the pre-commit framework hook runs exactly this):
gitleaks git --pre-commit --redact --staged --verbose
# CI on every push, full history at adoption:
gitleaks git --redact --report-format sarif --report-path gitleaks.sarif .
# One-off scan of a working tree, including untracked files:
gitleaks dir --redact .
```

```yaml
# .pre-commit-config.yaml (example); pin rev to a release you verified
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.30.1
    hooks:
      - id: gitleaks
```

## SBOM per release

Control: SUP-07.

- Generate from the lockfile for every release; production dependencies at minimum.
- Format: CycloneDX (current specification 1.7, standardised as ECMA-424) or SPDX (current
  specification 3.0); record the format and specification version with the release.
- Keep the SBOM with the release record (tag, artefact store) for at least 12 months; use it to
  answer "which deployed release contains package X version Y" when an advisory appears.

```bash
# Implementation choice (replaceable): npm
npm sbom --omit dev --sbom-format cyclonedx > sbom.cdx.json
node -e "const b=require('./sbom.cdx.json'); if (b.bomFormat!=='CycloneDX'||!b.specVersion) process.exit(1)"
```

## Build provenance

Control: SUP-08 (SHOULD). Levels from the SLSA v1.2 Build track.

| Level    | Meaning                                                 | Baseline position              |
| -------- | ------------------------------------------------------- | ------------------------------ |
| Build L0 | No guarantees                                           | Acceptable only while adopting |
| Build L1 | Provenance exists that shows how the artefact was built | Target for every project       |
| Build L2 | Signed provenance generated by a hosted build platform  | Aspiration                     |
| Build L3 | Hardened build platform                                 | Out of scope                   |

This baseline claims no SLSA level for any project. A hosting platform that builds from git usually
links each deployment to a commit; whether its records qualify as SLSA provenance depends on the
platform's attestation format. Verify it before claiming a level in a mapping.

## Runtime versions

Control: SUP-09.

- Production runs only runtime versions in an active or maintenance LTS window and framework majors
  that still receive security fixes. For Node.js (Implementation choice (replaceable)), the
  project's release page states that production applications should use only Active LTS or
  Maintenance LTS releases.
- Pin the runtime major in one place (manifest `engines` field, version file or platform setting)
  and make CI use the same major.
- Record end-of-life dates in the mapping; finish upgrades at least 30 days before end of life.

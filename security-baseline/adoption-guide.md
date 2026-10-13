# Adoption guide

How a project adopts this proposed baseline and keeps its status honest. The output is one mapping
file per project: `security-baseline/mappings/<project>.md`, or the same file in the project's own
repository. No project is marked adopted by this template alone. Toshoni reviews the project scope,
control exceptions and proposed gates before they replace that project's existing release process.

## Rules for every mapping

- Status describes evidence, not intent. "We plan to" or "the framework probably does" is Missing.
- Never mark a control Implemented-verified without stored evidence produced at the recorded commit.
- Record the full commit SHA and the date of every assessment; a re-assessment records new ones and
  keeps the old evidence links for history.
- Every N/A has a one-line reason; every Exception follows
  [Risk acceptance](control-matrix.md#risk-acceptance).
- A mapping contains no secrets, credentials, tokens, private e-mail addresses, internal hostnames or
  personal data. Evidence is redacted before it is linked.
- The mapping states which baseline version it was assessed against; a newer baseline does not
  change old statuses until someone re-assesses.

## Status legend

| Status                 | Meaning                                                                                                                    | Required in the evidence column                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Implemented-verified   | The control is met and its acceptance test passed at the recorded commit                                                   | Link to dated evidence tied to the commit (CI log, script output, screenshot, record) |
| Implemented-unverified | Code or configuration was reviewed and appears to meet the control, but the test has not run or its evidence is not stored | File path and line at the commit                                                      |
| Partial                | Some parts of the requirement are met                                                                                      | What is met, what is missing, finding ID                                              |
| Missing                | Not met, or no evidence either way                                                                                         | Finding ID                                                                            |
| N/A                    | The subject of the control does not exist in the project                                                                   | One-line reason                                                                       |
| Exception              | A MUST deferred under Risk acceptance                                                                                      | Exception ID from the register                                                        |

## Step 1: pick profiles

1. List the components of the project (pages, back office, accounts, APIs, jobs, CLIs).
2. Apply [Profile selection](control-matrix.md#profile-selection); record each selected profile with
   a one-line reason in the mapping header.
3. Derive the applicable control list: per control, the strictest value across the selected
   profiles (M > S > –). Controls that are – for every selected profile are left out of the mapping.

## Step 2: fill the threat-model worksheet

1. Copy [threat-model.md](threat-model.md) next to the mapping and fill every table.
2. Every "mitigate" decision becomes a finding in the mapping with a severity and a gate.
3. Link the worksheet and its date from the mapping header (GOV-02).

## Step 3: create the mapping

Copy the [Mapping template](#mapping-template), then fill one row per applicable control. For each
row: read the requirement, inspect code and configuration at the assessed commit, run or locate the
acceptance test, and set the status from the evidence you hold.

### Finding severity

| Severity | Definition                                                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Critical | Exploitable now from the internet, or a legal duty is unmet; leads to account takeover, data exposure or loss of control over production |
| High     | A MUST is missing on an internet-facing component, or exploitation is likely with modest effort                                          |
| Medium   | A MUST is partly met, or a defence-in-depth layer is missing                                                                             |
| Low      | A SHOULD gap, a documentation gap or hardening with small impact                                                                         |

### Gates

These are **proposed adoption gates**. They are not retroactive blockers for remediation releases
or substitutes for a project's existing staging/production approvals. For an existing deployment,
the owner records a transition plan and an evidence-backed risk disposition before activating them.

| Gate | When                                                                             | Passes when                                                                                                                                                                                                                                                                                    |
| ---- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G0   | Before the next staging release                                                  | Mapping exists with owner, profiles and commit; no open Critical finding without an exception; no runtime dependency with an open Critical or known-exploited advisory (the SUP-03 7-day class) unless an unexpired SUP-02 exception covers it; secret scan of the full history clean (SUP-06) |
| G1   | Before real personal data enters staging or any other non-production environment | G0, plus every applicable MUST in GOV, IAM, SES, ACC, WEB and DAT, and LOG-02, OPS-01, OPS-05 and OPS-07, is Implemented-verified or Exception; no open Critical or High finding; every High threat-model risk (6–9) mitigated or covered by a signed exception                                |
| G2   | Before production (first release and every new profile)                          | G1, plus every applicable MUST is Implemented-verified or Exception; no open Critical or High finding; every Medium threat-model risk (3–4) mitigated or covered by a signed exception; acceptance tests wired per step 4; threat model reviewed for this release                              |

A gate fails while any exception it relies on has expired.

### Exceptions register

One row per exception with the fields of [Risk acceptance](control-matrix.md#risk-acceptance), plus
an ID (`E-001`, `E-002`, … never reused) and a status (Active, Expired or Closed); the columns are
in the [Mapping template](#mapping-template).

## Step 4: wire acceptance tests

| Test type                    | Wiring                                                                                             | Blocks                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Automated (CI)               | Required status checks on the protected branches (SUP-05)                                          | Merge                                |
| Automated (deployment smoke) | Run after every preview and staging deployment; read-only probes also after production deployments | Promotion from staging to production |
| Manual                       | Calendar entry with the cadence of the control; evidence stored on completion                      | The gate that needs it               |

Record the wiring per test in the mapping ("AT (wiring)" column), for example `AT-31 (smoke, all
environments)`.

## Step 5: re-assess on triggers

| Trigger                                                                                             | Action                                                                     |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 6 months since the last assessment                                                                  | Full re-assessment at a new commit                                         |
| Threat-model trigger (new integration, new data category, authentication change, before production) | Update the worksheet and the affected mapping rows before the change ships |
| Baseline MINOR release                                                                              | Add the new controls within 30 days (they start as Missing)                |
| Baseline MAJOR release                                                                              | Re-assess the changed controls before the next G2                          |
| Exception expiry                                                                                    | Close the gap or record a renewal before the expiry date                   |
| Security incident                                                                                   | Re-assess the affected controls within 14 days                             |

## Mapping template

```markdown
# Security mapping: <project>

| Field                   | Value                               |
| ----------------------- | ----------------------------------- |
| Project                 | <name>                              |
| Repository              | <URL without credentials>           |
| Baseline version        | 1.0.0                               |
| Profiles                | <P1, P2, ...> with one-line reasons |
| Commit assessed         | <full 40-character SHA>             |
| Date assessed           | <YYYY-MM-DD>                        |
| Assessor                | <name or agent identifier>          |
| Security owner / deputy | <name> / <name>                     |
| Threat model            | <link>, dated <YYYY-MM-DD>          |

Status legend: Implemented-verified, Implemented-unverified, Partial, Missing, N/A, Exception
(definitions in security-baseline/adoption-guide.md). Status describes evidence, not intent.

## Controls

| Control | Level | Status  | Evidence or reason                | AT (wiring)    | Finding / exception | Notes |
| ------- | ----- | ------- | --------------------------------- | -------------- | ------------------- | ----- |
| GOV-01  | M     | Partial | Met: owner named. Missing: deputy | AT-01 (manual) | F-001               |       |

## Findings

| ID    | Control | Severity | Description     | Gate | Owner  | Due          | Status |
| ----- | ------- | -------- | --------------- | ---- | ------ | ------------ | ------ |
| F-001 | GOV-01  | Medium   | No deputy named | G1   | <name> | <YYYY-MM-DD> | Open   |

## Exceptions register

| ID  | Control | Reason | Compensating measures | Risk owner (signed, date) | Expiry | Exit | Status |
| --- | ------- | ------ | --------------------- | ------------------------- | ------ | ---- | ------ |

## Gates

| Gate | Status         | Date         | Blocking items |
| ---- | -------------- | ------------ | -------------- |
| G0   | <Pass or Fail> | <YYYY-MM-DD> | <finding IDs>  |
| G1   |                |              |                |
| G2   |                |              |                |

## Evidence index

| Evidence | Controls | Commit | Date | Location |
| -------- | -------- | ------ | ---- | -------- |
```

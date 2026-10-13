# Identity and sessions

Local, application-controlled identity defaults for profiles P2 (staff/admin) and P3 (customer
account). Covers IAM-01 – IAM-11, SES-01 – SES-05 and the audit events of LOG-01 in
[control-matrix.md](control-matrix.md). This is a target; it does not describe any existing system.

## Hard rule: local identity

- Login and recovery run inside the application with credentials the application controls (IAM-01).
- No dependency on Google, Gmail, Microsoft (Entra ID, Outlook) or any other external identity
  provider (IdP) for authentication or recovery.
- Federation MAY be added later as an extra option ([Federation later](#federation-later)), never
  as the only path. Every P2 admin keeps a local password plus MFA path.
- E-mail carries notifications and P3 reset links through a replaceable mail transport. A mailbox is
  never an authentication factor: e-mail codes and magic links do not count as a second factor.
- Scope: applications we build. Access to third-party infrastructure consoles is OPS-07.

## Defaults table

Defaults are what a new project uses. A project may choose another value only inside the MUST
bounds of the control and records the choice in its mapping.

| Setting                                     | P2 default                                                                                                                                   | P3 default                                       | Standard source                                        | Implementation choice?                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------- |
| External IdP as only login or recovery path | Not allowed                                                                                                                                  | Not allowed                                      | Baseline rule (IAM-01)                                 | No                                       |
| Password minimum length                     | 15                                                                                                                                           | 15; 8 only if MFA is mandatory and not removable | 800-63B-4 §3.1.1.2                                     | No                                       |
| Password maximum accepted                   | ≥ 64; cap 256                                                                                                                                | ≥ 64; cap 256                                    | 800-63B-4 §3.1.1.2; ASVS 5.0 V6.2.9                    | Cap value: yes                           |
| Composition rules, periodic rotation, hints | None                                                                                                                                         | None                                             | 800-63B-4 §3.1.1.2; ASVS 5.0 V6.2.5, V6.2.10, V6.4.2   | No                                       |
| Blocklist                                   | ≥ 3,000 common + context words + breached corpus                                                                                             | Same                                             | ASVS 5.0 V6.2.4, V6.2.11, V6.2.12                      | Breached-corpus source: yes              |
| Password hash                               | Argon2id m=19 MiB, t=2, p=1                                                                                                                  | Same                                             | Password Storage CS; ASVS 5.0 V11.4.2                  | Yes (scrypt N=2^17, r=8, p=1 equivalent) |
| Salt                                        | 128-bit random per hash                                                                                                                      | Same                                             | 800-63B-4 §3.1.1.2 (≥ 32 bits)                         | No                                       |
| MFA                                         | Required for all roles                                                                                                                       | Offered; required when takeover impact is High   | 800-63B-4 §2.2; ASVS 5.0 V6.3.3                        | No                                       |
| Second factors                              | WebAuthn/passkey (preferred), TOTP                                                                                                           | Same                                             | 800-63B-4 §2.2.2, §3.2.5; RFC 6238                     | Library: yes                             |
| Not accepted as second factor               | SMS, voice, e-mail                                                                                                                           | E-mail; SMS and voice SHOULD NOT                 | 800-63B-4 §3.1.3; ASVS 5.0 V6.6.1                      | No                                       |
| TOTP                                        | 30 s step, ±1 step, 6 digits, 160-bit secret, single use                                                                                     | Same                                             | RFC 6238 §5.2; RFC 4226 §4; ASVS 5.0 V6.5.1            | No                                       |
| Recovery codes                              | 10 × 80 bits, single use, hashed                                                                                                             | Same (when MFA is on)                            | 800-63B-4 §4.2.1.1; ASVS 5.0 V6.5.2                    | Encoding: yes                            |
| Self-service e-mail reset                   | Not allowed                                                                                                                                  | Link ≤ 30 min, single use, token hashed          | 800-63B-4 §4.2.1.2 (≤ 24 h; we are stricter)           | Mail transport: yes                      |
| Admin-issued link or temporary password     | ≤ 24 h, single use                                                                                                                           | ≤ 24 h, single use                               | ASVS 5.0 V6.4.1                                        | No                                       |
| Throttling                                  | Per identifier and IP: backoff from 6th failure, 1 s doubling to 15 min; IP > 50/15 min → 429; per identifier: notify at 20, recovery at 100 | Same                                             | 800-63B-4 §3.2.2; ASVS 5.0 V6.1.1                      | Counter store: yes                       |
| Enumeration timing tolerance                | Median difference < 50 ms                                                                                                                    | Same                                             | ASVS 5.0 V6.3.8                                        | No                                       |
| Session token                               | 256-bit random; SHA-256 or keyed HMAC-SHA-256 at rest                                                                                        | Same                                             | ASVS 5.0 V7.2.3 (≥ 128 bits)                           | SHA-256 or HMAC: yes                     |
| Session cookie SameSite                     | Strict (Lax acceptable)                                                                                                                      | Lax                                              | 800-63B-4 §5.1.1                                       | No                                       |
| Idle timeout                                | 30 min                                                                                                                                       | 60 min                                           | 800-63B-4 §2.2.3 (≤ 1 h SHOULD); Session Management CS | No                                       |
| Absolute lifetime                           | 12 h                                                                                                                                         | 24 h; "remember me" ≤ 30 days                    | 800-63B-4 §2.1.3, §2.2.3                               | No                                       |
| Re-authentication window                    | 5 min                                                                                                                                        | 5 min                                            | ASVS 5.0 V7.5.1                                        | No                                       |
| Concurrent sessions                         | 5, oldest revoked                                                                                                                            | 10, oldest revoked                               | ASVS 5.0 V7.1.2 (documented limit)                     | Yes                                      |
| Notification delay                          | ≤ 5 min                                                                                                                                      | ≤ 5 min                                          | 800-63B-4 §4.6; ASVS 5.0 V6.3.7                        | Mail transport: yes                      |

## Accounts

Controls: IAM-01, IAM-07.

- One account per person. No shared, default or generic accounts (`admin`, `info@`, `test`).
- The first admin is created by a bootstrap command that issues a one-time setup link (IAM-07),
  never a default password.
- At least two people hold admin rights when the team has two or more members. A solo owner keeps
  recovery codes offline (printed, stored safely).
- Last-resort operator recovery: a command run by someone with production infrastructure access
  (OPS-07) issues a one-time setup link for a named account and writes an audit entry.
  Implementation choice (replaceable).
- Departing staff are disabled, not deleted; disabling revokes all their sessions (SES-05).

## Passwords

Control: IAM-02.

| Rule                         | Value                                                                                                                                                                            | Source                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Minimum length               | 15; 8 only if MFA is mandatory and the user cannot remove it                                                                                                                     | 800-63B-4 §3.1.1.2                   |
| P2 default                   | 15 although MFA would allow 8: an admin password must still hold while a factor is re-enrolled                                                                                   | Baseline judgement                   |
| Maximum                      | At least 64 accepted; default cap 256 to bound request size                                                                                                                      | 800-63B-4 §3.1.1.2; ASVS 5.0 V6.2.9  |
| Characters                   | Printable ASCII including space, and Unicode; one code point counts as one character; NFC normalisation at set and verify time, no other change (no truncation, no case folding) | 800-63B-4 §3.1.1.2; ASVS 5.0 V6.2.8  |
| Composition                  | No rules about character classes                                                                                                                                                 | 800-63B-4 §3.1.1.2; ASVS 5.0 V6.2.5  |
| Rotation                     | Never periodic; forced only on evidence of compromise                                                                                                                            | 800-63B-4 §3.1.1.2; ASVS 5.0 V6.2.10 |
| Hints and security questions | Not offered                                                                                                                                                                      | 800-63B-4 §3.1.1.2; ASVS 5.0 V6.4.2  |
| Entry                        | `type=password` with optional show toggle; paste and password managers allowed                                                                                                   | ASVS 5.0 V6.2.6, V6.2.7              |
| Change                       | Requires the current password and a recent re-authentication (SES-04)                                                                                                            | ASVS 5.0 V6.2.3                      |

Blocklist (reject with the reason shown, as 800-63B-4 §3.1.1.2 requires):

1. The 3,000 or more most common passwords that satisfy the length rule (ASVS 5.0 V6.2.4).
2. Context words: product, organisation and domain names, the username, the e-mail local part and
   simple derivatives (ASVS 5.0 V6.1.2, V6.2.11).
3. A breached-password corpus (ASVS 5.0 V6.2.12): a local file, or a k-anonymity range query that
   sends only the first 5 hex characters of the password's SHA-1 hash; source and transport are an
   Implementation choice (replaceable). SHA-1 is used only as the lookup key the corpus defines,
   not for security. If the range service is unreachable, fall back to the local lists; never send
   more than the prefix and never block a password change because of an outage.

## Password storage

Control: IAM-03. The minimums are baseline requirements; the algorithm (Argon2id or scrypt) and
any parameters above the minimums are an Implementation choice (replaceable).

| Parameter     | Argon2id (default)                                                                     | scrypt (alternative)      |
| ------------- | -------------------------------------------------------------------------------------- | ------------------------- |
| Cost          | m = 19 MiB, t = 2                                                                      | N = 2^17, r = 8 (128 MiB) |
| Parallelism   | p = 1                                                                                  | p = 1                     |
| Salt          | 16 random bytes per hash                                                               | 16 random bytes per hash  |
| Stored format | Self-describing string with algorithm, version, parameters, salt and hash              | Same                      |
| Upgrade       | Re-hash at the next successful login when stored parameters are below current defaults | Same                      |

- Pepper (optional, 800-63B-4 §3.1.1.2 SHOULD): an extra keyed hash with a key from the secrets
  store (DAT-06), never stored in the database. Implementation choice (replaceable).
- Unknown users: verify against a fixed dummy hash so timing does not reveal existence (IAM-10).
- Node.js note, Implementation choice (replaceable): scrypt with N = 2^17, r = 8 needs a `maxmem`
  option above 128 MiB; the default limit (32 MiB) rejects these parameters.

## Multi-factor authentication

Controls: IAM-04, IAM-05. Factor trade-offs: OWASP Multifactor Authentication Cheat Sheet
([references.md](references.md)).

| Factor              | P2                  | P3                                                            | Notes                                                                                                                                                                                    |
| ------------------- | ------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WebAuthn / passkey  | Accepted, preferred | Accepted, preferred                                           | Phishing-resistant (800-63B-4 §3.2.5); synced passkeys allowed (§3.1.7.4)                                                                                                                |
| TOTP (RFC 6238)     | Accepted            | Accepted                                                      | 30 s step, at most ±1 step drift (RFC 6238 §5.2), 6 digits, 160-bit secret from a CSPRNG (RFC 4226 §4), secret stored AEAD-encrypted (DAT-07), each code accepted once (ASVS 5.0 V6.5.1) |
| SMS or voice code   | Not accepted        | SHOULD NOT; if offered, only under ASVS 5.0 V6.6.1 conditions | Restricted authenticator (800-63B-4 §3.1.3.3); also a telecom dependency                                                                                                                 |
| E-mail code or link | Not accepted        | Not accepted as a factor                                      | 800-63B-4 §3.1.3.1: e-mail SHALL NOT be used for out-of-band authentication                                                                                                              |
| Recovery code       | Recovery only       | Recovery only                                                 | See [Recovery codes](#recovery-codes)                                                                                                                                                    |

- P2: after a correct password the session is "pending MFA": it can only complete the second
  factor and expires after 5 min. An account without a factor is sent straight into enrolment. The
  last factor cannot be removed; add a new one first.
- P3: MFA is offered to all accounts and enforced when the threat model rates account-takeover
  impact High (stored payment methods, special-category data, acting for other people).
- Passwordless (passkey-only) login is out of scope of 1.0.0; adding it is a MINOR release.

Enrolment:

1. Re-authenticate (SES-04).
2. Create the factor: a WebAuthn credential, or a TOTP secret shown once as QR code and text on a
   page with `Cache-Control: no-store`.
3. Activate only after one valid assertion or code.
4. Issue recovery codes (IAM-06) and require the user to confirm they stored them.
5. Notify (IAM-11), log `auth.mfa.enrolled` (LOG-01) and rotate the session token (SES-01).

Removing a factor needs re-authentication, sends a notification and revokes other sessions (SES-05).

## Recovery codes

Control: IAM-06.

| Setting      | Value                                                                                     | Source                                                                                |
| ------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Count        | 10                                                                                        | Baseline judgement; 800-63B-4 §4.2.1.1 needs at least one code and re-issue after use |
| Entropy      | 80 bits default, at least 64 bits                                                         | 800-63B-4 §4.2.1.1                                                                    |
| Format       | 16 Crockford Base32 characters shown as 4 groups of 4; case and separators ignored        | Implementation choice (replaceable)                                                   |
| Storage      | Password hashing function with its own salt, because 80 bits is below 112                 | ASVS 5.0 V6.5.2                                                                       |
| Use          | Replaces the second factor at login (password + code); never resets the password alone    | 800-63B-4 §4.2.2                                                                      |
| After use    | Code invalidated, user notified, a new set must be generated before the session continues | 800-63B-4 §4.2.1.1                                                                    |
| Regeneration | Needs re-authentication, invalidates the old set, sends a notification                    | 800-63B-4 §4.2.1.1                                                                    |
| Guessing     | Counts against IAM-09 throttling                                                          | 800-63B-4 §4.2.1.1                                                                    |

## Admin-assisted recovery and issued credentials

Control: IAM-07. P2 recovery is recovery codes or this procedure, never e-mail self-service.

| Step              | Rule                                                                                                                                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Request        | The user asks through a known channel; the request itself proves nothing                                                                                                                                                                  |
| 2. Identity check | A second admin (not the requester) verifies out of band: in person, or a video call plus a call-back to a phone number already on file (ASVS 5.0 V6.4.4)                                                                                  |
| 3. Reset          | The admin triggers the reset: all sessions revoked, password and/or factors disabled as needed, a one-time setup link (≥ 128-bit token, ≤ 24 h) delivered directly to the user; the admin never sees or sets a password (ASVS 5.0 V6.4.6) |
| 4. Completion     | The user sets a password, enrols MFA and receives new recovery codes                                                                                                                                                                      |
| 5. Record         | Audit entry with requester, verifying admin, method and time (LOG-01); notification to the user (IAM-11)                                                                                                                                  |

- Solo admin: use the operator recovery command ([Accounts](#accounts)).
- Invites and initial credentials use the same one-time link. If no link can be delivered, a random
  temporary password of 20 characters (about 100 bits), valid ≤ 24 h and single use, is handed over
  in person; the first login forces a new password and MFA enrolment (ASVS 5.0 V6.4.1).

## Self-service reset

Control: IAM-08 (P3 only).

1. The request form takes the identifier and always answers "If an account exists, we sent an
   e-mail" in the same time (IAM-10); it is rate-limited (INP-07) and throttled (IAM-09).
2. Token: 32 random bytes (256 bits), base64url. Store only SHA-256(token) or a keyed
   HMAC-SHA-256 of it, user, expiry (30 min) and a used flag; a new request invalidates older
   tokens.
3. Send via one mail interface with adapters for SMTP or a provider API, an
   Implementation choice (replaceable). The landing page sends `Cache-Control: no-store` and
   `Referrer-Policy: no-referrer` (WEB-05) and does not consume the token on GET, because link
   scanners prefetch; the user submits a form (POST).
4. On submit: check hash, expiry and used flag; apply IAM-02; mark used; revoke all sessions
   (SES-05); notify (IAM-11).
5. An enrolled second factor stays required at the next login; the reset never logs the user in
   (ASVS 5.0 V6.4.3).
6. Lost password and second factor: recovery code plus reset link (two methods, 800-63B-4 §4.2.2),
   or support-assisted per IAM-07.

## Throttling

Control: IAM-09. Counters are database-backed so limits hold across instances; the counter store
is an Implementation choice (replaceable).

| Rule           | Value                                                                                                                                                                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keys           | Backoff per pair of normalised submitted identifier and source IP (IPv6: the /64 prefix); account-wide counter per identifier, also for unknown identifiers                                                                                                                |
| Backoff        | After the n-th consecutive failure of a pair (n ≥ 6) its next attempt waits 2^(n−6) s, capped at 15 min                                                                                                                                                                    |
| Per IP         | More than 50 failures in 15 min → 429 with `Retry-After` for 15 min                                                                                                                                                                                                        |
| Notify         | Account-wide 20 consecutive failures: user notified (IAM-11), security owner alerted (LOG-04)                                                                                                                                                                              |
| Ceiling        | Account-wide 100 consecutive failures: password disabled until recovery (800-63B-4 §3.2.2); from a single source the backoff stretches this over at least 21 h                                                                                                             |
| Reset          | A successful login with all required factors clears both counters                                                                                                                                                                                                          |
| Lockout DoS    | No permanent lockout: waits apply per source and expire by themselves, so failures from other sources do not delay the user's own attempts; a distributed attack can reach the ceiling, but the user is warned at 20 and recovery (IAM-06, IAM-07, IAM-08) restores access |
| Response       | 429 with `Retry-After`, or where no status code can be set the documented INP-07 equivalent carrying the wait; identical for known and unknown identifiers                                                                                                                 |
| Bot challenges | Not required; if added, self-hosted or replaceable. Implementation choice (replaceable)                                                                                                                                                                                    |

## Uniform responses

Control: IAM-10.

- Same status code, body and headers (except volatile ones such as `Date`, request ID or CSP
  nonce) for unknown user, wrong password, wrong second factor and disabled account.
- Unknown users still go through password verification against a dummy hash; e-mails are queued so
  that reset and registration requests take the same time either way.
- P3 registration answers "If this address can be used, we sent a link"; an existing user receives
  a "you already have an account" e-mail instead.

## Notifications

Control: IAM-11. Sent within 5 min; content says what happened, when, from which coarse device or
location, and what to do if it was not the user. Never include a link that logs in.

| Event                                       | Recipient                          |
| ------------------------------------------- | ---------------------------------- |
| Password changed or reset                   | Account address                    |
| MFA factor added or removed                 | Account address                    |
| Recovery code used or codes regenerated     | Account address                    |
| E-mail address changed                      | Old and new address                |
| Role elevated (for example editor to admin) | Account address and security owner |
| 20 consecutive failed logins (IAM-09)       | Account address                    |

## Sessions

Controls: SES-01 – SES-05.

| Item              | Default                                                                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token             | 32 random bytes (256 bits), base64url, opaque; database stores only its SHA-256 digest, or an HMAC-SHA-256 with a key from the secrets store (SES-01, DAT-06)                      |
| Session record    | User, created, last seen, absolute expiry, time of last authentication (for SES-04), factors used, revoked at, coarse user agent. Schema is an Implementation choice (replaceable) |
| Cookie            | `__Host-session`; Secure; HttpOnly; Path=/; no Domain; SameSite Strict (P2) or Lax (P3); Max-Age ≤ absolute lifetime (SES-02)                                                      |
| Idle              | Measured from the last authenticated request; P2 30 min, P3 60 min (SES-03)                                                                                                        |
| Absolute          | From login; P2 12 h, P3 24 h or 30 days with "remember me" (SES-03); successful re-authentication restarts both timers (800-63B-4 §5.2)                                            |
| Rotation          | New token at login after all factors, at re-authentication and at privilege change (SES-01)                                                                                        |
| Re-authentication | P2: password and second factor; P3: password, plus the second factor when enrolled; valid 5 min (SES-04)                                                                           |
| Logout            | POST; revokes the record server-side; clears the cookie; SHOULD send `Clear-Site-Data: "cache", "cookies", "storage"` (ASVS 5.0 V14.3.1)                                           |

Revocation (SES-05): revoked tokens fail on the next request.

| Event                                             | Revokes                                        |
| ------------------------------------------------- | ---------------------------------------------- |
| Logout                                            | Current session                                |
| "Log out other sessions"                          | All other sessions of the user                 |
| Password change or reset, MFA change, role change | All other sessions; the current one is rotated |
| Account disabled or deleted                       | All sessions                                   |
| Admin action "revoke sessions"                    | All sessions of the selected user              |

## Audit events

Logged per LOG-01 with UTC timestamp, actor, action, target, source IP, request ID and outcome.
Never log passwords, codes, tokens, session tokens or reset links (LOG-02); refer to a session by
its record ID.

| Event                                                                                     | Extra fields                                                                                                             |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `auth.login.success`, `auth.login.failure`                                                | Factors used; internal failure reason (unknown identifier, bad password, bad factor, throttled), never shown to the user |
| `auth.mfa.enrolled`, `auth.mfa.removed`                                                   | Factor type                                                                                                              |
| `auth.recovery_code.used`, `auth.recovery_codes.regenerated`                              | Codes left                                                                                                               |
| `auth.password.changed`, `auth.password.reset.requested`, `auth.password.reset.completed` | Channel                                                                                                                  |
| `auth.throttle.triggered`                                                                 | Key type (identifier or IP), level                                                                                       |
| `auth.admin_reset`                                                                        | Requester, verifying admin, verification method                                                                          |
| `auth.reauth`                                                                             | Action that required it                                                                                                  |
| `user.role.changed`, `user.disabled`                                                      | Old and new role, changed by                                                                                             |
| `session.revoked`                                                                         | Scope (one, others, all), revoked by                                                                                     |
| `authz.denied`                                                                            | Route or action, missing permission                                                                                      |
| `admin.personal_data.exported`, `admin.personal_data.deleted`                             | Record type, count                                                                                                       |

## Federation later

Optional, only as an additional login method, introduced as an authentication change (threat model
review trigger).

- Satisfy ASVS 5.0 V6.8.1 – V6.8.4, V7.6.1, V7.6.2 and the applicable V10 requirements.
- Identify users by issuer plus subject, never by e-mail address alone (ASVS 5.0 V6.8.1, V10.5.2).
- Keep the local password plus MFA path for every P2 admin; AT-03 runs with the IdP blocked.
- Keep enforcing P2 MFA locally unless the IdP proves the factors used (`acr`, `amr`,
  `auth_time`) and the mapping documents it (ASVS 5.0 V6.8.4).

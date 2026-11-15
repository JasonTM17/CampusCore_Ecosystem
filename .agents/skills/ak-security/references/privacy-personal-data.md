# Privacy and Personal Data Checklist

Reference checklist for `ak:security` audits whose scope collects, stores,
logs, transfers, or exports personal data. Run it alongside the STRIDE
Information Disclosure and OWASP A01/A02/A09 checks in
`stride-owasp-checklist.md`.

This is an engineering checklist, not legal advice. Obligations depend on the
jurisdictions of the users and the operator (for example GDPR in the EU,
CCPA/CPRA in California, Vietnam's Decree 13/2023/ND-CP and its successor
personal data protection law). Report a finding that needs a legal judgment as
`Needs legal review`; do not decide lawful basis or retention periods yourself.

---

## 1. Data Inventory

Before checking controls, list what the scope actually handles. Trace each
field from input to storage, logs, analytics, backups, and third parties.

| Class | Examples | Default handling |
|-------|----------|------------------|
| Identifiers | Name, username, user ID, device ID, IP address, cookie ID | Personal data |
| Contact | Email, phone, postal address | Personal data |
| Government / financial | National ID (e.g. CCCD), passport, tax ID, bank account, card number | High risk — encrypt, restrict, mask |
| Sensitive / special category | Health, biometrics, precise location, religion, political views, sexual orientation, criminal records | Highest risk — explicit basis, strict access, minimal retention |
| Children's data | Any data of users under the applicable age threshold | Parental-consent and minimization rules |
| Credentials | Passwords, tokens, recovery codes | Secrets — see Secret Patterns; never personal-data logs |

- [ ] Every personal-data field in the scope is listed with its source, purpose, storage location, and recipients
- [ ] Fields with no documented purpose are flagged for removal (minimization)
- [ ] Data flows to third parties (analytics, error tracking, email, payments, AI/LLM providers) are identified

---

## 2. Collection and Purpose

- [ ] Forms collect only fields needed for the stated purpose; optional fields are marked optional
- [ ] Consent, where it is the basis, is opt-in, granular, recorded with timestamp and version, and withdrawable as easily as given
- [ ] Non-essential cookies and trackers load only after consent
- [ ] Privacy notice is linked at each collection point
- [ ] Age gating or parental-consent flow exists when children can sign up
- [ ] Data collected for one purpose is not reused for another (e.g. support email → marketing) without a new basis

---

## 3. Storage and Access

- [ ] Personal data encrypted in transit (TLS 1.2+) and at rest; high-risk fields use field-level encryption or tokenization
- [ ] Encryption keys stored outside the database (KMS/HSM/secret manager) and rotated
- [ ] Access is least-privilege and server-side enforced; support/admin tools show masked values by default
- [ ] Bulk export and admin reads of personal data are logged with actor, reason, and record count
- [ ] Non-production environments use synthetic or irreversibly anonymized data, never production copies
- [ ] Test fixtures, seeds, and snapshots contain no real personal data
- [ ] Pseudonymized data keeps its re-identification key separately and under stricter access

---

## 4. Leakage Channels

The most common real-world findings. Check each channel explicitly.

### Logs, traces, and errors
- [ ] Application logs record user IDs, not emails, phones, addresses, or document numbers
- [ ] Request/response body logging is disabled or redacts personal fields
- [ ] Error trackers scrub personal data before sending (e.g. Sentry `beforeSend`, `sendDefaultPii: false`)
- [ ] Stack traces and validation errors returned to clients never echo other users' data

### URLs and client storage
- [ ] Personal data never appears in URL paths or query strings (they land in logs, history, and `Referer`)
- [ ] `localStorage`/`sessionStorage` hold no personal or high-risk data beyond what the UI needs right now; cleared on sign-out
- [ ] API responses return only fields the screen uses (no full user objects to the client)

### Third parties
- [ ] Analytics events carry pseudonymous IDs, not names/emails/phones; session replay masks inputs and text by default
- [ ] Prompts and files sent to AI/LLM providers are minimized or redacted, and the provider's retention/training terms are recorded
- [ ] Each processor has a documented purpose and data-processing agreement; cross-border transfers are flagged

---

## 5. Retention and Deletion

- [ ] Each data class has a defined retention period, enforced by code (TTL, scheduled purge), not by policy alone
- [ ] Account deletion removes or anonymizes data in primary stores, search indexes, caches, analytics, and third-party processors
- [ ] Backups age out on a known schedule; restore procedures re-apply pending deletions
- [ ] Soft-deleted records are excluded from all reads and purged after the retention window
- [ ] Logs containing any personal data have a shorter retention than general logs

---

## 6. Data Subject Rights

- [ ] Users can access/export their data in a machine-readable format
- [ ] Users can correct their data, and corrections propagate to derived stores
- [ ] Users can delete their account and withdraw consent without contacting support where feasible
- [ ] Rights requests are authenticated (no export to an unverified requester) and logged
- [ ] Requests can be fulfilled within the applicable deadline (track request date and completion)

---

## 7. Breach Readiness

- [ ] Alerts exist for anomalous bulk reads/exports of personal data
- [ ] An incident runbook identifies who assesses notification duties and the deadlines that apply (e.g. 72 hours under GDPR)
- [ ] Audit logs are sufficient to determine which records and users were affected

---

## Detection Patterns

Scan the scope with these patterns. Every match needs manual review — they
locate candidates, they do not prove a finding.

```regex
# Personal fields passed to log/print calls
(?i)(console\.(log|info|warn|error|debug)|logger\.\w+|logging\.\w+|log\.\w+|print)\s*\(.*\b(email|phone|mobile|address|dob|birth|ssn|passport|national_?id|cccd|tax_?id|iban|card_?number|ip_?addr)\b

# Personal data in URLs or query strings
[?&](email|phone|mobile|dob|ssn|passport|national_?id|cccd|full_?name)=

# Personal or high-risk data written to browser storage
(?i)(localStorage|sessionStorage)\.setItem\(\s*['"][^'"]*(email|phone|address|dob|ssn|passport|cccd|card)

# Third-party calls that may carry personal data — inspect the payload
(?i)(gtag\(|analytics\.(track|identify)|posthog\.(capture|identify)|mixpanel\.(track|identify)|amplitude\.track|Sentry\.setUser|fbq\()

# Real-looking email addresses in fixtures, seeds, and snapshots
[A-Za-z0-9._%+-]+@(?!example\.(com|org|net)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}
```

> False positive reduction: ignore reserved domains (`example.com`,
> `example.org`, `.test`, `.invalid`), clearly synthetic values, and field
> names in schema/type definitions that are not logged or transmitted.

---

## Severity Mapping

Use the `ak:security` severity scale with these privacy anchors:

| Finding | Severity |
|---------|----------|
| Sensitive, government, or financial data exposed to unauthorized users, or readable via IDOR | Critical |
| Production personal data in a repository, fixture, or non-production environment | Critical |
| Personal data in logs, URLs, error trackers, or analytics sent to third parties | High |
| No working deletion path, or deletion skips derived stores/processors | High |
| High-risk fields stored unencrypted at rest | High |
| Collection without a documented purpose; missing retention enforcement | Medium |
| Over-fetching personal fields to the client; storage not cleared on sign-out | Medium |
| Missing notice link, consent record versioning, or export format gaps | Low |

---

## Reporting Personal Data Safely

Findings must never reproduce real personal data. Apply the same rule as
Credential Hygiene in `SKILL.md`:

- Reference the field and location (`users.phone`, `api/export.ts:88`), not the value
- Mask any value that must be shown: `j***@e***.com`, `+84 *** *** 123`
- Never paste database rows, log lines, or screenshots that contain real user data into reports, commits, or TSV logs

# Sprint 4C backend preparation — review before execution

Updated during the pre-execution review in `/workspace/work/sellnova-4c` on
`sellnova-v2-development`. Baseline `28030b9bd2bd3f91eb2988b13ed693ce6c3af221`
was committed and pushed with user approval. The current corrections are
uncommitted and unapplied; see `SPRINT_4C_PRE_EXECUTION_REVIEW.md` for the explicit
old/new checksum comparison, findings and lock inventory. The user reports
independent verification of the deployed eighteen-entry history; no database
connection or SQL execution was performed by Codex for this review. A match to
the old migration checksum does not approve the corrected candidate.

## Proposed migration and order

Manifest entry 19: `database/development/corrections/008_admin_subscription_management.sql`.
SHA-256: `bf33cccea4ea7ef73fde4d6eb9ae55ced682be6bc63938b62a00e231dc681bde`.
Entries 1–18, their SQL bytes, hashes and ordering are unchanged. Only entry 19
is appended. The existing runner checks every manifest checksum and deployed
ledger entry, runs unapplied entries in order in one transaction, records the
new checksum, and reruns its original postflight assertions. With exactly 18
verified entries, only entry 19 and the existing read-only postflight assertions
are executed. No seed is added or rerun.

The new SQL also requires the pinned development runner context and an
18-entry development ledger containing the expected entry 18 hash. This is an
additional guard, not a substitute for full independent ledger verification
or the checksummed runner. Do not paste the SQL into an unguarded SQL editor.

## Implementation

Three authenticated-callable, server-authorized RPCs match the accepted client:

- `sellnova_admin_list_subscriptions(text,text,integer,integer,uuid)`: bounded
  search, effective-plan filtering, pagination, counts, pending request warnings,
  source, revision and expiry. Only current administrators see seller emails.
- `sellnova_admin_subscription_history(uuid,integer,integer)`: bounded history
  including legacy subscription and payment events. New entries have stored
  actor identity/email snapshots, reason and before/after state. Missing legacy
  reasons/snapshots remain unknown; no historical audit rows are rewritten.
- `sellnova_admin_set_subscription(uuid,text,timestamptz,text,text,uuid)`: Paid
  grant/custom expiry or indefinite Free, required reason, expected revision and
  stable operation UUID. No client-supplied actor, amount, duration or status.

Every RPC uses a fixed `pg_catalog` search path and checks the current stored
administrator role. A shared row lock on that role prevents concurrent role
revocation from slipping through during the action. Anonymous execution is
revoked; authenticated non-admins receive a permission error. No new frontend
legacy setter access, broad table writes or service-role browser credentials.

### Revision, concurrency and idempotency

A new opaque UUID revision is stamped by a BEFORE INSERT/UPDATE trigger on
`store_subscriptions`, including same-plan expiry edits by existing trusted
writers. The returned token also includes effective allowance/status, so natural
expiry invalidates a Paid token without rewriting the subscription record.

Manual commands take an operation UUID advisory lock (seed 922), then the shared
per-store publication/checkout advisory lock (seed 921), then the store row and
subscription row. Bank begin/notify/review use the same advisory/store order,
then request/subscription locks. Product creation and selection already use 921.
Absent subscription rows are safe: per-store serialization precedes creation.
The revision trigger never acquires advisory locks. Store rows use NO KEY UPDATE
to permit FK checks, and conditional upserts reject trusted concurrent inserts.

A private `sellnova_dev.subscription_operations` table retains one receipt per
UUID. Reuse with another actor, store, reason, expiry, action or revision fails.
Equivalent expiry instants are normalized to UTC for payload comparison. Current
admin authorization is checked before replay. Valid recovery is checked before
expiry/revision validation, so it works after an expiry or a subsequent change.
Replay returns the original receipt without mutating current state; the accepted
frontend refreshes current state/history afterward.

A successful manual operation updates the entitlement, appends an
`admin_audit_log` event and saves its receipt in the same database transaction.
No exception is swallowed: a failed audit or receipt insert rolls everything
back. New audit snapshots include effective plan/status plus stored plan ID,
status, expiry, start, source and preserved payment provenance. Server identity
and timestamp are authoritative. Suspended subscriptions cannot be cleared by
this RPC. Inactive stores remain inactive.

The pre-execution correction removes the late-trigger lock inversion. Legacy
setter/decision functions are denied even to service_role. Order triggers use
nonblocking advisory acquisition and atomically reject contention with 40001.
See the focused report for the full lock graph and remaining runtime checks.

### Bank transfer coordination and history

Quote/notification ownership, proof validation, immutable amount/duration/bank
snapshots, collection pause and active-Paid guards are retained. Existing open
requests, instructions and audit rows are not backfilled or cancelled by grants.

Approval retains its existing signature and explicit verified-transfer flag.
A locked pending request can activate only once. Approval extends a currently
active finite Paid grant; an expired or Free entitlement starts from current
server time. Indefinite legacy Paid access and suspended subscriptions still
require separate reconciliation. Approval stamps a fresh revision and payment
source and adds richer audit details atomically. A prior manual token becomes
stale if payment approval wins the lock first. If a manual grant wins first,
approval extends the latest expiry. Rejection does not change entitlement.

Manual grants never create payment requests or paid amounts. They clear
`source_request_id`, `paid_amount` and `paid_duration_days` from the current
entitlement projection and reset its start to the manual grant time (NULL for
Free). Old values survive in the before-audit snapshot and original immutable
payment request/approval history. The next actual approval supplies its own
payment provenance normally. No historical payment record is rewritten.

### Free 12 / Paid 50, expiry and restoration

Only Free/Paid plan `max_products` metadata changes (12/50); prices, bank settings
and capability flags stay unchanged. Runtime publication limits and plan-state
classification are replaced through entry 19. Paid 50 is recognized as Paid;
no runtime classification remains dependent on allowance 100. The helper used
for stock/branding checks now evaluates expiry using wall-clock time, including
long-lived pooled sessions.

Expiry falls back to Free entitlements immediately on reads and writes; no cron,
record deletion or status rewrite is required. Free access remains indefinite.
Public catalogs retain the existing deterministic selected-product order, capped
at 12/50. Existing catalog rows, image paths, selected flags, orders, sellers,
store slugs/URLs and saved branding are not rewritten. A legacy catalog above
50 remains saved; creation is blocked while the total saved count reaches the
current limit, but editing and selecting the public subset continue. Renewals
restore previously selected products only up to 50. Products explicitly
unselected by the seller stay unselected.

Existing server RLS/public product filtering, hidden-product checkout enforcement,
order replay and stock accounting remain in effect. No RLS policy is dropped or
expanded. The new operation table has RLS enabled with no client policies, and
its table/helper execution privileges are revoked from PUBLIC, anon,
authenticated and service_role. Only definer-owned routines access it. Existing
owner/admin subscription SELECT policies and admin audit SELECT remain intact.
Final migration assertions reject unexpected client billing/audit writes, legacy
setter grants, anonymous admin RPCs, private access or wrong plan limits.

## Validation results

Passed in this workspace:

- 56 offline tests, including six additional pre-execution review regressions.
  New tests use parsed SQL/AST and deliberate unsafe source mutations, including
  removed authorization, weakened search paths/security, broadened grants,
  missing locks, destructive SQL and subscription-record backfills.
- SQL and PL/pgSQL grammar parsing: 19 manifest files, 406 top-level statements.
  Catalog name/type resolution is not performed by this offline parser.
- Manifest integrity: the exact first 18 entries and their bytes match HEAD;
  checksums match all 19 files. New regression pins the 18-entry fingerprint.
- Original integration execution and real-user rejection guard blocks are
  byte-identical; regressions pin both blocks. The execution/real-user guard blocks stay unchanged; scenario hooks, scoped
  synthetic cleanup and bounded whole-transaction 40001 retries are prepared.
- TypeScript app/node checks, ESLint (0 errors, 14 pre-existing warnings), build
  (existing Browserslist and bundle-size warnings), Python compilation and
  whitespace checks.
- All four browser mock suites: subscriptions, branding, publication and admin
  subscriptions. External browser calls are blocked and Supabase is mocked.
- Default ledger/integration scripts print plan/prepared-only messages without
  connecting. No `--check`, `--run` or `--apply` mode was executed.

Initial validation issues resolved before these results: temporary Python tools
from the previous session were absent and were recreated with pinned packages;
the offline parser cannot resolve a private-schema composite variable, so the
receipt lookup uses a PL/pgSQL `record` instead. No outstanding automated check
failure remains. Neither issue establishes anything about deployed PostgreSQL.

Prepared but **not executed** database scenarios cover non-admin/anonymous denial,
private ledger/direct-write denial, finite expiry validation, stale revisions,
same-ID replay, changed-payload/cross-store rejection, shortened expiry,
downgrades, 50/51 creation boundary, audit identity/reasons, product/payment
preservation, role loss, suspension, real concurrent duplicate/stale commands,
manual/bank races, preserved pending quotes, one-time payment extension and
wall-clock expiry/recovery/renewal. The existing Sprint 4B publication tests now
expect 50/51 rather than 100/101 and retain expiry/restoration checks.

The user reports the 18-entry ledger matches. Remaining verification: real catalog compilation,
function ownership/ACLs/RLS under PostgREST; concurrency and rollback behavior;
actual timed expiry/renewal restoration across pages; preservation/visibility of
legacy catalogs over 50; and native Windows Python 3.14.6 execution. These are
not marked passing based on mocks or SQL source analysis. There is no automated
database-error injection proving audit-failure rollback yet; PostgreSQL runtime
verification of that path is still required in a safe fixture environment.

## Exact Windows verification and execution instructions

Use the reviewed complete workspace file set on `sellnova-v2-development`.
Nothing has been pushed, so an ordinary `git pull` does not retrieve this draft.
Keep these files together: the migration, manifest, accepted frontend and tools.
Use the existing approved Python environment (Windows Python 3.14.6) and existing
pinned requirements. Do not replace TLS verification settings.

### 1. Offline checks, no database connection

```powershell
if ((git branch --show-current).Trim() -ne 'sellnova-v2-development') { throw 'Wrong branch' }
$py = '.\.venv\Scripts\python.exe'
& $py -m unittest discover -s scripts/devdb -p 'test*offline.py' -v
if ($LASTEXITCODE -ne 0) { throw 'Offline tests failed' }
& $py scripts/devdb/check_static.py
if ($LASTEXITCODE -ne 0) { throw 'SQL static validation failed' }
& $py scripts/devdb/migrate.py --plan
if ($LASTEXITCODE -ne 0) { throw 'Manifest integrity failed' }
& .\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.app.json
if ($LASTEXITCODE -ne 0) { throw 'App TypeScript failed' }
& .\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.node.json
if ($LASTEXITCODE -ne 0) { throw 'Node TypeScript failed' }
npm run lint
if ($LASTEXITCODE -ne 0) { throw 'Lint failed' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
npm run test:browser
if ($LASTEXITCODE -ne 0) { throw 'Browser mocks failed' }
$expected = 'bf33cccea4ea7ef73fde4d6eb9ae55ced682be6bc63938b62a00e231dc681bde'
if ((Get-FileHash database/development/corrections/008_admin_subscription_management.sql -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Migration checksum differs' }
```

Build needs the approved development URL and publishable key. Browser tests use
loopback mocks; install the reviewed Playwright browser beforehand if missing.
Checkouts must preserve SQL bytes (LF), including the eighteen historical files.
Do not regenerate manifest checksums to accommodate Windows line-ending changes.

### 2. Independent read-only development ledger verification

Prerequisites: existing securely configured local `DEV_DATABASE_URL` for ONLY
`postgres.qfcnaceeppgrquoszkor@aws-0-eu-west-2.pooler.supabase.com:5432/postgres`,
using the already approved connection setup, and the downloaded trusted
DEVELOPMENT Supabase root certificate. Never paste the URL/password into chat,
source, command arguments or the report. The tool checks the tenant username,
host, database, port, development URL and identity; no URI query overrides.
`sslmode=verify-full` remains mandatory. Clear write/test approvals for this stage.

```powershell
Remove-Item Env:DEVDB_APPROVAL -ErrorAction SilentlyContinue
Remove-Item Env:DEVDB_TEST_APPROVAL -ErrorAction SilentlyContinue
$py = '.\.venv\Scripts\python.exe'
$env:DEV_PROJECT_REF = 'qfcnaceeppgrquoszkor'
$env:VITE_SUPABASE_URL = 'https://qfcnaceeppgrquoszkor.supabase.co'
$env:DEV_DB_CONNECTION_MODE = 'session'
$env:DEV_DB_SSLROOTCERT = 'C:\YOUR_APPROVED_PATH\development-supabase-root.pem'
if (-not $env:DEV_DATABASE_URL) { throw 'Configure the existing approved connection securely outside chat first' }
if (-not (Test-Path $env:DEV_DB_SSLROOTCERT -PathType Leaf)) { throw 'Approved development CA file missing' }
& $py scripts/devdb/check_identity.py --check
if ($LASTEXITCODE -ne 0) { throw 'Development identity/TLS verification failed' }
& $py scripts/devdb/verify_history.py --check --expected-count 18 --output work/development-history-before-19.json
if ($LASTEXITCODE -ne 0) { throw 'Ledger mismatch: stop; do not apply or adopt migrations' }
```

Both diagnostics enforce and verify `SET TRANSACTION READ ONLY` in the actual
transactions before identity/ledger SELECTs; startup defaults are not trusted.
Expected ledger: exactly the reviewed 18 entries, correct project and hashes,
no extras, duplicates or missing entries. Matching tied timestamps is not used
to invent chronology. Save the report and stop for review/execution approval.
This read is not authorization to execute the next block.

### 3. Future application — ONLY after separate explicit approval

NOT AUTHORIZED NOW. After approval, repeat step 2 immediately before applying.
Use the same reviewed files/certificate/connection, check branch and SQL hash
again, and ensure no other migration/privileged subscription job is running.
The existing migration runner/approval gates are not changed by this work.

```powershell
if ((git branch --show-current).Trim() -ne 'sellnova-v2-development') { throw 'Wrong branch' }
$expected = 'bf33cccea4ea7ef73fde4d6eb9ae55ced682be6bc63938b62a00e231dc681bde'
if ((Get-FileHash database/development/corrections/008_admin_subscription_management.sql -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Unreviewed SQL bytes' }
& $py scripts/devdb/verify_history.py --check --expected-count 18 --output work/development-history-before-19.json
if ($LASTEXITCODE -ne 0) { throw 'History prerequisite failed' }
$env:DEVDB_APPROVAL = 'APPLY-qfcnaceeppgrquoszkor'
try {
    & $py scripts/devdb/migrate.py --apply
    if ($LASTEXITCODE -ne 0) { throw 'Migration failed; inspect without resetting or changing checksums' }
} finally {
    Remove-Item Env:DEVDB_APPROVAL -ErrorAction SilentlyContinue
}
& $py scripts/devdb/verify_history.py --check --expected-count 19 --output work/development-history-after-19.json
if ($LASTEXITCODE -ne 0) { throw 'Post-application ledger verification failed' }
```

Do not run `integration.py --run` against the populated development project:
its existing guard rejects real users and must remain intact. The prepared
integration module has no standalone execution path. Runtime testing needs a
separately approved synthetic-only environment strategy or a separately reviewed
scoped fixture approach; changing target routing or weakening the guard is not
authorized here. No seed/reset/production/deployment commands are provided.

## Preservation, rollout and rollback

Before a future approved application, confirm an appropriate development backup
and capture the independent ledger report. Apply only with the reviewed runner.
Do not delete/recreate users, stores or products to make tests pass. If runtime
verification fails, withhold frontend release and leave records intact.

Migration execution is transactional: any DDL/assertion failure rolls it back.
After a committed migration, rollback must be a separately reviewed append-only
forward correction. Keep operation receipts and audit history so old retries
cannot reactivate access. Do not delete ledger entry 19, edit prior checksums,
drop receipts, rewrite payment history or blindly restore an old database over
new records. Reverting a frontend release does not undo subscription decisions.
A rollback should first remove new mutation EXECUTE access (through an approved
correction) if needed, then reconcile exact audited entitlements. Raising a cap
back to 100 would itself need business/security approval. No destructive rollback
SQL has been prepared or executed.

## Changed files

New/modified in this backend preparation (8 files):

- NEW `database/development/corrections/008_admin_subscription_management.sql`
- MODIFIED `database/development/manifest.json` (append entry 19 only)
- NEW `scripts/devdb/admin_subscription_integration.py`
- NEW `scripts/devdb/test_admin_subscription_offline.py`
- MODIFIED `scripts/devdb/integration.py` (scenario hook/scoped synthetic cleanup; guards unchanged)
- MODIFIED `scripts/devdb/publication_integration.py` (50/51 expectations)
- MODIFIED `scripts/devdb/test_offline.py` (expected manifest length 19)
- NEW `docs/SPRINT_4C_BACKEND_REVIEW.md`

Accepted baseline retained (16 files, unchanged in this backend stage):

- `package.json`
- `src/App.tsx`
- `src/components/PublicationControls.tsx`
- `src/integrations/supabase/types.ts`
- `src/pages/admin/AdminDashboard.tsx`
- `src/pages/admin/Subscriptions.tsx`
- `scripts/browser/publication.mjs`
- `scripts/browser/subscriptions.mjs`
- `src/lib/adminSubscriptions.ts`
- `src/pages/admin/SellerSubscriptions.tsx`
- `src/components/admin/ManualSubscriptionDialog.tsx`
- `src/components/admin/SubscriptionHistory.tsx`
- `scripts/browser/admin-subscriptions.mjs`
- `scripts/devdb/verify_history.py`
- `scripts/devdb/test_history_offline.py`
- `docs/SPRINT_4C_PHASE2_REVIEW.md`

The original 24-file baseline was committed/pushed as `28030b9`. Corrections
listed in `SPRINT_4C_PRE_EXECUTION_REVIEW.md` remain uncommitted/unpushed. Original
checkout, main, production and live records remain untouched. Re-review the new
SHA before any transfer or execution authorization.

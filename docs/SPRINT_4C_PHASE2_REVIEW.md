# Sprint 4C Phase 2 — Frontend implementation and blocked backend

Prepared 2026-11-04 on an isolated `sellnova-v2-development` worktree at
`/workspace/work/sellnova-4c`, based on `d72a59132fb1163908264f180ffbdfd08f79e11f`.
The supplied `/workspace/tfsales` checkout is an older `work` branch and remains
untouched. No new commit, push, migration execution, deployment, live SQL query,
subscription modification, database deletion or reset was performed.

## Scope and blocker

The user requires independent deployed-history verification **before preparing
migration 19**. Environment inspection found no `DEV_DATABASE_URL`, database
secret binding or outbound TCP grant. Only the development frontend URL and
publishable key are configured. That key does not authorize the private migration
ledger. The user then explicitly selected **leave migration 19 blocked for now**.

Accordingly, no migration 19 SQL, checksum, manifest entry, backend RPC, revision
trigger or database permission change has been created. This is not a completed
server implementation. The existing source backend still implements Paid 100.
The frontend and test contracts below target the approved Free 12 / Paid 50
behavior, and the new admin page rejects incompatible 100-product responses.
Do not deploy this candidate before the backend is completed and approved.

All eighteen existing migration files, hashes and manifest ordering are unchanged.
The integration-test guard is byte-for-byte unchanged. No service-role key or
privileged credential is introduced into frontend code.

## Implemented frontend

New protected route: `/admin/subscriptions/manage`, linked from the existing
payment page and individual Admin Dashboard seller rows. It lists/searches all
sellers independently of analytics date filters, with pagination, effective plan,
expiry, source, saved/public counts, allowance and pending-payment warning.

The custom Paid grant/edit dialog uses an explicit WAT (UTC+01:00) date/time,
validates real calendar dates and future instants, requires a reason and sends
an expected subscription revision. Shortening Paid access and downgrading require
explicit acknowledgement. Free is shown as indefinite. Over-limit catalogs are
preserved and the preview explains their public limit. Suspended subscriptions
cannot be changed by this UI; inactive stores are not automatically reactivated.

Every manual command gets one operation UUID, persisted in admin-scoped tab
session storage before transmission. Uncertain HTTP/network/response outcomes
lock the original payload and retain that same command across reloads. Recovery
retries the original operation and revision; it does not construct a new grant.
After confirmation the UI reloads current state instead of replacing it with a
possibly old replay response. This prevents the frontend from rewinding newer
state. Server idempotency/concurrency remains a required backend contract, not a
property proven by these mocks.

The history panel shows administrator identity/UUID, WAT timestamp, reason,
action, source and before/after plan/expiry. Missing legacy identity or reason is
labelled unknown/not recorded. It uses a separate admin-only RPC contract, rather
than broadening profile SELECT privileges or exposing administrator data to
sellers. Existing bank settings and payment review remain independent and their
current route continues to work when the new management backend is unavailable.

There is no direct table INSERT/UPDATE from the new admin code and no call to the
legacy subscription setter. A missing RPC or incompatible response produces an
error, never a fallback to direct writes. Client validation is only UX; the
pending server implementation must perform all authorization and validation.

## Typed API contract (not database implementation)

Three future RPCs are declared in frontend types:

- `sellnova_admin_list_subscriptions`: search, effective-plan filter, optional
  exact store ID, offset/limit; returns `schema_version: 1`, total and rows.
- `sellnova_admin_subscription_history`: store ID and pagination; returns only
  authorized normalized subscription/payment events and actor labels.
- `sellnova_admin_set_subscription`: store ID, `paid|free`, exact UTC expiry or
  NULL for Free, reason, expected revision and operation UUID; returns the same
  UUID, replay flag and verified entitlement row.

Rows must distinguish `plan` from `allowance`: Paid explicitly maps to 50, Free
to 12. The client refuses numeric/plan inconsistencies, invalid timestamps and
impossible publication counts. Saved/selected counts may exceed the current cap
because catalogs and temporarily suppressed selections must be preserved.

Pending backend work, only after independent deployed-history verification:

1. Prepare append-only entry 19, normally `008_admin_subscription_management.sql`,
   without editing entries 1–18. Generate its checksum only from the reviewed SQL.
2. Add subscription revision/source tracking covering every allowed writer,
   including existing bank approval. Do not reuse the publication-content token
   as the subscription revision: same-plan expiry changes can leave that token
   unchanged.
3. Implement a narrowly authorized admin RPC with current stored admin-role
   checks, finite future expiry, required reason, exact revision matching,
   consistent locks and operation-id idempotency. Replays must be checked before
   applying again, and must not overwrite subsequent changes.
4. Atomically append audit records using server actor/time, identity snapshot,
   reason, before/after values and operation identity. No fake payment request or
   payment approval is created for a manual grant.
5. Preserve the source payment link/amount/duration as historical provenance;
   distinguish the latest manual change with separate source metadata. Existing
   pending requests, proof objects and audit records must not be rewritten.
6. Change Paid plan metadata, server publication limit and Paid detection from
   100 to 50. Current historical `007_product_publication.sql` contains both a
   hardcoded 100 and `allowance=100` Paid classification; replace their runtime
   definitions via migration 19, never edit the historical file. Update prepared
   database integration expectations from 100/101 to 50/51 when the backend is
   prepared. Preserve catalogs over 50 and apply deterministic effective limits.
7. Keep direct authenticated billing-table writes and legacy setter execution
   revoked. No service-role key in the browser. Admin history/list RPCs must not
   grant public reads of other users' profiles or private notes.

The old bank workflow, RLS/publication protections and automatic expiry remain
unchanged in source in this frontend-only phase. Sprint 4B live expiry and
renewal restoration are still unverified. Approving a future implementation or
history read does not authorize applying SQL, changing live subscriptions,
committing, pushing or deploying.

## Read-only ledger verification tool

`scripts/devdb/verify_history.py` defaults to offline help. `--check` uses existing
pinned development target/TLS/identity guards, then starts a separate explicit
read-only transaction. It verifies `SHOW transaction_read_only` before reading
only `(path,sha256,project_ref)` from `sellnova_dev.migration_history`.

The result must match the exact reviewed prefix (eighteen by default), with no
missing/extra/duplicate/foreign-project rows. It does not infer ordering from
transaction timestamps that may tie. Local manifest integrity is checked first.
Successful output contains a UTC check timestamp, prefix fingerprint and the
matching ledger entries; no credentials or connection strings. Driver errors
print only their exception class. A JSON report can be written under `work/`.
No startup read-only option is relied on, and there is no migration/write action.

Only the default no-connection invocation was run here. The deployed ledger
has NOT been independently verified. Its checks cannot be substituted with the
local manifest or a mocked connection.

## Validation results

Successful local checks:

- 40 offline tests: baseline integrity/routing/TLS/Windows tests plus five history
  diagnostic regressions for no-connect defaults, exact records, enforced
  read-only ordering/failure and secret-safe output.
- Existing SQL/PLpgSQL validation: 18 unchanged manifest files, 374 statements.
  This says nothing about a future migration 19: none exists.
- TypeScript app and node projects, Python compilation, diff/whitespace checks.
- ESLint: zero errors; fourteen existing warnings.
- Production-mode build against the injected development configuration; existing
  bundle-size and outdated Browserslist warnings remain. No deployment.
- Four browser mock suites: existing subscriptions, branding and publication,
  plus the new admin-management suite. The older UI mocks now target Paid 50;
  this is NOT evidence that the unchanged server's current 100 limit changed.
- New mocks cover WAT midnight conversion/invalid dates, grant/expiry editing,
  shortening and downgrade confirmations, 75 saved records retained, Paid 50
  classification, identity/reason history, untouched pending payments, stale
  revision rejection, response-loss recovery across reload, the same operation
  ID on retry, current-state refresh after a newer change, incompatible backend
  rejection, unauthorized route/RPC denial and the unchanged payment page.
  All Supabase responses are intercepted and external browser requests blocked.

No outstanding automated check failure remains. An initial TypeScript optional-
property mismatch was corrected before the successful runs. Expected mocked
negative responses (403, stale 400 and uncertain 503) are regression cases, not
live errors or deployment results.

Blocked/unverified, separately from those passing checks:

- Independent live ledger read and migration 19 preparation/checksum.
- Actual server RPCs, revision/idempotency enforcement, persistent new audit
  events and the database-wide Paid 50 transition.
- Live authorization/RLS/concurrency, Sprint 4B automatic expiry/renewal, real
  payment coexistence and native Windows execution. Browser mocks prove only
  client behavior against the proposed API contract.

The full integration safety guard remains untouched and still rejects databases
with real non-synthetic Auth users. Never remove users or weaken that guard to
make tests pass. Future live tests need a separately reviewed safe fixture scope.

## Exact next development-only verification commands

From this development worktree on Linux:

```sh
/tmp/sellnova-4c-tools/bin/python -m unittest discover -s scripts/devdb -p 'test*offline.py' -v
/tmp/sellnova-4c-tools/bin/python scripts/devdb/check_static.py
/tmp/sellnova-4c-tools/bin/python scripts/devdb/verify_history.py
./node_modules/.bin/tsc --noEmit -p tsconfig.app.json
./node_modules/.bin/tsc --noEmit -p tsconfig.node.json
npm run lint
npm run build
PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium npm run test:browser
```

Windows equivalents, using the approved Python tools environment:

```powershell
$py = '.\.venv\Scripts\python.exe'
& $py -m unittest discover -s scripts/devdb -p 'test*offline.py' -v
& $py scripts/devdb/check_static.py
& $py scripts/devdb/verify_history.py
& .\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.app.json
& .\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.node.json
npm run lint
npm run build
# If needed: npm ci; npx playwright install chromium
npm run test:browser
```

Build requires the approved injected development URL/publishable key. Mocks set
their own loopback configuration and need no actual database credentials.

**Only after the user reopens the blocked verification stage**, securely configure
the existing approved development connection (`DEV_DATABASE_URL` outside chat)
and supported network access, then run this read-only Windows verification:

```powershell
$env:DEV_PROJECT_REF = 'qfcnaceeppgrquoszkor'
$env:VITE_SUPABASE_URL = 'https://qfcnaceeppgrquoszkor.supabase.co'
$env:DEV_DB_CONNECTION_MODE = 'session'
$env:DEV_DB_SSLROOTCERT = 'C:\YOUR_APPROVED_PATH\development-supabase-root.pem'
& $py scripts/devdb/verify_history.py --check --expected-count 18 --output work/development-history.json
if ($LASTEXITCODE -ne 0) { throw 'History was not verified. Stop before migration preparation.' }
```

Do not paste connection strings, print environment values, disable TLS, substitute
another project, or assume HTTP allowlisting grants TCP 5432. A successful ledger
read enables review of the next migration preparation; it does not authorize SQL
application. No apply, commit, push or deployment command is supplied here.

## Exact changed-file list

Modified:
- `package.json`
- `src/App.tsx`
- `src/components/PublicationControls.tsx`
- `src/integrations/supabase/types.ts`
- `src/pages/admin/AdminDashboard.tsx`
- `src/pages/admin/Subscriptions.tsx`
- `scripts/browser/publication.mjs`
- `scripts/browser/subscriptions.mjs`

New:
- `src/lib/adminSubscriptions.ts`
- `src/pages/admin/SellerSubscriptions.tsx`
- `src/components/admin/ManualSubscriptionDialog.tsx`
- `src/components/admin/SubscriptionHistory.tsx`
- `scripts/browser/admin-subscriptions.mjs`
- `scripts/devdb/verify_history.py`
- `scripts/devdb/test_history_offline.py`
- `docs/SPRINT_4C_PHASE2_REVIEW.md`

Everything is uncommitted and unpushed for review. There is no migration 19 or
checksum to approve in this phase. The original checkout and main are untouched.

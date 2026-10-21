# Sprint 4A — Manual subscription billing

Prepared 2026-10-21 for `sellnova-v2-development` and development project
`sellnova-v2-dev` (`qfcnaceeppgrquoszkor`). No database connections, remote SQL,
seeds, resets, production operations, merges to main or deployments performed.

## Implemented behavior

Every store without a currently active, unexpired Paid entitlement uses Free
through the existing SQL and TypeScript effective-plan helpers. No trial or
subscription record is needed to receive Free, and the Free plan's legacy
`duration_days` metadata does not impose an expiry. Free continues indefinitely.
The existing product creation limit remains 12 for Free and 100 for Paid.
Products are never deleted on expiry. Paid feature checks already fall back to
Free at read time when `expires_at` has passed; a scheduler is not needed for
that entitlement decision.

`/admin/subscriptions`, linked from the admin dashboard, manages the fee,
duration, provider, account name/number, instructions and collection activation.
The unconfigured development Paid price becomes NGN 1,500 / 30 days; deliberately
configured nonzero prices are retained. Existing banking details are preserved,
and no actual banking information is seeded. Collection starts disabled.
Administrators must enter approved development payment details and enable it.
OPay is a provider example, not a hardcoded real account. Fee validation accepts
NGN 1–1,000,000 with two decimal places, and duration accepts 1–365 days.
Enabling collection requires a provider, account name and ten-digit number.
Settings updates use an optimistic version check and atomically audit the
previous/new configuration, fee and duration.

A seller saves a payment quote **before transferring**. The database takes the
current fee, duration, bank details, instructions and settings version and saves
them in an owner-readable request with status `draft`. No client amount is
accepted. The seller then transfers using these saved instructions, supplies a
reference, optionally uploads a private JPG/PNG/PDF proof up to 5MB and selects
“I Have Made Payment.” The request becomes `pending`; no entitlement changes.
Unused drafts can be cancelled. Existing quotes can still be notified when
collection is subsequently paused, because the seller may already have paid.
New quotes are blocked while collection is paused. A store can have only one
open new quote/request; existing legacy open requests also block new quotes.

Admin review is paginated (25 rows) with pending/approved/rejected/draft filters,
amount/reference, saved instructions, private proof links and decision notes.
Approval requires a checked bank-transfer verification acknowledgement. This is
manual verification, not an automated banking integration. The RPC checks admin
status and the acknowledgement, locks the store and request, rejects decisions
on anything other than pending, and activates exactly the captured duration.
Rejection requires a reason and never removes existing Paid access. A repeated
approval fails instead of extending again. New non-draft transfer references
are unique case-insensitively after trimming, including previously rejected
references. Refunds or correction of an erroneously rejected genuine reference
require a separately designed reconciliation process; do not bypass that check.

Renewals are available while Paid is active. Approval appends the captured
period after the current finite expiry, or starts at approval time if expired
or Free. Settings changes do not modify saved requests or approved entitlements.
Each request retains its price/instructions and actual activation interval;
`store_subscriptions` records the latest source request, paid fee and duration.
Payment and administrative audit histories remain available.

## Migration and data preservation

Apply only after separate database execution review/approval:

16. `database/development/corrections/005_subscription_payments.sql`

It follows all fifteen existing applied entries, including correction 004.
The manifest contains its SHA-256 checksum. Original fifteen SQL files and
ordered manifest entries/checksums were checked byte-for-byte against HEAD and
are unchanged; an offline test pins that complete prefix. The runner, TLS
verification, database routing and execution approval gates are unchanged.

The migration adds settings version/activation, request snapshot/activation
columns, entitlement source/price/duration fields, two partial unique indexes
and five narrow RPCs. It replaces the notification path by dropping the two old
request-validation/after-insert triggers (their private functions are not
exposed). No pending notification now changes subscription state. Existing
users, Auth records, stores, products, orders, subscription rows, requests and
migration history are retained. It makes only the explicit plan pricing/limit
configuration updates described above; it performs no user/product cleanup.

Legacy requests have no invented snapshots. Their amounts/history remain intact.
Admins can reject legacy pending requests but cannot approve them through the
new RPC. Reconcile any money already transferred before asking for a new quote;
do not tell a seller to pay twice. Existing active subscriptions with no expiry
are also preserved and block normal paid renewal approval until a separately
reviewed policy reconciles them. Suspended subscriptions require separate
resolution before payment approval. Neither case is silently overwritten.

## Security and RLS review

- Existing request SELECT RLS restricts rows to store owner/admin. Settings remain
  readable to signed-in sellers for payment purposes. Audit SELECT remains
  admin-only. Anonymous clients receive no new billing privileges.
- Authenticated direct INSERT/UPDATE/DELETE on plans, settings, requests and
  subscriptions are revoked, including the old request column-level INSERT
  grants. Thus changing an HTTP payload cannot forge an amount, snapshot,
  reviewed status, expiry or entitlement. RLS stays enabled and unchanged.
- The old `sellnova_decide_subscription` and `sellnova_set_subscription_state`
  entry points lose authenticated/PUBLIC/anonymous EXECUTE, preventing an
  alternative client activation path. They remain private to trusted DB/server
  administration, not ordinary frontend users. No service-role key is introduced.
- All five new functions are SECURITY DEFINER with `search_path=pg_catalog`,
  qualified application objects, PUBLIC/anon EXECUTE revoked and explicit
  authenticated EXECUTE. They enforce owner or administrator authorization
  internally. Settings/version locks, store/request row locks and unique indexes
  handle competing edits, duplicate quotes/references and repeated decisions.
  The migration also asserts effective mutation/function ACLs before committing.
- Proof paths must belong to the authenticated uploader and exist in the private
  payment-proofs bucket. Existing storage policies limit uploads to own folders
  and reads to owner/admin; no client overwrite/delete permission is added.
  Admin proof URLs expire after 60 seconds. UI MIME/size limits match bucket
  metadata. A failed notification after a successful storage upload can leave
  an unattached private proof; reviewed retention/cleanup is future work.
- Trusted database owners/service roles remain privileged. Client RLS cannot
  protect against a compromised privileged server credential. None is used in
  the frontend or browser mocks.

## Validation and reproducible commands

Executed successfully on Linux:

- 30 offline safety tests, including the immutable fifteen-entry prefix and
  existing no-connection, TLS, identity, approval-gate and secret-safe tests.
- SQL/PLpgSQL static validation: 16 manifest files, 349 statements. This validates
  syntax and checksums, not live Supabase object resolution or RLS behavior.
- TypeScript app and node projects, Python compilation and diff checks.
- ESLint: zero errors, 14 pre-existing warnings.
- Lockfile repair adds missing entries for already-declared Drizzle/Postgres
  tooling and the new Playwright test dependency; previously locked package
  versions are unchanged.
- Production-mode build against injected **development** configuration. Existing
  bundle-size and outdated Browserslist-data warnings remain; no deployment.
- Isolated Chromium browser mocks: Free/Paid caps, saved instructions surviving
  a price change, private proof upload, pending state without activation, active
  renewal UI, expired Paid falling back to Free, settings save/stale-version
  error, explicit admin verification, duplicate action disappearance, rejection,
  paused collection, server error feedback and unauthorized admin redirect.
  All API traffic is intercepted; external browser requests are blocked.

The prepared synthetic database integration scenario covers settings bounds and
admin ACLs, stale settings, blocked direct/forged writes, cross-seller request
privacy, immutable quote fee/duration/instructions, proof ownership, pending
nonactivation, verification requirement, duplicate notifications/references/
approvals, precise renewal extension, rejection preserving expiry and audit
entries. It rolls back its scenario. It is **not executed remotely** in this
sprint; semantic database verification remains a prerequisite after approval.
The full harness still refuses projects with real non-synthetic Auth users.
Never reset the current browser-testing database to make that harness run.

Windows, from the repository root with the existing tools environment:

```powershell
$py = '.\.venv-devdb\Scripts\python.exe'
& $py scripts/devdb/test_offline.py
& $py scripts/devdb/check_static.py
& $py scripts/devdb/migrate.py --plan
& .\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.app.json
& .\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.node.json
npm run lint
# Requires existing injected development URL and publishable key, never service role:
npm run build
# Install the locked browser-test dependency, then Chromium if not present:
npm ci
npx playwright install chromium
npm run test:browser
```

On Linux the test can use `PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium` rather than
install a Playwright-managed browser. It starts/stops its own loopback Vite
server on port 4174, injects exact loopback mock API configuration and needs no
credentials. Runtime sandbox permission for a local listener may be necessary.
Native Windows execution was not available here.

No apply command was run. For future separately approved application, use the
existing guarded runner and approved Session Pooler/CA configuration from the
Sprint 3C runbook. Confirm `--plan` lists all 16 entries and the original 15-entry
history is intact. Only then set `DEVDB_APPROVAL=APPLY-qfcnaceeppgrquoszkor` for
`migrate.py --apply`, and remove the approval variable afterward. Do not paste
credentials or change any historical checksum. The runner skips the original
fifteen, applies only entry 16, records history and reruns existing postflight
assertions in one transaction. Review Supabase RPC/schema-cache readiness before
browser testing, then configure approved non-production payment details and
enable collection. Coordinate the new frontend with the migration: the old
seller page's direct request INSERT is intentionally no longer allowed.

## Sprint 4B dependencies and limits

The captured fee/duration, activation intervals and source-request linkage are
ready for renewal/payment history. Effective Paid expiry and indefinite Free
already work without data deletion. No automatic product deletion is introduced.

Sprint 4B must add owner-controlled publication selection, a server-enforced cap
of 12 public products for Free/100 for Paid, concurrency-safe publication writes,
and consistent storefront/search/checkout filtering after expiry. Existing
product creation limits cap **stored product count**, not publication selection;
currently a store downgraded from Paid retains and can still display more than
12 existing products. This sprint deliberately preserves that existing behavior
rather than hiding/deleting arbitrary products. Publication enforcement after
expiry is therefore not claimed complete in 4A. A public-selection model must
be reviewed/migrated before promising the full 4B behavior to sellers.

Also pending: approved live migration and RLS/concurrency tests, Windows browser
verification, real account configuration by an admin, legacy payment/indefinite
subscription reconciliation, proof retention/cleanup, and a policy for unused
quote expiry/refunds. No actual OPay API, bank verification service or notification
email delivery is integrated; notifications appear in the admin pending queue.

Rollback is forward-only: disable collection through the audited admin control,
then prepare a new checksummed correction if needed. Do not edit/delete history,
drop snapshot/history columns, reset the database, or silently restore the
unsafe direct-write/old activation paths. A failed apply transaction rolls back
its DDL and history row atomically.

## Exact changed-file list

- `database/development/corrections/005_subscription_payments.sql`
- `database/development/manifest.json`
- `src/App.tsx`
- `src/integrations/supabase/types.ts`
- `src/lib/billing.ts`
- `src/pages/admin/AdminDashboard.tsx`
- `src/pages/admin/Subscriptions.tsx`
- `src/pages/seller/Subscription.tsx`
- `scripts/devdb/billing_integration.py`
- `scripts/devdb/integration.py`
- `scripts/devdb/test_offline.py`
- `scripts/browser/subscriptions.mjs`
- `package.json`
- `package-lock.json`
- `docs/SPRINT_4A_SUBSCRIPTIONS.md`
- `docs/SPRINT_2A_DATABASE_PREPARATION.md`

The pre-existing untracked `docs/SPRINT_2_SUPABASE_VERIFICATION.md` is untouched
and excluded from the commit.

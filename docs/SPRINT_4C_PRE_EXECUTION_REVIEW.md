# Sprint 4C pre-execution review — revised, unapplied candidate

Branch: `sellnova-v2-development`; workspace: `/workspace/work/sellnova-4c`.
Baseline commit on GitHub: `28030b9bd2bd3f91eb2988b13ed693ce6c3af221`.
The corrections in this review are not committed or pushed. Migration 19 remains
unapplied. No database connection, SQL execution, destructive integration run,
deployment or production access was performed during this review.

The user reports independent Windows verification of all 18 deployed ledger
entries and the previous migration 19 checksum. That verification of entries
1–18 remains applicable because their bytes, hashes and ordering are unchanged.
**The previously checked migration 19 checksum does not approve this revised SQL.**
Do not apply the migration file currently on GitHub as though it includes these
corrections. Review the revised candidate and explicitly authorize its transfer
and any subsequent execution separately.

## Checksum change

File: `database/development/corrections/008_admin_subscription_management.sql`.

- Previous: `bfedfd42aa9316675c3a55d8a1a0f5f18a09a9cfa84c980dcadfe1a280e9e662`
- Revised: `bf33cccea4ea7ef73fde4d6eb9ae55ced682be6bc63938b62a00e231dc681bde`

Only manifest entry 19's checksum changes. No historical SQL, manifest prefix,
checksums, seed data or migration runner approval gates were changed.

## Findings and corrections

### 1. Late advisory lock in revision trigger — corrected

An UPDATE locks its subscription tuple before invoking a BEFORE ROW trigger.
The original revision trigger then waited for advisory 921. A manual RPC could
already own 921 and wait for that tuple: a genuine two-session deadlock cycle.

The revision trigger now only checks immutable store identity and stamps a UUID;
it never takes an advisory lock. Supported RPCs still take their locks up front.
A new conditional upsert predicate compares the actual stored UUID for both
manual grants and payment approvals. If an absent row is concurrently inserted
by a trusted writer, the upsert fails without overwriting it or appending a
success audit/receipt. Existing-row updates are protected by the locked revision.

### 2. Strong store lock versus foreign-key checks — corrected

`FOR UPDATE` on a store conflicts with the `KEY SHARE` lock PostgreSQL takes
while inserting a subscription referring to that store. An RPC holding the store
could wait for a competing subscription insert while that insert waited for its
parent store, independently of the trigger inversion.

All four subscription entry points now serialize using `FOR NO KEY UPDATE` on
the store. It still conflicts with competing management/store updates and delete,
but permits FK `KEY SHARE`. These RPCs do not modify store identity/key columns.
The conditional upsert then safely detects the trusted-insert race.

### 3. Late order-trigger lock — corrected

The existing order UPDATE trigger already owns an order row before it waits on
921. Together with checkout holding 921 while waiting on a store being deleted,
and the deletion cascading into that order row, this can form another cycle.

The proposed replacement changes only the two advisory calls (confirmation and
stock-restoring cancellation) to `pg_try_advisory_xact_lock`. Contention raises
SQLSTATE `40001` immediately, rolling back the entire attempt; it does not wait
while holding the order row. Stock deductions/restoration, allowed transitions,
immutable fields, order audit and receipt logic are otherwise byte-equivalent
to the current historical function. A regression compares the full function
body against the historical body with only these two explicit substitutions.

The prepared synthetic harness retries a complete failed confirmation transaction
only for `40001`, at most three times. All original last-unit/one-audit assertions
remain. The application does not automatically retry; a seller can retry after
the displayed error. This new contention response needs real browser/database
verification before rollout.

### 4. Deprecated subscription writers — retired explicitly

`authenticated` was already denied legacy setter/decision execution, but
`service_role` retained grants and the old writer bodies remained active. They
had incompatible lock order and could approve without the verified-transfer
contract or bypass the new revision/idempotency/audit interface.

Both legacy functions retain their exact signatures/defaults for dependency
compatibility, now raise `42501` without reading or modifying records, and have
execution revoked from service_role as well as PUBLIC/anon/authenticated.
The detached `sellnova_request_after_insert` trigger function is not attached:
migration 16 dropped that trigger and the legacy request-validation trigger.
A trigger-returning function cannot be invoked as a normal mutation RPC. No
frontend call to either retired writer exists. Any untracked external privileged
integration using them must be reconciled before execution approval.

### 5. Stale payment provenance on manual grants/downgrades — corrected

The original candidate left `source_request_id`, `paid_amount` and
`paid_duration_days` on the current subscription after a manual override. Merely
adding `latest_source='admin'` did not protect existing readers of those columns
from attributing the old receipt/amount to the new entitlement.

A manual override now clears those three *current projection* fields, starts
Paid at the actual manual grant time (Free has no start or expiry), and records
`latest_source='admin'`. Its before-audit snapshot retains the previous values.
Original payment request rows, approval audit, snapshots, proofs, amounts and
activation periods are never rewritten. A later real verified approval supplies
its own request/amount/duration and payment source. Manual grants create no
payment transaction. Prepared regressions check both Paid and Free overrides
after an actual synthetic bank approval and compare the payment row byte-for-byte.

### 6. Expiry consistency and public helper access — corrected

Multiple wall-clock checks within a single response could disagree at expiry,
returning a Paid allowance with an expired status or mismatched visible count.
A private `publication_limit_at(uuid,timestamptz)` now supports one captured
instant for publication/admin state responses; visible IDs use that same limit.
The normal enforcement wrapper still supplies current wall-clock time on every
call. Expiry automatically yields Free 12 without changing saved products or
selected flags; a renewed Paid entitlement restores up to 50 selected products.

The old candidate also redirected the anonymously callable maximum-products
helper to an unfiltered limit helper. That could expose Paid status for an
inactive store. It again uses the original visibility-aware effective-plan
helper, with wall-clock expiry and the new 12/50 plan metadata.

Finite custom expiries are additionally bounded below year 10000 so RPC results
remain compatible with the accepted four-digit ISO timestamp frontend schema.
Indefinite legacy NULL expiry remains readable, while new manual grants must
have a future finite expiry. New bank approvals reject non-finite amounts and
price/duration mismatches with the immutable quote snapshot.

## Lock inventory after correction

Stored administrator authorization precedes manual/review operations. Its role
row uses `FOR SHARE NOWAIT`, so role maintenance cannot make the RPC wait while
holding a conflicting role lock. UUID operation lock 922 is manual-only.

| Path | Lock order / waiting behavior |
|---|---|
| Manual change | Role SHARE NOWAIT → operation 922 → store 921 → store NO KEY UPDATE → subscription UPDATE → plan FK KEY SHARE → append audit/receipt |
| Payment approval/rejection | Role SHARE NOWAIT → store 921 → store NO KEY UPDATE → request UPDATE → subscription UPDATE on approval → plan FK KEY SHARE → audit |
| Payment notification | Store 921 → owned store NO KEY UPDATE → request UPDATE; no subscription mutation |
| Begin quote | Store 921 → owned store NO KEY UPDATE → settings SHARE → Paid plan SHARE; inserts only a quote |
| Cancel draft | Request UPDATE only; unchanged store/plan FK keys, no subscription/921 wait |
| Payment settings | Settings UPDATE → plan UPDATE; no store/request/subscription lock |
| Publication selection | Store 921 → product updates; unchanged existing authorization/version checks |
| Product insertion | BEFORE INSERT acquires store 921 before count/FK checks; no existing product tuple lock |
| Product content update | Product tuple → existing validation/read-only entitlement checks; no later subscription/advisory lock |
| Checkout | Store 921 → active store SHARE → ordered products → ordered promotions → new order/items |
| Order confirm/cancel | Order tuple → **try** 921; busy attempt aborts instead of waiting; then ordered products/items |
| Revision trigger | Subscription tuple → UUID stamp only; no new waiting lock |
| Legacy setter/decision | Denied; no mutation or waiting locks |
| Trusted direct subscription DML | Row/FK locks only; revision trigger adds no advisory wait; concurrent RPC insert conflicts fail closed |

This removes the identified subscription/FK/advisory inversions. It does not
claim that arbitrary privileged multi-table SQL can never deadlock. Future
multi-store maintenance must use deterministic store/key order and retry whole
transactions when appropriate. Existing lock/statement timeouts remain unchanged.
No production or live maintenance command was executed to test this graph.

## PostgreSQL compatibility and access review

Offline AST regression reconstructs the last definitions from entries 1–18 and
compares every replaced function's parameter names/types/modes/defaults, return
type and set-returning flag. No incompatible signature/overload replacement was
found. New helpers precede their callers; the revision columns precede the new
trigger. Public composite row types refer to existing tables; private ledger
lookup uses `record`, avoiding the offline parser's namespace limitation.

The SQL uses existing Supabase PostgreSQL facilities: UUID generation in
pg_catalog, advisory lock functions, JSONB, MATERIALIZED CTEs, ON CONFLICT,
row locks and trigger functions. The target must be a supported Supabase
PostgreSQL version (15+ recommended). Actual server version/catalog compilation
has not been queried in this environment. Offline SQL/PLpgSQL grammar parsing
cannot prove managed schema ownership, installed types, ACL inheritance or
PostgREST behavior.

All three admin RPCs retain server role authorization, fixed search paths and
bounded inputs. RLS policies remain unchanged. Owner/admin subscription SELECT,
seller product management and anonymous public filtering remain. The private
new helper and operation ledger are denied to all client roles, including
service_role; only definer-owned routines use them. Trigger invocation remains
attached to the original table function identity. Retired legacy ACLs are also
asserted at migration end. No service key, bank details or credentials were added.

## Validation and remaining risks

Completed checks: 56 offline tests, grammar parsing of 19 files/406 statements,
manifest integrity and unchanged 18 historical SQL files, Python compilation,
diff checks, app/node TypeScript, lint, build and all four browser mock suites.
Lint has 14 existing warnings; build retains existing Browserslist/bundle warnings.
A new signature test initially reused a stateful SQL formatter; it was corrected
to create a fresh formatter per comparison before the successful test runs.

Database tests are prepared, **not executed**: subscription tuple/advisory
inversion, immediate atomic order contention rejection, manual provenance after
payment, and the original authorization/idempotency/concurrency/expiry tests.
The real-user rejection and execution approval guard blocks are unchanged and
pinned by tests. Never run the destructive synthetic harness on the populated
development project or weaken its guard.

Still unverified on PostgreSQL: actual function compilation/ownership/grants,
RLS under real PostgREST requests, the modeled concurrent races, audit-failure
rollback, timed expiry/renewal restoration, native Windows execution and legacy
catalogs above 50. These are review/rollout prerequisites, not passing claims.
The all-seller admin list still aggregates counts before pagination; assess
performance on a representative development dataset. Existing non-finite legacy
expiry values would require separate reconciliation if present; none was read.

## Review-only Windows commands

Obtain the revised reviewed files together; GitHub still contains the earlier
candidate until a separate commit/push is approved. These commands do not connect:

```powershell
$py = '.\.venv\Scripts\python.exe'
if ((git branch --show-current).Trim() -ne 'sellnova-v2-development') { throw 'Wrong branch' }
$expected = 'bf33cccea4ea7ef73fde4d6eb9ae55ced682be6bc63938b62a00e231dc681bde'
if ((Get-FileHash database/development/corrections/008_admin_subscription_management.sql -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Wrong candidate' }
& $py -m unittest discover -s scripts/devdb -p 'test*offline.py' -v
if ($LASTEXITCODE -ne 0) { throw 'Offline tests failed' }
& $py scripts/devdb/check_static.py
if ($LASTEXITCODE -ne 0) { throw 'SQL static validation failed' }
& $py scripts/devdb/migrate.py --plan
if ($LASTEXITCODE -ne 0) { throw 'Manifest failed' }
```

No application is authorized by this review. After separate authorization,
repeat the existing read-only 18-entry ledger verification against this same
manifest prefix and verify the revised SHA before considering execution. Do not
reuse an approval tied to the old SHA. No new apply/seed/reset command is issued.

## Changed files in this review

- `database/development/corrections/008_admin_subscription_management.sql`
- `database/development/manifest.json` (entry 19 hash only)
- `scripts/devdb/test_admin_subscription_offline.py`
- `scripts/devdb/admin_subscription_integration.py`
- `scripts/devdb/integration.py` (bounded 40001 test retry; guards/assertions retained)
- NEW `scripts/devdb/subscription_lock_integration.py`
- `docs/SPRINT_4C_BACKEND_REVIEW.md` (current SHA/status/semantics)
- NEW `docs/SPRINT_4C_PRE_EXECUTION_REVIEW.md`

No frontend file or historical migration changed. No commit or push was made
for this corrected candidate. Data preservation/forward-correction rollback
requirements from the backend report continue to apply.

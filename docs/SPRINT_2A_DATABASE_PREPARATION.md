# Sprint 2A — development database preparation

> Sprint 2B update: the inventory reservation policy and frontend UUID blocker below
> describe the Sprint 2A review snapshot. They are superseded by
> [SPRINT_2B_CHECKOUT_INVENTORY.md](SPRINT_2B_CHECKOUT_INVENTORY.md). The current
> unapplied corrections deduct stock only at seller confirmation, and the client
> now supplies durable request UUIDs. Migration order stays unchanged; checksums
> have been refreshed. Do not alter any already-applied database history.

Status: **prepared for review; no SQL executed and no database connection made**.
Branch: `sellnova-v2-development`. Base commit:
`5334f1e342d360d9eb3d4a0e4209bd183b9f8135`.
Target: `sellnova-v2-dev`, reference `qfcnaceeppgrquoszkor`, API origin
`https://qfcnaceeppgrquoszkor.supabase.co`.

The Sprint 2 connection report is preserved at
`docs/SPRINT_2_SUPABASE_VERIFICATION.md`. This work adds scripts and SQL only;
application source, dotenv files, dependency declarations/lockfiles, the CLI
project config, and all eight historical migrations are unchanged. During database
preparation, no commit, push, merge, deployment, production access or automatic
GitHub/Supabase link was performed. Git publication for review is reported separately
and does not authorize database execution. The scripts are deliberately not wired into npm startup or CI.

## Decisions requiring approval before execution

- **Frontend integration gate:** the development checkout RPC replaces the legacy
  seven-argument function with an eight-argument function requiring a stable
  `_request_id` UUID. Omission rejects the write. Sprint 1's unchanged frontend
  does not supply it. Before browser checkout can work against this schema, a
  separate frontend change must generate one UUID per checkout, reuse it after
  timeouts/reloads, bind it to the unchanged payload, and regenerate database
  types. Do not silently fall back to non-idempotent inserts.
- **Inventory policy:** successful checkout reserves/deducts tracked stock at
  order creation. Confirmation does not deduct again. Cancellation restores the
  per-item reservation exactly once, even after stock tracking/plan changes.
  Pending orders reserve stock until explicitly cancelled; automatic reservation
  expiry and seller returns workflows are not included. This differs from the
  historical confirmation-time deduction and is development-only.
- **Billing:** preserve the existing `free` / `paid` structure. Free has 12
  products; Paid has a synthetic development cap of 100 and the existing paid
  entitlements. Paid price is **zero/unconfigured**, deliberately disabling the
  purchase UI. No real banking details or customer subscriptions are seeded.
  Paid duration 30 days is an entitlement fixture period, not a trial. The new
  **30-day trial and NGN 1,500 monthly model are deferred** to a later sprint.
- **Runtime validation gate:** offline parsing cannot prove catalog/type resolution,
  RLS behavior or concurrency on Supabase. The prepared integration tests must be
  run only after separate explicit approval for synthetic development writes.
- **Connection prerequisites:** a development-only direct PostgreSQL credential,
  verified TLS trust roots, and direct-endpoint network reachability are required
  later. Only the exact `db.qfcnaceeppgrquoszkor.supabase.co:5432/postgres` endpoint
  and `postgres` migration user are accepted. Poolers and alternate hosts are
  intentionally unsupported; report a connectivity blocker rather than loosening
  this guard. No production credentials should be supplied or reused.

## Ordered migration plan

`database/development/manifest.json` is the single authoritative sequence for this
fresh development setup. It stores SHA-256 checksums for all 14 executable setup
files. The two Supabase base files are not in Drizzle's existing journal; running
Drizzle alone would fail. Running the Supabase directory alone omits Release 1/2.
Do not run two migration systems against the same changes or mark files applied
without actually executing them.

| Order | File | Dependency / purpose |
| --- | --- | --- |
| 1 | `supabase/migrations/20251029190315_1f320370-b591-4676-8b0c-4bef83e736cc.sql` | Supabase-managed auth/storage/roles first; creates original enum, profiles, roles, stores, products, visits, triggers and product-images bucket |
| 2 | `supabase/migrations/20260104115039_c5cc966a-8124-4d6f-89ab-b50b796bc7ce.sql` | Base tables first; adds product views, analytics policies, profile email/admin access |
| 3 | `drizzle/migrations/0000_sellnova_release1_integrity.sql` | Both base files first; slug/phone functions, validations, analytics guards, storage ownership |
| 4 | `drizzle/migrations/0001_email_first_signup_profiles.sql` | Email column and phone helper first; makes email-first signup safe |
| 5 | `drizzle/migrations/0002_sellnova_release2_foundation.sql` | Existing stores/products/helpers first; pgcrypto, plans, stock, orders, subscriptions, promotions, reviews, branding |
| 6 | `drizzle/migrations/0003_sellnova_release2_checkout_rpcs.sql` | Foundation first; checkout/review/admin RPCs and subscription trigger |
| 7 | `drizzle/migrations/0004_release2_storage_policies.sql` | Foundation/helpers first; logo/proof policies and indexes, not bucket creation |
| 8 | `drizzle/migrations/0005_release2_stock_branding_entitlements.sql` | Foundation helpers first; paid stock/branding guards and public-branding helper |
| 9 | `database/development/corrections/001_order_integrity.sql` | Reservation quantities, private request/rate ledgers, immutable order/state trigger |
| 10 | `database/development/corrections/002_checkout.sql` | Requires private ledgers and reserved quantities; idempotent, validated, locked checkout |
| 11 | `database/development/corrections/003_permissions_rls.sql` | All functions/tables first; explicit grants, RLS, analytics/subscription guards and helper corrections |
| 12 | `database/development/seeds/001_plans.sql` | Two baseline plans and blank/nonfinancial platform settings |
| 13 | `database/development/seeds/002_storage.sql` | Three bucket configurations and tightened object policies |
| 14 | `database/development/tests/postflight.sql` | Catalog/privilege/overload/RLS/seed assertions; failure rolls back setup |

No historical compatibility edits were necessary. Function replacements and
compatibility/security fixes live exclusively in the new correction files.
`drizzle/schema.ts` remains empty: **never run `drizzle-kit push` or generate a
replacement schema diff**. Existing snapshots are not executable base migrations.
The original `numeric(10,2)` price boundary (99,999,999.99) still applies; do not
rely on the old trigger's higher bound. Test native numeric limits explicitly.

## Runner safety and repeatability

From the repository root, the following commands are **offline only**:

```sh
python scripts/devdb/migrate.py --plan
python -m unittest discover -s scripts/devdb -p test_offline.py -v
python scripts/devdb/integration.py
python scripts/devdb/auth_contract.py
```

For full grammar parsing, install the dedicated tool dependencies into an isolated
virtual environment or another external tool directory, not the app package:

```sh
python -m pip install -r scripts/devdb/requirements.txt
python scripts/devdb/check_static.py
```

The pinned tools are psycopg 3.3.6 and pglast 8.6. Static validation for this task
used `/tmp/sellnova-static-tools`, via `PYTHONPATH`, without connecting a driver.
Pglast's offline PostgreSQL parser checks grammar, including PL/pgSQL bodies;
it does not resolve live tables, types, functions, policies or extension versions.

**Future execution only, after explicit approval:** securely inject
`DEV_DATABASE_URL` and, if necessary, `DEV_DB_SSLROOTCERT`; never place credentials
in this repository, command arguments, logs, chat or checked-in dotenv files.
The URI must use the exact direct host/user/database above, with no query string,
fragment, pooler, host override or alternative port. The runner constructs its
connection parameters itself and requires TLS `verify-full`; never disable TLS
verification or use an untrusted CA to make a connection pass.

`DEV_PROJECT_REF` must equal the pinned development ref, and the explicitly
injected `VITE_SUPABASE_URL` must equal its API origin. The runner does not load the
conflicting tracked `.env` or trust `supabase/config.toml`. It validates the TLS
hostname and expected database/session user; a caller-provided SQL session setting
alone is not evidence of project identity.

The execution switch is `python scripts/devdb/migrate.py --apply`, additionally
requiring `DEVDB_APPROVAL=APPLY-qfcnaceeppgrquoszkor`. This acknowledgment is an
accident guard, not authorization by itself. Do not set/use it until the user
approves execution. No `--apply` command was run in this task.

After target verification the runner:

1. Starts one transaction and acquires a deployment advisory lock, with lock and
   statement timeouts. Required managed schemas/functions and pgcrypto's schema
   are checked. An existing pgcrypto outside `extensions` is a blocker; it is not
   moved automatically.
2. Refuses adoption of an untracked nonempty public schema, existing Auth users or
   storage buckets. It does not reset, import or repair an unknown project.
3. Maintains a private, project-scoped `sellnova_dev.migration_history` ledger.
   Checksums, project IDs, unexpected files and noncontiguous histories are checked.
4. Sets a transaction-local development context, then applies files and ledger
   rows in order. Newly prepared SQL independently checks that context. These
   checks discourage accidental manual execution; they are not a defense against
   a malicious privileged database operator who edits the scripts.
5. Runs catalog assertions before commit. A failure rolls back the entire chain,
   including seeds and history. `PREPARED` log messages are not proof of commit;
   only the final committed message establishes that transaction outcome.
6. On repeat, skips matching applied files and reruns catalog assertions. Never
   edit an applied file/hash to silence drift: append a reviewed correction instead.

Plan seeds use `ON CONFLICT DO NOTHING`, preserving later deliberate development
configuration. Bucket configuration uses an idempotent upsert. No real users,
orders, stock, subscriptions, payment proofs or production assets are seeded.

## Recovery and rollback procedures

These procedures are prepared for a future approved execution. None was needed or
executed during preparation or GitHub publication.

1. **Failure before the migration transaction commits:** let the runner exit and
   roll back. All historical SQL, corrections, seeds, bucket metadata and history
   entries are in the same transaction. Do not ignore an error, manually mark a
   file applied, or rerun individual files out of order. Retain sanitized failure
   type, step and checksum information; never retain credentials or row contents
   in logs. Resolve the cause and review the plan again before an approved retry.
2. **Lost connection or uncertain commit result:** stop. Do not assume rollback
   merely because the client did not receive the final message. After approval,
   inspect the private migration history using the same verified development
   endpoint and compare every path, project ID and checksum with the manifest.
   Matching committed history means setup committed; an empty/uncreated ledger
   means it did not. Any unexpected or partial state requires manual review.
   The runner refuses unknown state rather than adopting or resetting it.
3. **Problems discovered after a confirmed commit:** there is no automatic down
   migration, reverse runner or destructive reset. Preserve history and diagnose
   the issue. Prepare an append-only corrective migration and review it before
   applying. Never edit an applied file or its recorded checksum to hide drift.
   A Git revert changes repository files only; it does not reverse database DDL,
   restore stock or remove seeded rows.
4. **Disposable-project rebuild:** only with separate explicit approval, and only
   after confirming the exact development project is disposable and contains no
   retained work, recreate/restore an approved development snapshot through a
   reviewed procedure. Record what is being discarded and preserve necessary
   synthetic test evidence first. Never point a reset/recovery operation at
   production, a shared project, or an unverified endpoint.
5. **Interrupted integration/Auth tests:** use the recorded synthetic run UUID,
   generated user IDs, reserved-domain emails and metadata tags to identify only
   that run's fixtures. Review targeted cleanup; do not delete all users, stores
   or buckets. Storage objects must be cleaned through the Storage API before
   deleting their synthetic owners. If cleanup cannot be verified, stop and report
   the retained synthetic fixtures rather than resetting the project.

## Security corrections and limits

- Owner sellers retain direct `UPDATE(status,delivery_fee)` on orders under RLS.
  Buyer details, reference, monetary snapshots, inventory flags and review flags
  are protected by column ACLs and invariant checks. FK promotion deletion may
  null its reference without changing the stored discount. Review submission can
  clear a token once; clients cannot reset its protected flag.
- Checkout requires a UUID, bounds/null-checks buyer fields and JSON cart shape,
  aggregates repeated product IDs and caps combined quantities at 999. Only
  database prices/totals are used. A private `(store_id,request_id)` ledger stores
  a normalized payload hash and receipt. Matching replay returns that receipt;
  mismatched payload reuse fails. Replays do not reserve stock or consume quotas
  twice. Request UUIDs must be unguessable and retained by the future client.
- A store-scoped transaction advisory lock serializes checkout/cancellation and
  coupon consumption. Products are locked in UUID order; promotion rows are
  locked before choosing/updating usage. Inventory deduction, order/items,
  promotion usage and request ledger commit or roll back together.
- Fixed-window quotas use private atomic UPSERT counters: 10 successful new
  checkouts/store/minute, 3/store/normalized-phone/minute, 30 visits/store/minute,
  20 views/product/minute. Definer analytics triggers see full counts despite RLS,
  validate active store/product relationships, replace timestamps and discard
  caller IP/user-agent data. Column grants reject forged timestamps/metadata.
- PUBLIC function defaults are revoked. Only intended public storefront/review/
  checkout helpers and authenticated admin functions are explicitly granted.
  Direct access to caller-priced discount helpers and private ledgers is denied.
  `has_role` permits public policy evaluation but returns false for anonymous
  callers and refuses non-admin queries about another user's roles.
- Explicit application-table grants replace template defaults; public CREATE on
  the trusted function schema is revoked. Subscription rows become owner/admin
  readable. Public branding/reviews/automatic promotions require active stores
  and appropriate entitlements. Existing seller/admin RLS remains in place.
- Sellers cannot forge approval/reviewer fields or mutate promotion counters.
  Request inserts require ownership, pending status, active configured Paid plan,
  exact database price and own-folder proof paths. Existing UI payloads that send
  `status='pending'` or unchanged promotion `store_id` remain supported. Indefinite
  active subscriptions are preserved when a new payment request is submitted;
  admin extension days are bounded. Review tokens clear consistently.

Residual risks / approval considerations:

| Risk | Assessment and mitigation |
| --- | --- |
| Unexecuted SQL/catalog/concurrency semantics | High until tested on a disposable, approved development target. Offline parser and role simulations cannot replace actual RLS/transaction tests. No live readiness claim. |
| Frontend does not yet send request UUID | Blocking compatibility change; do not claim browser checkout works after this migration without a separate client change and regenerated types. |
| Abandoned pending reservations | Stock remains reserved; no automatic expiry. Manually cancel synthetic pending orders; design a reviewed expiration policy later. Stock manually raised to the validation ceiling can make cancellation restoration exceed that ceiling; include this boundary in inventory-policy review before adoption. |
| Public API abuse | Counters cover committed operations; failed transactions roll counters back. Minute boundaries allow bursts; phone is buyer-supplied and not identity. A trusted edge/proxy IP limiter/CAPTCHA and monitoring are still needed before broader exposure. No spoofable header is treated as trusted identity. |
| Store serialization | Conservative throughput, contention and possible deadlocks with unrelated writes. Timeouts/transaction rollback are retained; test contention and stable-key retries rather than retrying with a fresh UUID. |
| Private ledger growth | Request receipts are retained for durable idempotency. Rate windows require a reviewed owner-only retention job; no cron or automatic deletion is installed. Deleting request keys too early would weaken retry protection. |
| SQL owner privileges | Migrations need privileged DDL/Auth/storage access. Use development-only credentials; verify owners/ACLs in catalog tests. RLS does not constrain a trusted superuser. |
| Storage | Product images public, logos private with scoped signed-URL access, payment proofs private. MIME allowlists/size caps are prepared; malicious-file scanning and signed-link leakage protection are separate concerns. Storage API object tests remain required. |
| Cleanup failure | Integration creates committed synthetic fixtures for multi-session races. Interrupted cleanup may leave only tagged fixtures; stop and reconcile the recorded synthetic run, never blanket-reset a shared project. |

## Development storage configuration

| Bucket | Visibility | Limit | Allowed MIME types |
| --- | --- | --- | --- |
| `product-images` | Public product assets | 5 MiB | JPEG, PNG, WebP |
| `store-logos` | Private; owner/admin or active entitled storefront SELECT/signing | 2 MiB | JPEG, PNG, WebP |
| `payment-proofs` | Private; own-folder upload, owner/admin read, no client UPDATE | 5 MiB | JPEG, PNG, PDF |

Object paths must begin with the authenticated user's UUID. Product/logo UPDATE
checks both old and new paths. Bucket setup creates no objects. Do not reuse any
production files or proofs. Do not change managed Auth/storage table ownership.

## Authentication and synthetic administrator provisioning

After separate approval and full migration success:

- Configure development-only Auth site URL/redirect allowlists for the actual
  development origin, `/auth/login` and `/auth/reset-password`. Never add wildcard
  production origins. Use a local mail catcher or development SMTP; do not send
  mail to real sellers/customers or import production identities.
- The code supports email-first signup, default seller roles, reset/recovery and
  session persistence. Keep email confirmation policy deliberate; tests using
  Admin `email_confirm=true` do not prove email delivery or the confirmation UI.
- For Auth API tests only, securely inject `DEV_AUTH_ADMIN_JWT`: a development
  service-role JWT whose project/ref/role/expiration are checked. It is server-only,
  never `VITE_*`, and never written to disk/output. The test tool refuses legacy
  production JWTs, wrong-role JWTs and unidentifiable secret-key formats. A supplied
  metadata claim is only an early guard; the exact TLS-verified API validates the
  signature. No admin credential is requested for this offline preparation task.
- Create only randomized `@example.test` users tagged
  `user_metadata.sellnova_synthetic_test=true`. Do not embed shared passwords or
  create a default admin during migration. Auth API tests generate passwords in
  memory, create confirmed synthetic users, exercise sessions and delete them.
- To provision an application administrator later, create/confirm a dedicated
  tagged synthetic Auth user in the development project first. Then review its
  UUID using `python scripts/devdb/provision_admin.py <synthetic-user-uuid>` (offline).
  Only after explicit approval, the same command with `--apply` additionally
  requires `DEVDB_ADMIN_APPROVAL=PROMOTE-SYNTHETIC-qfcnaceeppgrquoszkor`. It verifies
  exact target, reserved-domain email and metadata before inserting the admin role.
  A service-role API credential and an application admin role are different things.

## Prepared integration tests and execution gates

No live test below has been run. Default invocations print preparation status only.

`python scripts/devdb/integration.py --run` requires the complete matching
migration history, exact target validation and
`DEVDB_TEST_APPROVAL=RUN-SYNTHETIC-qfcnaceeppgrquoszkor`. It refuses a project with
non-synthetic Auth users, holds the same deployment lock, creates tagged fixtures,
uses transaction-local signed-claim **simulation** with `SET LOCAL ROLE`, and
cleans only its generated UUIDs in `finally`. SQL fixtures test the auth trigger;
they are not a replacement for real Auth API signup/login.

Prepared cases cover profile creation/default seller role/nullable phone,
request replay/mismatch, protected-column denial, anonymous order/ledger denial,
cross-seller isolation, no self-assigned admin, confirmation without double
stock deduction, cancellation without double restoration, two-connection request
replay and last-unit race, duplicate-line stock rollback, concurrent promotion
limits, malformed/empty carts, a saturated analytics quota, bucket privacy,
seller approval denial and synthetic-admin approval. Temporary request/price/
subscription/audit changes are rolled back together. Multi-session race fixtures
must commit, so cleanup is explicit and test writes require their own approval.

`python scripts/devdb/auth_contract.py --run` additionally requires
`DEVDB_AUTH_TEST_APPROVAL=RUN-AUTH-SYNTHETIC-qfcnaceeppgrquoszkor` and the separately
validated development Auth admin JWT. Only the fixed development HTTPS origin is
used; redirects are refused. It prepares two synthetic email-first accounts,
password login, authenticated identity/profile/default-role reads, invalid-password
rejection and logout, then deletes only its tagged accounts. Credentials/tokens
remain in memory and failures suppress sensitive response/driver details.

Additional acceptance matrix before claiming readiness:

| Area | Required live checks after approval |
| --- | --- |
| Auth | Real signup/confirmation/password recovery, redirect allowlists, token refresh; no real emails |
| Checkout | Persist stable UUID through browser retries/reloads; timeout-after-commit replay; changed-payload rejection; invalid UUID/NULL/oversized inputs; compare saved order/items/receipt |
| Inventory | Mixed tracked/untracked items, duplicate IDs, paid expiry, toggle tracking before cancellation, concurrent stock edits, numeric ceilings, stale product/deletion and cancellation races |
| Subscriptions | Wrong amount/plan/proof/status, owner isolation, duplicate admin decisions, expiration/suspension/indefinite active plans, extension bounds and audit attribution |
| Reviews | Complete order, token context, one submission, null cleared token, repeated submission denial, no seller flag/rating/comment/customer-name forgery |
| Rate limiting | Count/race tests with genuinely anonymous API requests and minute boundaries; invalid attempts handled by future edge limiter |
| Storage | Own uploads, forged folder paths, cross-owner/anonymous proof download and signing denial, admin proof access, size/MIME errors and cleanup through Storage API (not raw metadata deletes) |
| Idempotent setup | Second runner invocation skips files and passes postflight; seed replay in a rollback-only test; hash/history drift and untracked nonempty database refusal |

## Static results and exact file summary

- Offline grammar checks: **14 manifest files / 320 SQL statements**, plus prepared
  SQL fixture grammar, parsed successfully. Eight historical files match dependency
  order. Development guards and absence of transaction controls are verified.
- Offline safety suite: **11 tests passed**. No database driver connection or API
  request was made. Python syntax compilation and Git whitespace checks pass.
- Both existing TypeScript project checks pass. ESLint passes with zero errors and
  the same 14 pre-existing warnings; application source is unchanged.
- Offline plan and default integration/Auth modes pass. Live database, Auth API,
  Storage API and browser-against-database tests are **unrun**.
- Historical migration hashes, application source, `.env`, npm manifests and
  lockfiles are unchanged. Existing Sprint 1 code validation is not represented as
  a new live database integration result.

New files for Sprint 2A:

1. `database/development/manifest.json`
2. `database/development/corrections/001_order_integrity.sql`
3. `database/development/corrections/002_checkout.sql`
4. `database/development/corrections/003_permissions_rls.sql`
5. `database/development/seeds/001_plans.sql`
6. `database/development/seeds/002_storage.sql`
7. `database/development/tests/fixtures.sql`
8. `database/development/tests/postflight.sql`
9. `scripts/devdb/.gitignore`
10. `scripts/devdb/requirements.txt`
11. `scripts/devdb/target.py`
12. `scripts/devdb/migrate.py`
13. `scripts/devdb/check_static.py`
14. `scripts/devdb/test_offline.py`
15. `scripts/devdb/integration.py`
16. `scripts/devdb/auth_contract.py`
17. `scripts/devdb/provision_admin.py`
18. `docs/SPRINT_2A_DATABASE_PREPARATION.md`

The pre-existing untracked Sprint 2 verification report is preserved separately.
No other existing files were modified. These preparation files are published only
for GitHub review on the development branch; publication does not apply SQL.
**Stop here. Explicit user approval is required before any SQL execution,
synthetic database/Auth test writes or administrative account provisioning.**

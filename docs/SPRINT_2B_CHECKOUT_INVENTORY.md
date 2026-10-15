# Sprint 2B — checkout and confirmation-time inventory

Branch: `sellnova-v2-development`. Starting commit:
`ebba88e3ec4e04bc50b87c06a60c7b6359e47a53`.
Target: `sellnova-v2-dev`, `qfcnaceeppgrquoszkor` only.

## Approved inventory policy implemented

Pending checkout saves order/item price snapshots and consumes no stock or
reservation. It validates current product availability and tracked quantities,
but a pending order never guarantees future availability. On a `new` →
`confirmed` transition, the database locks the store transaction and products in
UUID order, rechecks current availability/stock and deducts tracked quantities.
Insufficient stock raises an error and rolls back all item deductions, status,
internal flags and audit events, including when a later item in the order fails.

`order_items.deducted_quantity` records the quantity actually deducted. It is
server-controlled, not a reservation. Repeated confirmation of the same order
is a no-op for inventory. Cancellation of a pending order changes no stock;
cancellation of a confirmed/processing/ready order restores recorded deductions
exactly once, regardless of current tracking settings or plan entitlement.
A repeated cancellation changes no inventory. Invalid status transitions remain
rejected. Completed orders are terminal under the existing status model.

Immutable buyer/order snapshots and prices are preserved when catalog prices or
names change. A private `sellnova_dev.order_events` ledger records each status
transition, actor UUID and stock deltas in the same transaction. Checkout records
an initial event with no stock movement. Clients cannot write the private ledger,
order stock flag or per-item deduction field. Seller updates remain restricted
to allowed status/delivery-fee columns and owner/admin RLS.

Cancellation must restore real units even when stock was manually raised to the
normal 1,000,000 ceiling after confirmation. The product validator now allows a
trusted nested PostgreSQL-owned order trigger to restore those units above the
manual ceiling. Direct client stock increases remain capped, and nonnegative/
integer bounds remain enforced. Unrelated edits/decreases to an above-ceiling
restored count are allowed. Actual catalog/trigger behavior still needs approved
live testing. If an ordered product is deleted, confirmation fails; cancellation
cannot recreate a deleted catalog row, but retains immutable order/item details.

## Checkout identity, retries and receipts

- The client generates a cryptographically secure UUID and sends `_request_id`
  to the eight-argument RPC. TypeScript definitions were updated manually from
  the prepared SQL; no live schema generation or database connection occurred.
- A canonical payload digest includes store, normalized buyer details and sorted,
  aggregated product IDs/quantities, excluding mutable browser prices. A genuine
  payload change uses a different digest and request UUID. Equivalent phone
  formatting/trimmed whitespace retain the same logical payload.
- Local storage contains digest keys and UUIDs only. Tab-scoped session storage
  retains buyer fields and the active UUID for refresh recovery. Same-payload
  in-flight tabs share the pending UUID under a Web Lock. Browser locks, secure
  UUID/hash APIs and working storage are required; otherwise checkout fails
  before sending a write. There is no non-idempotent fallback.
- After timeout, network/server error, malformed receipt or a lost committed
  response, the cart and identity remain available for a same-payload retry.
  Reopening or refreshing does not silently rotate the request UUID. A 20-second
  client timeout does not imply server rollback; the UI explicitly says the save
  is unconfirmed and offers safe recovery rather than declaring success.
- Only a validated database receipt marks the order saved or opens WhatsApp. The
  receipt's prices, discounts, totals and reference are authoritative. A fallback
  WhatsApp link remains available if the browser blocks the popup.
- After acknowledged success and persistent cart clearing, the completed identity
  is removed for a new logical order. Other existing tabs keep their active UUID
  and can still replay the original order. If cleanup fails, identity is retained
  in preference to risking a duplicate. No automatic expiry deletes unresolved
  identities. Clearing browser storage manually removes client retry knowledge.
- Buyer drafts are session-scoped personal information. They are cleared after
  acknowledged success when storage permits, and end with the tab session. Do not
  log/copy draft contents; evaluate shared-device/privacy requirements before a
  broader rollout. Changing details after an uncertain result creates a distinct
  request and can represent a second order; the UI makes that distinction explicit.

The seller Orders page uses expected-status filtering, a synchronous busy guard,
returned row IDs and a refetch. It does not guess stock or status locally.
Insufficient-stock messages remain visible inside the order dialog; a stale
status update triggers refresh rather than claiming success. Storefront product
cards/details show stock/availability and prevent adding known unavailable units.
They remain snapshots; the database revalidates at checkout and confirmation.

## Development configuration and connectivity

`vite.config.ts` rejects any target other than the exact development API origin,
including fallback to the unchanged tracked production `.env`. A legacy anon JWT
must have the development ref/role; secret/service-role frontend keys are refused.
Opaque publishable keys are validated by the development gateway, not decoded.
The isolated-mock exception requires development mode, `SELLNOVA_ISOLATED_MOCKS=1`,
exact localhost backend URL and the exact fake public key. Production builds
cannot use that exception. This guard is deliberate for the development branch;
production deployment configuration would need a separate reviewed change.

Injected development URL and publishable key are present. A safe GET to the exact
development `/auth/v1/settings` returned HTTP 200. The newly built bundle contains
the development URL, not the conflicting dotenv URL. No normal storefront was
opened against the hosted backend; browser tests intercept analytics writes too.

The direct database transport probe **failed at DNS resolution (`gaierror`)** for
`db.qfcnaceeppgrquoszkor.supabase.co`. TCP reachability and verified PostgreSQL TLS
could not therefore be established. `DEV_PROJECT_REF` and `DEV_DATABASE_URL` are
not injected; no custom `DEV_DB_SSLROOTCERT` is supplied. The probe would use the
system trust store unless a reviewed CA bundle is supplied. No credentials,
PostgreSQL startup/authentication messages or SQL were sent. Do not weaken TLS,
change target hosts or silently use a pooler to bypass this blocker.

The migration runner continues to require exact development identity, direct
host, verified TLS and explicit approval. HTTP Auth connectivity is not evidence
of PostgreSQL connectivity, database schema readiness or successful writes.

## Updated migration plan

**No migration or synthetic database write has been executed.** The original
eight historical migrations are byte-for-byte unchanged. The same 14-file order
is retained, with refreshed hashes for four changed, unapplied development SQL
files. Apply nothing until explicit approval, target connectivity and database
state have been verified. If Sprint 2A was applied outside this session, the
runner must reject checksum drift: do not edit its ledger or replay these files;
prepare new append-only corrections after reviewing the actual state instead.

1. `supabase/migrations/20251029190315_1f320370-b591-4676-8b0c-4bef83e736cc.sql`
2. `supabase/migrations/20260104115039_c5cc966a-8124-4d6f-89ab-b50b796bc7ce.sql`
3. `drizzle/migrations/0000_sellnova_release1_integrity.sql`
4. `drizzle/migrations/0001_email_first_signup_profiles.sql`
5. `drizzle/migrations/0002_sellnova_release2_foundation.sql`
6. `drizzle/migrations/0003_sellnova_release2_checkout_rpcs.sql`
7. `drizzle/migrations/0004_release2_storage_policies.sql`
8. `drizzle/migrations/0005_release2_stock_branding_entitlements.sql`
9. `database/development/corrections/001_order_integrity.sql`
10. `database/development/corrections/002_checkout.sql`
11. `database/development/corrections/003_permissions_rls.sql`
12. `database/development/seeds/001_plans.sql`
13. `database/development/seeds/002_storage.sql`
14. `database/development/tests/postflight.sql`

Changed unapplied SQL checksums:

| File | SHA-256 |
| --- | --- |
| `database/development/corrections/001_order_integrity.sql` | `4a71157e0dd970bf1d3007c6a28bc11f76ff1e2c17a770cdca97f564b967cd08` |
| `database/development/corrections/002_checkout.sql` | `fac2ca477e535a2e6f070ca2c360e73745c110072c528930c1809ab1e50d6b2f` |
| `database/development/corrections/003_permissions_rls.sql` | `784b886a2221289cc83671929f3d7467ddf53ac6498e2ce69b3bf89f188e34a0` |
| `database/development/tests/postflight.sql` | `195a50536fcd7f1528e3b9a7ce8f6a796b27f9cd787cbc61c98d5866af20a710` |

The Sprint 2A runbook now links to this document to supersede its old reservation
policy and frontend blocker. Existing seeds/buckets/Free-Paid model are unchanged.
The future 30-day trial and NGN 1,500/month model remain deferred.

The runner's all-or-nothing transaction, private checksum history, preflight and
postflight checks, unknown-state refusal and no-reset behavior remain intact.
On uncertain commit outcome, stop and inspect history only after approval. On a
confirmed committed defect, append a reviewed correction; Git revert does not
roll back a database. Never reset production or a shared/unverified project.

## Validation results

| Check | Result |
| --- | --- |
| `npm run build` | Passed; existing large-bundle warning remains |
| `tsc --noEmit -p tsconfig.app.json` | Passed |
| `tsc --noEmit -p tsconfig.node.json` | Passed |
| `npm run lint` | Passed: 0 errors, 14 existing warnings |
| SQL/PLpgSQL parser and manifest integrity | Passed: 14 manifest files, 324 SQL statements, plus prepared fixture grammar |
| Migration runner offline safety suite | 11 tests passed |
| `node tests/development_config.mjs` | 7 offline target/key/mock guard checks passed |
| `python tests/sprint2b_browser.py` | 21 isolated browser regressions passed, including inherited Sprint 1 coverage |
| Python compilation / Git whitespace | Passed |
| Live DB migrations, seeds, integration/Auth test writes | **Not run**; explicit approval required |
| Direct PostgreSQL DNS/TCP/TLS | Blocked at DNS; TCP/TLS unverified |

Browser coverage includes secure request UUIDs, duplicate-click guarding, stable
same-payload retries, changed buyer/cart payloads, equivalent phone formatting,
refresh after a committed response is lost, cross-tab recovery, timeout, invalid
receipt, blocked storage, authoritative receipt messaging, out-of-stock controls,
seller stock-error visibility, status transitions, protected routes and all prior
landing/navigation/cart/review regressions. Requests use an intercepted localhost
backend; all external requests are blocked and WhatsApp opening is captured.
Mock idempotency proves the client reuses its key, not that remote SQL executes.

Prepared (unrun) database scenarios now cover pending/replay without deduction,
confirmation once, confirmation of competing pending orders for the last unit,
simultaneous repeat confirmation of one order, duplicate item aggregation,
all-or-nothing multi-product failure, pending cancellation without movement,
confirmed cancellation exactly once after tracking is disabled, immutable item
prices after catalog edits, status/stock/audit rollback and existing RLS,
subscription, malformed-input and promotion-concurrency cases.

Reproduce offline validations from the repository root:

```sh
npm run build
./node_modules/.bin/tsc --noEmit -p tsconfig.app.json
./node_modules/.bin/tsc --noEmit -p tsconfig.node.json
npm run lint
python -m unittest discover -s scripts/devdb -p test_offline.py -v
python scripts/devdb/check_static.py
node tests/development_config.mjs
python scripts/devdb/migrate.py --plan
```

The SQL parser requires `scripts/devdb/requirements.txt`; this task used its pinned
tools from `/tmp/sellnova-static-tools` via `PYTHONPATH`. No driver was connected.
For browser tests, start this separately and then run the suite:

```sh
SELLNOVA_ISOLATED_MOCKS=1 \
VITE_SUPABASE_URL=http://127.0.0.1:54321 \
VITE_SUPABASE_PUBLISHABLE_KEY=mock-public-key \
VITE_STORE_URL=http://127.0.0.1:8081 \
npm run dev -- --host 127.0.0.1 --port 8081 --strictPort
# In another terminal:
python tests/sprint2b_browser.py
```

`python scripts/devdb/check_transport.py --probe` is an optional exact-development
DNS/TCP/TLS-only probe; default invocation connects nowhere. Do not run the
migration or integration tools with `--apply`/`--run` before explicit approval.

## Remaining blockers and risk assessment

1. **Live validation blocked/unapproved:** PostgreSQL DNS/credentials and explicit
   execution approval remain prerequisites. SQL parser success does not resolve
   catalog names, privileges, trigger ownership or concurrency semantics. No live
   database readiness is claimed.
2. **Unapplied schema required:** the frontend now requires the hardened RPC.
   Missing function/schema is surfaced as a save error; no legacy fallback is
   attempted. Confirmations and audit fields require the updated correction chain.
3. **Public checkout abuse:** committed-operation quotas remain fixed-window and
   phone is buyer-supplied. Failed SQL transactions roll back counters. Trusted
   edge rate limiting/CAPTCHA, retention policy for rate windows/request receipts,
   and monitoring remain follow-up work before wider exposure.
4. **Contention:** store/product locks serialize competing transactions; unrelated
   edits may still deadlock or time out. PostgreSQL rollback is retained. Test on
   the real development database before accepting throughput or live behavior.
5. **Browser storage/privacy:** a modern secure-context browser with Web Locks and
   storage is required. Manual storage deletion loses retry knowledge. Browser
   XSS/shared-device risks require ordinary frontend hardening; no secret/API key
   is stored in checkout records.
6. **Catalog deletion/returns:** deleted products cannot receive restored units;
   completed orders remain terminal. Returns/restock after completion and stock
   reconciliations are separate business workflows. Pending orders do not reserve.
7. **Billing/storage/Auth:** their previous setup and integration gates remain.
   No real customer/seller records, banking details or production assets are used.

## Exact Sprint 2B file changes

Modified:

- `database/development/corrections/001_order_integrity.sql`
- `database/development/corrections/002_checkout.sql`
- `database/development/corrections/003_permissions_rls.sql`
- `database/development/manifest.json`
- `database/development/tests/postflight.sql`
- `docs/SPRINT_2A_DATABASE_PREPARATION.md`
- `scripts/devdb/integration.py`
- `src/components/store/CheckoutDialog.tsx`
- `src/integrations/supabase/types.ts`
- `src/pages/seller/Orders.tsx`
- `src/pages/store/StoreFront.tsx`
- `tests/sprint1_browser.py`
- `vite.config.ts`

Added:

- `docs/SPRINT_2B_CHECKOUT_INVENTORY.md`
- `scripts/devdb/check_transport.py`
- `src/lib/checkoutRequest.ts`
- `tests/.gitignore`
- `tests/development_config.mjs`
- `tests/sprint2b_browser.py`

The separate pre-existing untracked Sprint 2 verification report is preserved
outside the commit scope. Production and `main` are untouched. No deployment,
remote migration, seed execution or synthetic write occurred. This preparation
stops before any remote database execution and awaits explicit approval.

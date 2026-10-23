# Sprint 4B — Expiry and product publication controls

Development branch: `sellnova-v2-development`. Development project:
`sellnova-v2-dev` (`qfcnaceeppgrquoszkor`). Starting commit:
`2227be1db78aafc5cfdb4dd1059b0a9920fc3812`. The user confirmed the first seventeen
migrations were applied. No remote database access, SQL execution, seed/reset,
production changes, merge to main or deployment was performed in this task.

## Design and behavior

The original `is_available` flag controls availability for purchase, not catalog
publication: existing unavailable products were still shown on the storefront.
It remains unchanged. A new `publication_selected` boolean records the seller's
intent, initially true for every existing product to preserve prior intent.

Effective public visibility is computed in the database. Only selected products
in an active store can be public, in deterministic `created_at ASC, id ASC` order,
limited to 12 on Free or 100 on currently active Paid. A later timestamp/UUID
therefore cannot displace an older selection on expiry. Creation timestamps,
product IDs and store ownership cannot be changed to reorder/move records.
The public list still displays eligible products newest first, matching the old
storefront ordering; eligibility and display ordering are separate concerns.

Free access has no deadline. Legacy active Paid records with NULL expiry retain
their existing indefinite semantics; this sprint does not invent an expiry or
silently extend/rewrite them. They need separate reconciliation if that legacy
state should change. The server checks the existing subscription's
status, Paid plan and recorded expiry against database wall-clock time; stale
JWT sessions cannot extend it. There is no scheduled expiry job, no write to
subscription/payment history and no expiry-driven product/image deletion.
Existing effective-plan helpers continue to enforce Paid feature entitlements;
publication uses the same subscription/plan records with an explicit wall-clock
check to avoid trusting client clocks or long-lived sessions.

On Paid expiry, up to the first twelve selected products remain public; excess
selected products become temporarily hidden. All saved products and their
selection flags remain intact. Renewal through the existing valid admin payment
approval immediately restores the Paid allowance. Previously selected products
suppressed solely by the cap can reappear; explicitly unpublished products do
not. No second approval is needed for publication.

The dashboard shows the server-derived plan, saved count, public count, current
allowance and per-product public/hidden state. For an over-limit retained Paid
selection, the checkbox editor starts with the effective visible subset, while
explaining that the earlier saved selection remains intact until Save. Uncheck
a visible item, check a hidden replacement and save atomically. Saving explicitly
replaces the stored selection; products not included are intentionally
unpublished, not deleted. Empty selections are allowed. Version conflicts and
plan changes require reloading the selection; unsaved choices are not silently
replayed. A Paid seller can explicitly restore additional saved products.

The existing **saved-product creation** limits remain: new Free records are
limited to twelve and Paid to one hundred. A downgraded seller may retain more
than twelve saved records, edit them and swap their public selection, but must
upgrade to add further records while over the Free creation limit. This sprint
does not introduce unlimited Free draft storage. Availability/out-of-stock state
is independent: a selected unavailable product can occupy a public slot while
its purchase controls remain disabled, as before.

## Server enforcement and concurrency

Migration 18 adds these narrowly scoped functions:

- `sellnova_publication_limit(uuid)`: private server entitlement calculation.
- `sellnova_public_product_ids(uuid)`: eligible IDs for an active public store.
- `sellnova_storefront_products(uuid)`: public-only catalog, even when the visitor
  is the store owner or an admin. It never falls back to an unrestricted query.
- `sellnova_publication_state(uuid)`: owner/admin-only status, counts, selection,
  visible IDs and optimistic revision token. No anonymous subscription read.
- `sellnova_set_publication(uuid,uuid[],text)`: owner/admin-only atomic replacement
  with distinct same-store IDs, quota checking, stale-revision rejection and
  verification that concurrent deletion did not remove a chosen item.
- `sellnova_publication_product_guard()`: private trigger serializing insert/count
  checks and preserving product identity/creation order.

Publication changes, insert capacity checks, checkout and the existing stock
confirmation/cancellation paths use the same transaction-level store advisory
lock. Competing selection updates serialize; after one changes flags, an old
revision is rejected. The revision is a content fingerprint of IDs, flags and
allowance, not an authentication credential. Competing inserts cannot both pass
the final slot's count check. Public eligibility is always capped independently
of stored selection count, including retained over-limit data and trusted owner
maintenance. A concurrent explicit product deletion can only reduce saved data;
a missing selected ID fails/requires a refresh rather than silently replacing it.

Authenticated table INSERT/UPDATE is narrowed to existing content/stock columns.
The new flag and ordering fields are not writable through ordinary REST payloads.
RLS retains owner/admin management reads and replaces broad active-store public
SELECT with effective eligibility. Direct anonymous product lookups, including
ID-filtered queries and future search/discovery queries, cannot return hidden
records. Other sellers cannot edit or select a store's products. Existing owner
INSERT/UPDATE/DELETE RLS remains in place; new controls never invoke deletion.
Administrators retain authorized management reads and can use the selection RPC
within the same store allowance.

SECURITY DEFINER functions use `search_path=pg_catalog` and qualified application
objects. PUBLIC execution is revoked. Only public read functions are granted to
anon; management functions require authenticated execution plus internal owner/
admin checks. Private helpers/triggers receive no client EXECUTE. A migration
assertion checks that clients did not inherit publication-column writes or
anonymous management execution. No privileged credentials enter frontend code.

The original product validator still handles content, availability and stock
mutations. Its trigger is scoped so publication-only updates do **not** reset
saved stock-tracking preferences on expiry. All prior price/image/stock checks
and order stock movements remain intact.

## Storefront, cart and checkout

The storefront uses the public catalog RPC for every visitor. It refreshes on
focus, visibility return and every fifteen seconds, including open product
previews and structured metadata. Missing/failed verification clears the catalog
and shows a retry error; it never uses owner-only raw data as a fallback.
Branding/entitlement refresh is also shortened to fifteen seconds. The seller
plan hook uses server-relative expiry scheduling plus periodic/focus refresh,
so the dashboard and subscription page change without logout or admin action.
Renewed expiry dates come from the refreshed server state.

Add-to-cart re-reads eligibility/availability. Existing cart items remain saved;
a newly hidden item is marked unavailable and must be removed before starting
checkout. Checkout re-reads the public catalog before opening. The existing SQL
order function independently revalidates every new cart item under the shared
lock before writing orders, preventing a hidden item from being purchased by a
retained URL, stale cart, stale tab or direct RPC call. Its validation, pricing,
quantity aggregation, coupon locks, rate limits and inventory behavior remain.

An already accepted checkout UUID still replays its existing immutable receipt,
not a new purchase. Historical order items remain accessible under existing
order authorization, and previously accepted orders can still be fulfilled or
cancelled using the old stock/status safeguards after products become hidden.
Cached product images/public image URLs are not revoked or deleted; hiding a
product protects live catalog records and new purchases, not previously
received pixels or externally retained screenshots. Saved Paid branding remains
in its editor and becomes public again after renewal. Signed-logo links retain
their existing TTL semantics.

## Append-only migration

New entry **18**:
`database/development/corrections/007_product_publication.sql`

SHA-256:
`6df14582f2b9e8f876afae34b1ac6ff77a34745fa5782dc0fd67ec7aedfab30f`

All seventeen existing SQL files and ordered manifest entries/checksums were
verified byte-for-byte against the starting repository history. No historical
migration is edited. The new correction follows 006 and adds the selection
column/index, public/management functions, SELECT RLS replacement, narrowed
column privileges, trigger guard and a checked replacement of the checkout
function. The only initialization of existing products is the additive selected
flag with default true; no product, subscription, order, review, payment, file
or Auth record is removed or expired by a data rewrite.

## Validation results and boundaries

Executed locally on Linux:

- 35 offline safety/integrity tests, including the frozen seventeen-entry prefix
  and existing routing/TLS/approval/Windows-path/checksum/order tests.
- SQL/PLpgSQL static validation: 18 manifest files, 374 statements. It validates
  grammar/checksums, not live object resolution, RLS semantics or locking.
- Both TypeScript projects, Python compilation and diff checks.
- ESLint: zero errors, fourteen pre-existing warnings.
- Production-mode build against injected development configuration. Existing
  bundle-size and outdated Browserslist warnings remain. No deployment.
- Existing subscription/payment and anonymous/authenticated branding browser mock
  suites, updated for the public catalog/server publication-state routes.
- New browser mocks: expiry without logout, automatic Free display, retained
  fifteen saved/twelve visible records, constrained swap controls, server error
  feedback, anonymous filtered catalog and hidden direct-link responses, retained
  old cart with blocked checkout, renewal/branding restoration, explicit
  republication, rejection when an item hides during an open checkout, and
  fail-closed catalog errors, eligible checkout retry with the same UUID and a
  saved WhatsApp receipt link. No external message is sent; external browser
  traffic is blocked.

Prepared, **not executed**, database integration coverage includes a new permanent
Free seller, concurrent direct inserts competing for the twelfth slot, a
thirteenth insert rejection, Paid fifteen-product entitlement/expiry, stable
fallback selection, owner-vs-anonymous reads, foreign-store/column-write denial,
concurrent selection/version conflicts, stock preference retention, hidden-item
checkout rejection, accepted receipt replay/history/confirmation, renewal before
and after intentional unpublishing, branding restoration and the hundred-product
Paid cap. It creates only new tagged synthetic fixtures and cleans only those;
it is called through the existing gated integration harness.

These mock results do not prove live PostgreSQL concurrency or deployed RLS.
No live Supabase tests were run. The existing full harness intentionally rejects
projects with real non-synthetic Auth users, including the current browser-test
project if it contains such users. Do not delete users or weaken that guard to
run it. A separately reviewed fixture-scoped testing approach or approved
isolated validation setup is needed for live execution; the pinned development
target guard must remain respected.

## Windows review and manual verification

From the repository root on the development branch, using the existing Python
3.14.6 tools environment and locked npm dependencies:

```powershell
$py = '.\.venv\Scripts\python.exe'
& $py -m unittest discover -s scripts/devdb -p 'test*offline.py' -v
& $py scripts/devdb/check_static.py
& $py scripts/devdb/migrate.py --plan
Get-FileHash database/development/corrections/007_product_publication.sql -Algorithm SHA256
& .\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.app.json
& .\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.node.json
npm run lint
# Requires existing injected development URL/publishable key; never a service key:
npm run build
# If needed once: npm ci; npx playwright install chromium
npm run test:browser
```

Linux can set `PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium`. The suites start their
own mock Vite servers on loopback ports 4174, 4175 and 4176. No credentials or
Supabase database are needed. Native Windows execution remains to be repeated.

Stop after offline review. The new frontend depends on entry 18; without it,
public catalog verification deliberately fails closed. After separate approval,
use the existing guarded development runner/Session Pooler/CA setup to apply only
the next entry. Review raw-byte hashes with LF endings, the complete contiguous
seventeen-entry remote history, backups and the new SQL first. Do not reset,
replay seeds, rewrite checksums or expose credentials. This task did not invoke
`--apply` or the remote integration harness.

After separately approved migration and release, manual browser checks:

1. Record the existing test store's product IDs/counts, orders and saved design.
   Use a new test seller to confirm permanent Free and twelve-slot behavior.
2. In a Paid test store with more than twelve products, observe the recorded
   real expiry (or use separately approved tagged synthetic expiry fixtures).
   Do not shorten an existing real seller's entitlement merely for testing.
3. Leave the seller dashboard and an incognito storefront open. Confirm Free/
   expired status, twelve public items and preserved saved count after refresh.
   Owner selection state refreshes at expiry; already displayed public pages can
   take up to fifteen seconds (or focus/reload) to refresh delivered data.
4. Uncheck a visible product, select a hidden replacement and save. Confirm both
   records/images remain, and anonymous/direct product queries show the new set.
5. In two seller tabs, edit the same revision. One save should succeed and the
   stale one should request a reload, never silently exceed the allowance.
6. Retain a cart containing a product that becomes hidden. Confirm the warning,
   blocked checkout and a direct new checkout refusal; previously saved orders
   and receipts must remain intact. Repeat stock/order regression checks.
7. Use the existing manual payment approval workflow after expiry. Confirm Paid
   and branding return, selected products suppressed only by the cap can return,
   and intentionally unpublished products stay hidden until explicitly selected.
8. Verify another seller cannot modify the selection and the existing admin,
   pricing, bank settings, payment history and active-Paid instruction guard work.

Remaining risks: approved live schema/RLS/concurrency validation and native
Windows execution; advisory-lock contention and query cost should be observed
under realistic load (normal catalogs are bounded to 100 new records). Cached
browser data can remain visible briefly, but new order validation is independent.
Privileged DB owners/service roles remain trusted. No scheduling job, realtime
publication setup or new credential is required.

Rollback must be forward-only and separately reviewed. Do not drop the selection
column or rewrite old history to simplify recovery. Reverting frontend code
alone does not remove the database RLS/checkout restrictions. A failed apply
transaction rolls back its schema/history changes; a post-commit rollback needs
a new checksummed correction preserving records and publication intent.

## Exact changed-file list

- `database/development/corrections/007_product_publication.sql`
- `database/development/manifest.json`
- `src/lib/publication.ts`
- `src/hooks/use-publication-state.ts`
- `src/hooks/use-store-branding.ts`
- `src/components/PublicationControls.tsx`
- `src/integrations/supabase/types.ts`
- `src/pages/seller/Dashboard.tsx`
- `src/pages/seller/Subscription.tsx`
- `src/pages/store/StoreFront.tsx`
- `scripts/devdb/publication_integration.py`
- `scripts/devdb/integration.py`
- `scripts/devdb/test_offline.py`
- `scripts/browser/publication.mjs`
- `scripts/browser/subscriptions.mjs`
- `scripts/browser/branding.mjs`
- `package.json`
- `docs/SPRINT_4B_PUBLICATION.md`
- `docs/SPRINT_2A_DATABASE_PREPARATION.md`

The pre-existing untracked `docs/SPRINT_2_SUPABASE_VERIFICATION.md` remains untouched
and excluded from the commit.

# Sprint 1 review

Changes are on `sellnova-v2-development`, based on fetched `origin/main` commit
`33834e342fd3ff57c4cf421c2caf3aa94fc8fdb9`. Changes are left in the working tree
for review. Nothing was committed, pushed, merged or deployed.

## Completed

- Registered authenticated Branding, Orders, Reviews and Promotions routes.
  Promotions retains its existing “Discounts” label and entitlement controls.
- Connected the existing public `/review/:token` page so order review links resolve.
- Added Orders, Reviews and Discounts to the seller navigation and included that
  navigation on the existing Dashboard, Analytics and Onboarding screens.
- Fixed Branding's literal-color state inference with explicit string state types.
- Replaced existing lint errors with type-safe equivalents; business rules are unchanged.
- Added a checkout dialog collecting full name, WhatsApp number, delivery address
  (required by the existing RPC), and an optional buyer note.
- Calls `sellnova_create_order` with product IDs and quantities, never trusted
  browser prices. The existing SQL function saves the order and order items in
  one transaction. The UI waits for its response before opening WhatsApp.
- Displays the database-generated reference, item prices, discount and total.
  WhatsApp messages use the returned receipt and buyer details. A retained link
  supports popup-blocked browsers without creating a second order.
- Prevents concurrent submissions with a synchronous guard and disabled form.
  Successful or ambiguous submissions cannot be resubmitted in the same checkout.
  Closing/reopening an unchanged checkout preserves that guard and buyer details.
- Clears the cart only after a valid saved receipt; known save failures retain
  the cart and allow retry. Ambiguous network/server failures tell the buyer to
  contact the seller rather than submit blindly.
- Fixed cart persistence writing an empty cart before saved-cart restoration.

## Validation

Run from `/workspace/tfsales`:

```sh
npm run build
./node_modules/.bin/tsc --noEmit -p tsconfig.app.json
./node_modules/.bin/tsc --noEmit -p tsconfig.node.json
npm run lint
```

Build and both TypeScript checks pass. ESLint passes with 0 errors and 14
pre-existing hook/fast-refresh warnings. Vite reports its existing large-bundle
warning. No rules or assertions were disabled.

All 10 browser regression tests passed in the final run (35.854 seconds), with
no uncaught browser errors or external requests. The browser regression suite uses Python Playwright and system Chromium. Start a
separate Vite server with **mock-only** public configuration (the strings below
are deliberately fake, not credentials):

```sh
VITE_SUPABASE_URL=http://127.0.0.1:54321 \
VITE_SUPABASE_PUBLISHABLE_KEY=mock-public-key \
VITE_STORE_URL=http://127.0.0.1:8081 \
npm run dev -- --host 127.0.0.1 --port 8081 --strictPort
```

In a second terminal:

```sh
python tests/sprint1_browser.py
```

Python Playwright and `/usr/bin/chromium` must be available. `CHROMIUM_PATH` can
select another installed Chromium executable. The test suite intercepts every
backend call, including existing visit/view analytics writes. All external
requests fail closed. WhatsApp opening is captured locally. No test backend
server needs to listen on port 54321.

Coverage includes all eight protected seller routes, authenticated seller
navigation, buyer validation, save-before-WhatsApp sequencing, submitted RPC
arguments, duplicate submission protection, authoritative returned prices,
reference display, receipt recovery, blocked-popup fallback, save failures and
retry, ambiguous failures including close/reopen, malformed success responses,
cart restoration and quantity controls, legacy store lookup, empty stores,
public review routing and the landing page.

## Remaining limitations and database work

- No separate development Supabase project was supplied. Tests use mocks; actual
  PostgreSQL execution, RLS, grants, transaction rollback, entitlements and writes
  have not been integration-tested. Mock results do not establish live database
  readiness or prove the database function is deployed.
- No new database changes or migrations are included or executed. Before a later
  rollout, verify the existing Release 2 schema/RLS and RPC migrations
  (`0002` through `0005`) in a separate development project, especially
  `0003_sellnova_release2_checkout_rpcs.sql`. Do not blindly replay them on production.
- The RPC lacks an idempotency key. Current client guards cover repeated clicks,
  saved receipts and reopening an unchanged checkout. Exactly-once retry after
  reload, changed carts, multiple tabs/devices or lost responses requires a later
  additive database migration with a scoped unique request key and an RPC that
  returns the existing receipt on replay. Receipt state currently lives in memory.
- Payment and delivery remain seller-arranged over WhatsApp. No payment processing
  integration was introduced. Existing coupon/stock/promotion business rules were
  not changed; checkout passes no coupon in this sprint.
- The remaining 14 lint warnings and bundle-size warning are outside this sprint's
  functional fixes. Existing seller feature write flows were not exercised against
  production.

## Files changed

- `src/App.tsx` — seller and public review routes.
- `src/components/SellerNav.tsx` — additional seller destinations.
- `src/components/store/CheckoutDialog.tsx` — checkout and saved receipt.
- `src/pages/store/StoreFront.tsx` — checkout integration and cart persistence.
- `src/pages/seller/Branding.tsx` — state typing.
- `src/pages/seller/Dashboard.tsx` — navigation and safe error typing.
- `src/pages/seller/Analytics.tsx` — shared navigation.
- `src/pages/seller/Onboarding.tsx` — shared navigation.
- `src/contexts/AuthContext.tsx` — typed Supabase auth errors.
- `src/components/ui/command.tsx` — equivalent props type alias.
- `src/components/ui/textarea.tsx` — equivalent props type alias.
- `src/integrations/supabase/previewAuthStorage.ts` — const timeout declaration.
- `src/pages/admin/AdminDashboard.tsx` — inferred query result type.
- `tailwind.config.ts` — equivalent ESM plugin import.
- `tests/sprint1_browser.py` — isolated browser regression suite.
- `docs/SPRINT_1_REVIEW.md` — review notes and reproduction commands.

## Safety

`origin/main` remains at the recorded base commit. No main branch changes,
production Supabase requests/writes, migrations, deployments or merges were
performed during this sprint. Tests use fake accounts, products and order data
only. Environment files, dependency declarations and lockfiles are unchanged.
No credentials or environment values are included in these notes or test output.

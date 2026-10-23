# Public storefront branding and active-Paid payment guard

Prepared 2026-10-23 on `sellnova-v2-development`. Development project:
`sellnova-v2-dev` (`qfcnaceeppgrquoszkor`). No Supabase connection, SQL execution,
remote migration, production operation or deployment was performed.

## Root cause and read-path review

The Store Design editor saves and reloads `store_branding`, but StoreFront fetched
only stores/products and never loaded branding or rendered its logo. Default
CSS variables and a fixed Store icon were therefore always shown. There was no
public branding refresh or logo signing path. This explains why the editor could
retain the saved settings across login while the public storefront ignored them.
The save/editor code and stored records are unchanged.

Repository SQL already grants `sellnova_public_branding(uuid)` to anon and
authenticated, with SECURITY DEFINER and a fixed `pg_catalog` search path. It
returns branding for the exact store ID only when the store is active and its
server-side effective plan allows branding. The effective-plan helper verifies
active subscription state, expiry and plan activation; otherwise it falls back
to Free. The public page must not rely on the visitor's identity or attempt a
private subscription SELECT to decide the seller's entitlement.

The existing store_branding SELECT RLS allows public access for an active,
branding-entitled store, and owner/admin access for editing. The store-logos
bucket is private; a public object URL is not sufficient. Its existing SELECT
policy permits anonymous/authenticated access to logos in a seller's folder
when that seller has an active, entitled public store, plus owner/admin reads.
No bucket is made public and no RLS policy or ACL is widened by this correction.
These are source-review findings; live policy/schema drift remains unverified.

## Frontend correction

`useStoreBranding` loads the existing public RPC for the exact loaded store ID,
validates the response and applies only entitled branding. Logo access uses the
existing storage signing API with a ten-minute signed URL. Missing or failed
logo access shows the Store icon while retaining valid colours; an RPC failure
or non-entitled result restores defaults. Broken image rendering also falls
back safely. Signed URLs are bearer links valid until their TTL expires; they
cannot be instantly revoked by changing a plan, but the page stops rendering
and renewing them when entitlement is lost.

The shared brandingStyle helper supplies primary/accent/background CSS variables,
including the gradient and readable foregrounds. StoreFront now applies those
to its own subtree, renders the saved logo and removes fixed-white header text
that could override a seller's readable foreground. Product dialogs, the cart
sheet and checkout dialog receive the same variables explicitly: Radix portals
render outside the storefront DOM subtree and would otherwise inherit defaults.
No global document theme is changed.

Branding is loaded on store navigation/reload and refreshed on focus, return to a
visible tab and every 60 seconds. Signing is renewed before expiry. Cleanup and
generation checks prevent stale async responses from applying to another store
or replacing newer refresh results. Cross-device changes appear within a minute
or on focus/reload; no realtime publication setup is required.

## Active-Paid payment correction

The seller page shows a disabled Get Payment Instructions button and an active
Paid explanation instead of draft/notification instructions while Paid is active.
Finite unexpired and indefinite legacy active subscriptions are both covered.
The local action handler also refuses invocation in that state. The new policy
supersedes Sprint 4A's early-renewal UI: requests are available after expiry.
Existing payment history remains visible, and quotes/requests are not deleted.

Append-only entry 17:
`database/development/corrections/006_active_paid_payment_guard.sql`.
It follows all sixteen existing entries and redefines only begin_payment and
notify_payment. Both check the exact store's active Paid subscription, including
NULL expiry, and fail before mutation. Expired Paid access can request payment
again. The notifier locks store then request consistently with approval/quote
creation. Existing function signatures, EXECUTE ACLs, authorization, snapshots,
proof validation, duplicate-reference handling and approvals remain intact.
Already pending payments can still be reviewed by admins; this does not discard
money already reported. A stale unnotified draft cannot be submitted while
Paid access is active.

No original migration SQL bytes/checksums are edited. The manifest appends one
new checksum; a safety test pins the entire sixteen-entry prefix. No branding,
logo, product, store, subscription or request data is updated/deleted by 006.
The database guard becomes effective only after separate migration approval and
application. The frontend branding fix uses existing RPCs and needs no branding
migration. Coordinate frontend availability with the guard's approved rollout.

## Validation

Passed on Linux:

- 34 offline tests, including simulated Windows paths and historical byte/order
  integrity; SQL/PLpgSQL static parsing for 17 files / 352 statements.
- Both TypeScript projects, Python compilation and diff checks.
- ESLint: zero errors, 14 existing warnings.
- Production-mode build against injected development configuration; existing
  bundle-size and Browserslist-age warnings remain.
- Browser mocks for both anonymous and authenticated storefront visits: exact
  public RPC/store ID and auth headers, private logo signing/loading, computed
  primary and button colours, portal styles, reload, focus refresh/new logo,
  entitlement loss, denied logo signing and failed RPC fallback. Unexpected
  external requests and owner-only subscription/branding reads fail the test.
- Subscription browser regressions: disabled action for finite and indefinite
  active Paid access, hidden stale payment form, no additional quote RPC call;
  prior pricing/admin review/error mock cases retained.

Prepared synthetic integration checks also cover anon/owner branding RPC and
raw SELECT RLS, expiry hiding public branding while preserving the owner's
record, active/indefinite Paid quote refusal, stale-draft notification refusal
and expired Paid request eligibility. They are not executed remotely. The full
harness still refuses databases with real non-synthetic Auth users; never reset
or remove existing users to run it.

Windows offline commands, from the repository root:

```powershell
$py = '.\.venv\Scripts\python.exe'
& $py -m unittest discover -s scripts/devdb -p 'test*offline.py' -v
& $py scripts/devdb/check_static.py
& $py scripts/devdb/migrate.py --plan
& .\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.app.json
& .\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.node.json
npm run lint
# Existing development-only environment variables are required by Vite's guard:
npm run build
# Once per machine if needed: npm ci; npx playwright install chromium
npm run test:browser
```

Browser tests start isolated local Vite instances on 4174 and 4175 and mock every
Supabase response. Linux can set PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium.
Native Windows and live database semantic verification remain pending.

After separate review, apply entry 17 with the existing guarded migration runner
and approved Session Pooler/CA configuration. Do not replay old files, change
checksums, reset the database or use production. The offline plan alone does not
check remote history. Migration failure rolls back the transaction/history row;
post-commit rollback requires a new reviewed append-only correction, never an
edit to an applied file. No apply command was run here.

After approved release, verify the existing Paid seller's storefront in an
incognito window and authenticated session, logo network request, colours and
focus/reload after editor changes. If live signing fails despite entitlement,
inspect deployed storage policies against the existing development migrations;
do not make the private bucket public as a workaround.

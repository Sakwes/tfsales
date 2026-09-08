# SellNova Release 1 — roadmap

## Done
- [x] Additive migration: `stores.slug`, `stores.whatsapp_phone`, backfilled for all existing stores
- [x] Unique slug + unique lower(store_name) indexes; slug auto-generated on insert/update
- [x] Nigerian phone normalisation (0… → 234…, +234 → 234, international preserved)
- [x] DB triggers: max 12 products per store, max 3 images, price/name/description validation
- [x] Analytics hardening: product/store ownership check, per-minute insert caps, indexes
- [x] Storage: uploads restricted to the seller's own folder, 5MB per-file cap
- [x] Function search paths fixed; SECURITY DEFINER execute revoked where unnecessary
- [x] Leaked-password protection enabled
- [x] Brand normalised to "SellNova"; unsupported traction figures and SMS copy removed
- [x] Landing copy, footer logo alt text, broken sample URL fixed
- [x] Storefront redesign: accessible dialog, card add-to-cart, quantity controls,
      persistent cart, mobile sticky bar, NGN totals, full WhatsApp order message
- [x] Slug-based store links with legacy store-name fallback
- [x] Canonical tags, per-page titles/descriptions, JSON-LD, lazy images
- [x] Focus-visible styles, reduced-motion support, skeleton loading, empty states
- [x] Seller dashboard: role switcher restored, slug links, email/phone display,
      upload type/size validation
- [x] Verification: TypeScript, lint, build, Supabase linter, browser route/cart checks

## Deferred (documented, not built)
- Payments, shipping, subscriptions, social login, customer accounts, inventory counts
- Database-backed order management
- Server-rendered social preview metadata (needs an edge/SSR layer)
- Automatic storage cleanup of orphaned product images (needs a scheduled
  service-role job; not added to avoid exposing privileged credentials)

## Known remaining warnings
- Two Supabase linter warnings about `has_role` being executable by anon/authenticated.
  This is required: public RLS policies on `stores`/`products` call it. Left in place.

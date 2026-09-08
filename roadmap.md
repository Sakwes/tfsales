# SellNova Release 1 Roadmap

## Database (additive only)
- [ ] Add unique `slug` to stores + auto-generate trigger + backfill existing stores
- [ ] Add normalized `whatsapp_phone` column + backfill (0->234, +234->234, keep intl)
- [ ] Enforce max 12 products/store and max 3 images/product via trigger
- [ ] Enforce positive/sane price, valid store name
- [ ] Analytics anti-abuse (dedupe/rate limit inserts)
- [ ] Storage: ownership-scoped upload policy, file type/size limits
- [ ] Fix function search_path, revoke public EXECUTE on definer fns, leaked password protection

## Frontend
- [ ] Brand: SellNova everywhere; remove TechFusion / Sell Novas / fake metrics / SMS copy
- [ ] Landing redesign (navy + gold), fixed sample URL, footer alt text
- [ ] Storefront redesign: accessible dialog, card add-to-cart, qty, persistent cart, mobile sticky bar
- [ ] Slug-based store lookup with legacy name fallback
- [ ] WhatsApp order message + normalized phone
- [ ] Onboarding / dashboard / analytics / admin / auth / legal polish, states
- [ ] A11y: names, focus, keyboard, alt, headings, reduced motion
- [ ] Perf/SEO: lazy images, canonical, JSON-LD

## Verification
- [ ] Build, tsgo, lint, supabase linter, route checks

## Deferred (documented)
- Payments, shipping, subscriptions, social login, customer accounts, inventory, DB order management, server-rendered OG metadata
- Storage image cleanup on product delete (only if safe without service-role in client)

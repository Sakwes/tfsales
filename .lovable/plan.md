# SellNova — Audit and First Improvement Release

Reviewed the live code and the database. Data today is small (4 stores, 1 product, 4 profiles, 1 visit, 0 product views, no duplicate store-name slugs), so corrective changes can be made safely without touching seller data.

## What's wrong today (verified in code/database)

### Trust and copy (fix first, all on the homepage)
- Homepage shows "1000+ Active Sellers", "50K+ Products Listed", "200K+ Monthly Visits" and "Join thousands of sellers" — none of that is real. Remove and replace with honest benefit copy.
- "Secure & Reliable" still says "SMS verification" though sign-up is now email + password.
- Sample store link renders broken across two lines: "https://sellnova.com.ng /yourstore".
- Footer logo has no alt text; footer says "Sell Novas".
- Naming is inconsistent: "Sell Novas" (footer, storefront footer, onboarding terms, Terms page, page-title reset) and "TechFusion Logo" alt text (login, register, forgot password, reset password, resend confirmation, landing). Everything becomes "SellNova".

### Functional gaps
- Storefront looks up a store by turning every hyphen in the URL into a wildcard (`ILIKE` with `_`). Two stores like "K Drive" and "K-Drive" would resolve ambiguously, and `maybeSingle()` then returns nothing — the shopper sees "Store Not Found". No collisions exist yet; fix before it bites.
- Store-name uniqueness is only checked in the app at creation time. Nothing in the database stops two stores taking the same name, and the admin store-name edit does not re-check at all.
- The product detail popup is a hand-built overlay, not a real dialog: no focus trap, no Escape to close, no labelled dialog role, and the close button is hidden on desktop.
- Cart is in-memory only; a page refresh empties it.
- Onboarding logs the signed-in user object to the browser console.
- Onboarding "Back" link points to the dashboard even for a seller who has no store yet.
- Onboarding shows an empty store-URL preview when the site address is not configured.
- Storefront "products available" count is commented out; product grid has no per-card add-to-cart.

### Limits are not enforced where it counts
- Max 12 products and max 3 images are enforced only in the browser (`maxProducts`, `maxImagesPerProduct` in the dashboard). Anyone calling the API directly can exceed both. Nothing in the database enforces either.
- Prices accept any number, including negative or absurd values. No database check.
- Contact phone only requires 10 characters; no Nigerian format normalisation, and WhatsApp links are built by stripping non-digits, which produces a wrong link for a local "0803..." number (missing 234).

### Security and data integrity
- Anyone can insert unlimited rows into visit and product-view tables (policy `check: true`), so analytics can be inflated at will.
- Image upload allows any signed-in user to write anywhere in the bucket; only delete/update are folder-scoped. Files are stored under a random number, no size or file-type limit.
- Database linter flags: two functions without a fixed search path, `SECURITY DEFINER` functions executable by anonymous and signed-in callers, and leaked-password protection turned off.
- Deleting a product leaves its images orphaned in storage.

### Mobile, accessibility, performance, SEO
- Product images have no lazy loading, no width/height, no responsive sizing; full-size uploads are served to phones.
- Icon-only buttons (logout, cart quantity, image arrows, delete) have no accessible names.
- Storefront header phone is white-on-gradient text; contrast needs checking.
- Storefront meta description is set after load only — link previews on WhatsApp/Facebook will not show store details, because previews are generated from the raw HTML. This needs a server-rendered preview to work properly (flagged below).
- No canonical tag, no JSON-LD for stores/products, single H1 not guaranteed on every page.

## Release 1 — what we'll build

Additive and backward compatible. No payments, shipping, or subscriptions. No existing column or table is dropped or renamed.

**A. Brand and honest copy**
Replace every "Sell Novas" / "TechFusion" with "SellNova" across landing, storefront footer, onboarding terms, Terms, Privacy, Support, page titles and all logo alt text. Delete the three fake metrics and the "thousands of sellers" line; replace with concrete value points (free to start, 12 products, WhatsApp orders, works on any phone). Fix the SMS line to describe email confirmation. Fix the broken sample URL.

**B. Store links that always resolve**
Add a `slug` column to stores (nullable, unique, auto-filled from the store name by trigger, backfilled for the 4 existing stores). Storefront looks up by slug first and falls back to the current name match so old shared links keep working. Onboarding and admin both check slug availability before saving.

**C. Enforce the rules in the database**
- Trigger blocking a 13th product per store and more than 3 images per product.
- Price must be greater than zero and within a sane ceiling.
- Store name length and character rules; unique slug.
- Phone stored in normalised international form (new column, backfilled); WhatsApp links built from it so local numbers work.

**D. Harden analytics and uploads**
- Rate-limit visit/product-view inserts per store per short window via trigger, and drop repeat views from the same session client-side.
- Restrict uploads so a signed-in seller can only write inside their own folder; add file-type and size limits; delete a product's images when the product is deleted.
- Fix function search paths, revoke public execute on the definer functions that don't need it, and turn on leaked-password protection.

**E. Storefront conversion (Nigerian market)**
- Real accessible dialog for product detail (Escape, focus trap, labelled).
- Add-to-cart directly from the product card; cart persisted in the browser so a refresh doesn't lose it.
- Naira formatting checked everywhere (already `en-NG`/NGN in `formatCurrency`; apply it consistently).
- Order message to WhatsApp includes store name, item lines, quantities, subtotal and total.
- Sticky cart bar on mobile; product count restored.

**F. Accessibility, performance, SEO pass**
Accessible names for all icon buttons, alt text on every image, visible focus rings, keyboard-operable carousel, lazy-loaded and size-constrained images, canonical tags, store/product JSON-LD, one H1 per page.

## Acceptance criteria
- No occurrence of "TechFusion" or "Sell Novas" remains; no unverifiable statistics on any page.
- Every existing store link still opens the right store after the slug change; a newly created store gets a unique slug and a working link.
- API attempts to add a 13th product, a 4th image, or a zero/negative price are rejected by the database, not just the form.
- A signed-in seller cannot upload into another seller's folder.
- Product dialog opens/closes with keyboard alone; all interactive controls reachable by Tab with a visible focus ring.
- Cart survives a page refresh; WhatsApp order message contains every item, quantity and correct total, and opens correctly for a local 0803-style number.
- Database linter shows no function-search-path or public definer-execute warnings; leaked-password protection on.

## Needs a decision or outside help
- **Link previews on WhatsApp/Facebook** cannot fully work from this client-only app. To show store name, photo and phone in a shared link preview, we need a small server-side preview endpoint. Flagging as a follow-up; say the word and I'll include it.
- **Deleting images on product delete** requires a backend function using the service role — included in scope but worth knowing it adds a server function.
- Phone normalisation writes a new column and backfills existing values — additive, no data lost, but it does rewrite stored phone formats for display.

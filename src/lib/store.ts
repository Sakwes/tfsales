export const APP_NAME = "SellNova";

/** Convert a store name into a URL-safe slug. Mirrors the database slug rules. */
export function slugify(input: string): string {
  return (input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface SlugSource {
  slug?: string | null;
  store_name?: string | null;
}

/** Canonical slug for a store, falling back to a slugified name for legacy rows. */
export function storeSlug(store: SlugSource | null | undefined): string {
  if (!store) return "";
  return store.slug?.trim() || slugify(store.store_name || "");
}

/** Public base URL used for shareable store links. */
export function siteOrigin(): string {
  const configured = import.meta.env.VITE_STORE_URL as string | undefined;
  if (configured && /^https?:\/\//.test(configured)) {
    return configured.replace(/\/+$/, "");
  }
  return typeof window !== "undefined" ? window.location.origin : "";
}

export function storeUrl(store: SlugSource | null | undefined): string {
  return `${siteOrigin()}/store/${storeSlug(store)}`;
}

/**
 * Normalise a Nigerian or international number into WhatsApp dial format.
 * - 0803... -> 234803...
 * - +234803... / 234803... -> 234803...
 * - +44... -> 44... (valid international numbers preserved)
 */
export function normalizeWhatsAppNumber(input: string): string {
  const raw = (input || "").trim();
  if (!raw) return "";

  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("234")) return digits;
  if (digits.startsWith("0")) return `234${digits.slice(1)}`;
  if (raw.startsWith("+")) return digits;
  if (digits.length === 10) return `234${digits}`;
  return digits;
}

export function isValidContactPhone(input: string): boolean {
  const normalized = normalizeWhatsAppNumber(input);
  return normalized.length >= 10 && normalized.length <= 15;
}

/** Display a stored number in a friendly local/international form. */
export function formatPhoneForDisplay(input: string): string {
  const n = normalizeWhatsAppNumber(input);
  if (!n) return "";
  return `+${n}`;
}

export function whatsAppLink(phone: string, message?: string): string {
  const number = normalizeWhatsAppNumber(phone);
  const base = `https://wa.me/${number}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

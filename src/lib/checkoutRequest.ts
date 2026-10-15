import { normalizeWhatsAppNumber } from "@/lib/store";

export interface CheckoutPayload {
  _store_id: string;
  _customer_name: string;
  _customer_phone: string;
  _delivery_address: string;
  _customer_note: string;
  _items: { product_id: string; quantity: number }[];
}

// Local storage contains only a payload digest and UUID; buyer details stay in
// tab-scoped session storage. Both must be durable before a write can be sent.
export async function checkoutRequest(payload: CheckoutPayload) {
  const quantities = new Map<string, number>();
  for (const item of payload._items) {
    const id = item.product_id.toLowerCase();
    quantities.set(id, (quantities.get(id) ?? 0) + item.quantity);
  }
  const canonical = JSON.stringify({
    ...payload,
    _customer_phone: normalizeWhatsAppNumber(payload._customer_phone),
    _items: [...quantities]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([product_id, quantity]) => ({ product_id, quantity })),
  });
  if (!crypto.randomUUID || !crypto.subtle || !navigator.locks) {
    throw new Error(
      "Checkout could not safely save a retry reference. Use a current browser with site storage enabled.",
    );
  }
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  const digest = [...new Uint8Array(bytes)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  const key = `sellnova:checkout:v1:${payload._store_id}:${digest}`;
  return navigator.locks.request(key, () => {
    const valid = (id: string | null) =>
      !!id &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id,
      );
    const active = sessionStorage.getItem(key);
    const shared = localStorage.getItem(key);
    if ((active && !valid(active)) || (shared && !valid(shared))) {
      throw new Error(
        "The saved checkout reference is damaged. Contact the seller before starting another order.",
      );
    }
    const id = active || shared || crypto.randomUUID();
    // Read-back rejects unavailable/full storage before any RPC is made.
    sessionStorage.setItem(key, id);
    if (!shared) localStorage.setItem(key, id);
    if (
      sessionStorage.getItem(key) !== id ||
      (!active && localStorage.getItem(key) !== id)
    ) {
      throw new Error(
        "Checkout could not retain its retry reference. Enable site storage before ordering.",
      );
    }
    return { id, key };
  });
}

export function completeCheckout(request: { id: string; key: string }) {
  // Existing tabs keep their own active UUID and can recover the same saved order.
  // A new checkout after acknowledged success is a new logical order.
  if (localStorage.getItem(request.key) === request.id)
    localStorage.removeItem(request.key);
  if (sessionStorage.getItem(request.key) === request.id)
    sessionStorage.removeItem(request.key);
}

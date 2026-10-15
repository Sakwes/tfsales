import { FormEvent, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  isValidContactPhone,
  normalizeWhatsAppNumber,
  whatsAppLink,
} from "@/lib/store";
import { checkoutRequest, completeCheckout } from "@/lib/checkoutRequest";
import { formatCurrency } from "@/lib/utils";

// Only the database decides product prices, discounts, totals and references.
const receiptSchema = z.object({
  order_reference: z.string().min(1),
  subtotal: z.number().nonnegative(),
  discount_total: z.number().nonnegative(),
  total: z.number().nonnegative(),
  items: z
    .array(
      z.object({
        product_name: z.string(),
        quantity: z.number().int().positive(),
        unit_price: z.number().nonnegative(),
        line_total: z.number().nonnegative(),
      }),
    )
    .nonempty(),
});

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  storeName: string;
  sellerPhone: string;
  storeUrl: string;
  items: { id: string; quantity: number }[];
  onSaved: () => boolean;
}

export function CheckoutDialog({
  open,
  onOpenChange,
  storeId,
  storeName,
  sellerPhone,
  storeUrl,
  items,
  onSaved,
}: Props) {
  const draftKey = `sellnova:buyer-draft:${storeId}`;
  const [buyer, setBuyer] = useState(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(draftKey) || "null");
      if (
        value &&
        [value.name, value.phone, value.address, value.note].every(
          (v) => typeof v === "string",
        )
      )
        return value as {
          name: string;
          phone: string;
          address: string;
          note: string;
        };
    } catch {
      /* Storage failure is handled before submitting. */
    }
    return { name: "", phone: "", address: "", note: "" };
  });
  const { name, phone, address, note } = buyer;
  useEffect(() => {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(buyer));
    } catch {
      /* fail closed on submit */
    }
  }, [buyer, draftKey]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<z.infer<typeof receiptSchema> | null>(
    null,
  );
  const [messageUrl, setMessageUrl] = useState("");
  // Synchronous guard covers clicks before React has rendered the disabled button.
  const inFlight = useRef(false);
  const saved = useRef(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current || saved.current) return;
    if (
      name.trim().length < 2 ||
      !isValidContactPhone(phone) ||
      address.trim().length < 5
    ) {
      setError(
        "Enter your full name, a valid WhatsApp number and a delivery address of at least 5 characters.",
      );
      return;
    }
    if (!items.length || !isValidContactPhone(sellerPhone)) {
      setError(
        "Checkout is unavailable. Please check your cart and the seller's contact details.",
      );
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setError("");
    let sent = false;
    try {
      const payload = {
        _store_id: storeId,
        _customer_name: name.trim(),
        _customer_phone: normalizeWhatsAppNumber(phone),
        _delivery_address: address.trim(),
        _customer_note: note.trim(),
        _items: items.map((item) => ({
          product_id: item.id,
          quantity: item.quantity,
        })),
      };
      const request = await checkoutRequest(payload);
      // Refuse to send if buyer details cannot survive a tab refresh.
      sessionStorage.setItem(draftKey, JSON.stringify(buyer));
      sent = true;
      const {
        data,
        error: rpcError,
        status,
      } = await supabase
        .rpc("sellnova_create_order", {
          ...payload,
          _request_id: request.id,
        })
        .abortSignal(AbortSignal.timeout(20_000));
      if (rpcError) {
        setError(
          status === 0 || status >= 500
            ? "We could not confirm whether your order was saved. Retry with the same details to recover the same order. Changing details starts a different request."
            : `Could not save your order: ${rpcError.message}. Your cart has been kept. WhatsApp has not been opened.`,
        );
        return;
      }
      // Only a valid database receipt is an acknowledged save. Retries retain the UUID.
      const result = receiptSchema.safeParse(data);
      if (!result.success) {
        setError(
          "The server returned an invalid receipt. Retry with the same details to recover the order; WhatsApp has not been opened.",
        );
        return;
      }
      saved.current = true;
      const order = result.data;
      setReceipt(order);
      const message = [
        `Hello ${storeName}, my SellNova order reference is ${order.order_reference}.`,
        `Name: ${name.trim()}`,
        `WhatsApp: +${normalizeWhatsAppNumber(phone)}`,
        `Delivery address: ${address.trim()}`,
        ...(note.trim() ? [`Note: ${note.trim()}`] : []),
        "",
        ...order.items.map(
          (item) =>
            `• ${item.product_name} — ${item.quantity} x ${formatCurrency(item.unit_price)} = ${formatCurrency(item.line_total)}`,
        ),
        `Subtotal: ${formatCurrency(order.subtotal)}`,
        `Discount: ${formatCurrency(order.discount_total)}`,
        `Total: ${formatCurrency(order.total)}`,
        "Payment and delivery to be arranged with the seller.",
        storeUrl,
      ].join("\n");
      const url = whatsAppLink(sellerPhone, message);
      setMessageUrl(url);
      const cartCleared = onSaved();
      if (cartCleared) {
        try {
          completeCheckout(request);
          sessionStorage.removeItem(draftKey);
        } catch {
          /* retain old UUID rather than risk duplicate writes */
        }
      }
      // Browsers may block async popups. The receipt always keeps a usable link.
      try {
        window.open(url, "_blank", "noopener,noreferrer");
      } catch {
        /* use the receipt link */
      }
    } catch (failure) {
      setError(
        sent
          ? "We could not confirm whether your order was saved. Retry with the same details to recover the same order. Your cart has been kept."
          : failure instanceof DOMException
            ? "Checkout could not safely save a retry reference. Enable site storage before ordering."
            : failure instanceof Error
              ? failure.message
              : "Checkout could not safely save a retry reference. Enable site storage before ordering.",
      );
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!inFlight.current) onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{receipt ? "Order saved" : "Checkout"}</DialogTitle>
          <DialogDescription>
            {receipt
              ? "Keep your reference and send the saved order to the seller on WhatsApp."
              : "Your pending order will be saved before WhatsApp opens. Stock is checked and deducted only when the seller confirms; pending orders do not guarantee availability."}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {receipt ? (
          <div className="space-y-4">
            <p role="status">
              Order reference: <strong>{receipt.order_reference}</strong>
            </p>
            <ul className="space-y-2">
              {receipt.items.map((item, index) => (
                <li key={index}>
                  {item.product_name} × {item.quantity} —{" "}
                  {formatCurrency(item.line_total)}
                </li>
              ))}
            </ul>
            <p>Subtotal: {formatCurrency(receipt.subtotal)}</p>
            <p>Discount: {formatCurrency(receipt.discount_total)}</p>
            <p className="font-bold">Total: {formatCurrency(receipt.total)}</p>
            <Button asChild className="w-full">
              <a href={messageUrl} target="_blank" rel="noopener noreferrer">
                Open saved order in WhatsApp
              </a>
            </Button>
            <p className="text-xs text-muted-foreground">
              If WhatsApp did not open, use the button above. It sends this same
              order without creating another one.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <fieldset disabled={saving || saved.current} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="buyer-name">Full name</Label>
                <Input
                  id="buyer-name"
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={100}
                  value={name}
                  onChange={(e) => setBuyer({ ...buyer, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="buyer-phone">WhatsApp number</Label>
                <Input
                  id="buyer-phone"
                  type="tel"
                  autoComplete="tel"
                  required
                  maxLength={30}
                  placeholder="e.g. +2348031234567"
                  value={phone}
                  onChange={(e) =>
                    setBuyer({ ...buyer, phone: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="buyer-address">Delivery address</Label>
                <Textarea
                  id="buyer-address"
                  autoComplete="street-address"
                  required
                  minLength={5}
                  maxLength={500}
                  value={address}
                  onChange={(e) =>
                    setBuyer({ ...buyer, address: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="buyer-note">Note to seller (optional)</Label>
                <Textarea
                  id="buyer-note"
                  maxLength={500}
                  value={note}
                  onChange={(e) => setBuyer({ ...buyer, note: e.target.value })}
                />
              </div>
              <Button type="submit" className="w-full">
                {saving ? "Saving order…" : "Save order and open WhatsApp"}
              </Button>
            </fieldset>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

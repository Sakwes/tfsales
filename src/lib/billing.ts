import type { Database } from "@/integrations/supabase/types";
export type PaymentSettings =
  Database["public"]["Tables"]["platform_settings"]["Row"];
export type PaymentRequest =
  Database["public"]["Tables"]["subscription_requests"]["Row"];
export interface PaymentSnapshot {
  price_ngn: number;
  duration_days: number;
  bank_name: string;
  account_name: string;
  account_number: string;
  payment_instructions: string | null;
}
export function paymentSnapshot(
  request: PaymentRequest,
): PaymentSnapshot | null {
  const s = request.payment_snapshot;
  if (!s || typeof s !== "object" || Array.isArray(s)) return null;
  if (
    typeof s.price_ngn !== "number" ||
    typeof s.duration_days !== "number" ||
    typeof s.bank_name !== "string" ||
    typeof s.account_name !== "string" ||
    typeof s.account_number !== "string"
  )
    return null;
  return s as unknown as PaymentSnapshot;
}
export function message(error: unknown): string {
  return error && typeof error === "object" && "message" in error
    ? String(error.message)
    : "Request failed. Please retry.";
}

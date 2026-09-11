import { supabase } from "@/integrations/supabase/client";

export interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price_ngn: number;
  duration_days: number;
  max_products: number;
  allow_stock: boolean;
  allow_discounts: boolean;
  allow_reviews: boolean;
  allow_branding: boolean;
  allow_advanced_orders: boolean;
  is_core: boolean;
  is_active: boolean;
  sort_order: number;
}

export type SubscriptionStatus =
  | "free"
  | "pending"
  | "active"
  | "rejected"
  | "expired"
  | "suspended";

export interface Subscription {
  store_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  started_at: string | null;
  expires_at: string | null;
}

export const FREE_FALLBACK: Plan = {
  id: "",
  code: "free",
  name: "Free",
  description: null,
  price_ngn: 0,
  duration_days: 3650,
  max_products: 12,
  allow_stock: false,
  allow_discounts: false,
  allow_reviews: false,
  allow_branding: false,
  allow_advanced_orders: false,
  is_core: true,
  is_active: true,
  sort_order: 1
};

/** True when a paid subscription is currently active and unexpired. */
export function isEntitled(sub: Subscription | null): boolean {
  if (!sub) return false;
  if (sub.status !== "active") return false;
  if (!sub.expires_at) return true;
  return new Date(sub.expires_at).getTime() > Date.now();
}

/** The plan whose limits actually apply to a store right now. */
export function effectivePlan(
  plans: Plan[],
  sub: Subscription | null
): Plan {
  const free = plans.find(p => p.code === "free") ?? FREE_FALLBACK;
  if (!isEntitled(sub)) return free;
  return plans.find(p => p.id === sub?.plan_id) ?? free;
}

export const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  free: "Free plan",
  pending: "Payment under review",
  active: "Active",
  rejected: "Payment rejected",
  expired: "Expired",
  suspended: "Suspended"
};

export const STATUS_TONE: Record<SubscriptionStatus, string> = {
  free: "bg-muted text-muted-foreground",
  pending: "bg-primary/15 text-primary",
  active: "bg-emerald-500/15 text-emerald-600",
  rejected: "bg-destructive/15 text-destructive",
  expired: "bg-destructive/15 text-destructive",
  suspended: "bg-destructive/15 text-destructive"
};

export async function loadPlans(): Promise<Plan[]> {
  const { data } = await supabase
    .from("plans")
    .select("*")
    .order("sort_order", { ascending: true });
  return (data ?? []) as unknown as Plan[];
}

export async function loadSubscription(
  storeId: string
): Promise<Subscription | null> {
  const { data } = await supabase
    .from("store_subscriptions")
    .select("store_id, plan_id, status, started_at, expires_at")
    .eq("store_id", storeId)
    .maybeSingle();
  return (data as unknown as Subscription) ?? null;
}

export const ORDER_STATUSES = [
  "new",
  "confirmed",
  "processing",
  "ready",
  "completed",
  "cancelled"
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const NEXT_STATUSES: Record<OrderStatus, OrderStatus[]> = {
  new: ["confirmed", "cancelled"],
  confirmed: ["processing", "cancelled"],
  processing: ["ready", "cancelled"],
  ready: ["completed", "cancelled"],
  completed: [],
  cancelled: []
};

export const ORDER_STATUS_TONE: Record<OrderStatus, string> = {
  new: "bg-primary/15 text-primary",
  confirmed: "bg-blue-500/15 text-blue-600",
  processing: "bg-amber-500/15 text-amber-600",
  ready: "bg-indigo-500/15 text-indigo-600",
  completed: "bg-emerald-500/15 text-emerald-600",
  cancelled: "bg-destructive/15 text-destructive"
};

/** Stock/availability presentation for a product. */
export function stockState(p: {
  is_available: boolean;
  track_stock: boolean;
  stock_quantity: number;
  low_stock_threshold: number;
}): { label: string; tone: string; sellable: boolean } {
  if (!p.is_available)
    return {
      label: "Unavailable",
      tone: "bg-muted text-muted-foreground",
      sellable: false
    };
  if (!p.track_stock)
    return {
      label: "In stock",
      tone: "bg-emerald-500/15 text-emerald-600",
      sellable: true
    };
  if (p.stock_quantity <= 0)
    return {
      label: "Out of stock",
      tone: "bg-destructive/15 text-destructive",
      sellable: false
    };
  if (p.stock_quantity <= p.low_stock_threshold)
    return {
      label: `Low stock — ${p.stock_quantity} left`,
      tone: "bg-amber-500/15 text-amber-600",
      sellable: true
    };
  return {
    label: `In stock — ${p.stock_quantity}`,
    tone: "bg-emerald-500/15 text-emerald-600",
    sellable: true
  };
}

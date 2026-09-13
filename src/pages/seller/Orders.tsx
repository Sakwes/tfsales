import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { SellerPage } from "@/components/SellerPage";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ClipboardList, Copy, MessageCircle, Store, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMetaTags } from "@/hooks/use-meta-tags";
import { formatCurrency } from "@/lib/utils";
import { siteOrigin, whatsAppLink } from "@/lib/store";
import {
  NEXT_STATUSES,
  ORDER_STATUS_TONE,
  OrderStatus
} from "@/lib/plan";

interface OrderItem {
  id: string;
  product_name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
}

interface Order {
  id: string;
  order_reference: string;
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  customer_note: string | null;
  status: OrderStatus;
  subtotal: number;
  discount_total: number;
  delivery_fee: number;
  total: number;
  review_token: string | null;
  review_submitted: boolean;
  created_at: string;
  order_items: OrderItem[];
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  new: "Pending",
  confirmed: "Confirmed",
  processing: "Processing",
  ready: "Ready",
  completed: "Completed",
  cancelled: "Cancelled"
};

const FILTERS: Array<{ value: "all" | OrderStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "new", label: "Pending" },
  { value: "confirmed", label: "Confirmed" },
  { value: "processing", label: "Processing" },
  { value: "ready", label: "Ready" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" }
];

const OrdersPage = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [storeName, setStoreName] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<"all" | OrderStatus>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Order | null>(null);
  const [fee, setFee] = useState("0");
  const [saving, setSaving] = useState(false);

  useMetaTags({
    title: "Orders | SellNova",
    description: "See every order from your store and keep customers updated."
  });

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    const { data: store, error: storeError } = await supabase
      .from("stores")
      .select("id, store_name")
      .eq("seller_id", user.id)
      .maybeSingle();

    if (storeError) {
      setError("We could not load your store. Please try again.");
      setLoading(false);
      return;
    }
    if (!store) {
      setLoading(false);
      return;
    }

    setStoreId(store.id);
    setStoreName(store.store_name);

    const { data, error: ordersError } = await supabase
      .from("orders")
      .select(
        "id, order_reference, customer_name, customer_phone, delivery_address, customer_note, status, subtotal, discount_total, delivery_fee, total, review_token, review_submitted, created_at, order_items(id, product_name, unit_price, quantity, line_total)"
      )
      .eq("store_id", store.id)
      .order("created_at", { ascending: false });

    if (ordersError) {
      setError("We could not load your orders. Please try again.");
      setLoading(false);
      return;
    }

    setOrders((data ?? []) as unknown as Order[]);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter(o => {
      if (filter !== "all" && o.status !== filter) return false;
      if (!q) return true;
      return (
        o.order_reference.toLowerCase().includes(q) ||
        o.customer_name.toLowerCase().includes(q) ||
        o.customer_phone.includes(q)
      );
    });
  }, [orders, filter, query]);

  const open = (order: Order) => {
    setSelected(order);
    setFee(String(order.delivery_fee ?? 0));
  };

  const refreshSelected = async (id: string) => {
    await load();
    const { data } = await supabase
      .from("orders")
      .select(
        "id, order_reference, customer_name, customer_phone, delivery_address, customer_note, status, subtotal, discount_total, delivery_fee, total, review_token, review_submitted, created_at, order_items(id, product_name, unit_price, quantity, line_total)"
      )
      .eq("id", id)
      .maybeSingle();
    if (data) setSelected(data as unknown as Order);
  };

  const saveFee = async () => {
    if (!selected) return;
    const value = Number(fee);
    if (!Number.isFinite(value) || value < 0) {
      toast.error("Enter a delivery fee of zero or more");
      return;
    }
    setSaving(true);
    const { error: updateError } = await supabase
      .from("orders")
      .update({ delivery_fee: value })
      .eq("id", selected.id);
    setSaving(false);
    if (updateError) {
      toast.error(updateError.message || "Could not save the delivery fee");
      return;
    }
    toast.success("Delivery fee saved");
    await refreshSelected(selected.id);
  };

  const changeStatus = async (next: OrderStatus) => {
    if (!selected) return;
    setSaving(true);
    const { error: updateError } = await supabase
      .from("orders")
      .update({ status: next })
      .eq("id", selected.id);
    setSaving(false);
    if (updateError) {
      toast.error(updateError.message || "Could not update this order");
      return;
    }
    toast.success(`Order marked ${STATUS_LABEL[next].toLowerCase()}`);
    await refreshSelected(selected.id);
  };

  const messageCustomer = (order: Order) => {
    const message = [
      `Hello ${order.customer_name}, this is ${storeName}.`,
      `About your order ${order.order_reference}:`,
      `Total so far: ${formatCurrency(order.total)}`
    ].join("\n");
    window.open(whatsAppLink(order.customer_phone, message), "_blank", "noopener");
  };

  const copyReviewLink = async (order: Order) => {
    if (!order.review_token) return;
    const link = `${siteOrigin()}/review/${order.review_token}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Review link copied");
    } catch {
      toast.error("Could not copy. Long-press the link to copy it.");
    }
  };

  if (loading) {
    return (
      <SellerPage title="Orders" description="Loading your orders…">
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
        <span className="sr-only" role="status">
          Loading orders
        </span>
      </SellerPage>
    );
  }

  if (error) {
    return (
      <SellerPage title="Orders">
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button className="mt-4" onClick={load}>
          Try again
        </Button>
      </SellerPage>
    );
  }

  if (!storeId) {
    return (
      <SellerPage title="Orders">
        <Card className="p-10 text-center">
          <Store className="h-14 w-14 mx-auto mb-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-xl font-semibold mb-2">Set up your store first</h2>
          <p className="text-muted-foreground mb-6">
            Orders appear here once your store is live.
          </p>
          <Button asChild variant="hero">
            <Link to="/seller/onboarding">Set up store</Link>
          </Button>
        </Card>
      </SellerPage>
    );
  }

  return (
    <SellerPage
      title="Orders"
      description="Every order your customers send is saved here before WhatsApp opens.">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter orders by status">
          {FILTERS.map(f => (
            <Button
              key={f.value}
              size="sm"
              variant={filter === f.value ? "hero" : "outline"}
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}>
              {f.label}
            </Button>
          ))}
        </div>
        <div className="relative sm:w-72">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search reference, name or phone"
            aria-label="Search orders"
            className="pl-9"
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <Card className="p-12 text-center">
          <ClipboardList
            className="h-14 w-14 mx-auto mb-4 text-muted-foreground"
            aria-hidden="true"
          />
          <h2 className="text-xl font-semibold mb-2">No orders to show</h2>
          <p className="text-muted-foreground">
            When a customer checks out on your store page, the order appears here.
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {visible.map(order => (
            <li key={order.id}>
              <Card className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold">{order.order_reference}</p>
                    <Badge className={ORDER_STATUS_TONE[order.status]} variant="secondary">
                      {STATUS_LABEL[order.status]}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground truncate">
                    {order.customer_name} · {order.customer_phone} ·{" "}
                    {new Date(order.created_at).toLocaleString("en-NG")}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <p className="font-bold whitespace-nowrap">{formatCurrency(order.total)}</p>
                  <Button size="sm" variant="outline" onClick={() => open(order)}>
                    View
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!selected} onOpenChange={o => !o && setSelected(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>Order {selected.order_reference}</DialogTitle>
                <DialogDescription>
                  Placed {new Date(selected.created_at).toLocaleString("en-NG")}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="rounded-lg border p-3 text-sm space-y-1">
                  <p className="font-medium">{selected.customer_name}</p>
                  <p className="text-muted-foreground">{selected.customer_phone}</p>
                  <p className="text-muted-foreground">{selected.delivery_address}</p>
                  {selected.customer_note && (
                    <p className="text-muted-foreground">Note: {selected.customer_note}</p>
                  )}
                </div>

                <ul className="space-y-2 text-sm">
                  {selected.order_items?.map(item => (
                    <li key={item.id} className="flex justify-between gap-3">
                      <span className="min-w-0 truncate">
                        {item.product_name} × {item.quantity}
                      </span>
                      <span className="whitespace-nowrap">
                        {formatCurrency(item.line_total)}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="border-t pt-3 text-sm space-y-1">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span>{formatCurrency(selected.subtotal)}</span>
                  </div>
                  {selected.discount_total > 0 && (
                    <div className="flex justify-between text-emerald-600">
                      <span>Discount</span>
                      <span>-{formatCurrency(selected.discount_total)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>Delivery fee</span>
                    <span>{formatCurrency(selected.delivery_fee)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-base">
                    <span>Total</span>
                    <span className="text-primary">{formatCurrency(selected.total)}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="fee">Delivery fee (₦)</Label>
                  <div className="flex gap-2">
                    <Input
                      id="fee"
                      type="number"
                      min="0"
                      step="0.01"
                      value={fee}
                      onChange={e => setFee(e.target.value)}
                    />
                    <Button variant="outline" onClick={saveFee} disabled={saving}>
                      Save
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 border-t pt-4">
                  {NEXT_STATUSES[selected.status].map(next => (
                    <Button
                      key={next}
                      size="sm"
                      variant={next === "cancelled" ? "destructive" : "hero"}
                      disabled={saving}
                      onClick={() => changeStatus(next)}>
                      Mark {STATUS_LABEL[next].toLowerCase()}
                    </Button>
                  ))}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => messageCustomer(selected)}>
                    <MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                    Message customer
                  </Button>
                  {selected.status === "completed" &&
                    selected.review_token &&
                    !selected.review_submitted && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => copyReviewLink(selected)}>
                        <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
                        Copy review link
                      </Button>
                    )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </SellerPage>
  );
};

export default OrdersPage;

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { SellerPage } from "@/components/SellerPage";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { toast } from "sonner";
import { Lock, Percent, Plus, Store, Trash2, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMetaTags } from "@/hooks/use-meta-tags";
import { formatCurrency } from "@/lib/utils";
import { effectivePlan, loadPlans, loadSubscription } from "@/lib/plan";

interface Promotion {
  id: string;
  name: string;
  discount_type: "percent" | "fixed";
  value: number;
  scope: "store" | "product";
  product_id: string | null;
  coupon_code: string | null;
  starts_at: string | null;
  ends_at: string | null;
  usage_limit: number | null;
  used_count: number;
  min_order: number;
  is_active: boolean;
}

interface ProductOption {
  id: string;
  name: string;
}

const emptyForm = {
  name: "",
  discount_type: "percent" as "percent" | "fixed",
  value: "10",
  scope: "store" as "store" | "product",
  product_id: "",
  coupon_code: "",
  starts_at: "",
  ends_at: "",
  usage_limit: "",
  min_order: "0",
  is_active: true
};

const toLocalInput = (iso: string | null) =>
  iso ? new Date(iso).toISOString().slice(0, 16) : "";

const PromotionsPage = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [planName, setPlanName] = useState("Free");
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useMetaTags({
    title: "Discounts | SellNova",
    description: "Create storewide or product discounts and coupon codes."
  });

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    const { data: store, error: storeError } = await supabase
      .from("stores")
      .select("id")
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

    const [plans, sub, promos, prods] = await Promise.all([
      loadPlans(),
      loadSubscription(store.id),
      supabase
        .from("promotions")
        .select("*")
        .eq("store_id", store.id)
        .order("created_at", { ascending: false }),
      supabase.from("products").select("id, name").eq("store_id", store.id)
    ]);

    const plan = effectivePlan(plans, sub);
    setAllowed(plan.allow_discounts);
    setPlanName(plan.name);
    setPromotions((promos.data ?? []) as unknown as Promotion[]);
    setProducts((prods.data ?? []) as ProductOption[]);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setForm(emptyForm);
    setEditingId(null);
    setDialogOpen(true);
  };

  const openEdit = (p: Promotion) => {
    setForm({
      name: p.name,
      discount_type: p.discount_type,
      value: String(p.value),
      scope: p.scope,
      product_id: p.product_id ?? "",
      coupon_code: p.coupon_code ?? "",
      starts_at: toLocalInput(p.starts_at),
      ends_at: toLocalInput(p.ends_at),
      usage_limit: p.usage_limit ? String(p.usage_limit) : "",
      min_order: String(p.min_order),
      is_active: p.is_active
    });
    setEditingId(p.id);
    setDialogOpen(true);
  };

  const validate = (): string | null => {
    if (form.name.trim().length < 2) return "Give this discount a name";
    const value = Number(form.value);
    if (!Number.isFinite(value) || value <= 0) return "Enter a discount greater than zero";
    if (form.discount_type === "percent" && value > 90)
      return "A percentage discount cannot be more than 90%";
    if (form.scope === "product" && !form.product_id)
      return "Choose the product this discount applies to";
    if (form.coupon_code && form.coupon_code.trim().length < 3)
      return "A coupon code needs at least 3 characters";
    if (form.starts_at && form.ends_at && new Date(form.ends_at) <= new Date(form.starts_at))
      return "The end date must be after the start date";
    if (Number(form.min_order) < 0) return "Minimum order cannot be negative";
    if (form.usage_limit && Number(form.usage_limit) < 1)
      return "Usage limit must be at least 1";
    return null;
  };

  const save = async () => {
    if (!storeId) return;
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }

    setSaving(true);
    const payload = {
      store_id: storeId,
      name: form.name.trim(),
      discount_type: form.discount_type,
      value: Number(form.value),
      scope: form.scope,
      product_id: form.scope === "product" ? form.product_id : null,
      coupon_code: form.coupon_code.trim() ? form.coupon_code.trim().toUpperCase() : null,
      starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
      ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
      usage_limit: form.usage_limit ? Number(form.usage_limit) : null,
      min_order: Number(form.min_order) || 0,
      is_active: form.is_active
    };

    const { error: saveError } = editingId
      ? await supabase.from("promotions").update(payload).eq("id", editingId)
      : await supabase.from("promotions").insert(payload);

    setSaving(false);
    if (saveError) {
      toast.error(saveError.message || "Could not save this discount");
      return;
    }
    toast.success(editingId ? "Discount updated" : "Discount created");
    setDialogOpen(false);
    await load();
  };

  const toggleActive = async (p: Promotion) => {
    const { error: toggleError } = await supabase
      .from("promotions")
      .update({ is_active: !p.is_active })
      .eq("id", p.id);
    if (toggleError) {
      toast.error(toggleError.message || "Could not update this discount");
      return;
    }
    await load();
  };

  const remove = async (p: Promotion) => {
    const { error: deleteError } = await supabase
      .from("promotions")
      .delete()
      .eq("id", p.id);
    if (deleteError) {
      toast.error(deleteError.message || "Could not delete this discount");
      return;
    }
    toast.success("Discount removed");
    await load();
  };

  if (loading) {
    return (
      <SellerPage title="Discounts" description="Loading your discounts…">
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
        <span className="sr-only" role="status">
          Loading discounts
        </span>
      </SellerPage>
    );
  }

  if (error) {
    return (
      <SellerPage title="Discounts">
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
      <SellerPage title="Discounts">
        <Card className="p-10 text-center">
          <Store className="h-14 w-14 mx-auto mb-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-xl font-semibold mb-2">Set up your store first</h2>
          <Button asChild variant="hero" className="mt-4">
            <Link to="/seller/onboarding">Set up store</Link>
          </Button>
        </Card>
      </SellerPage>
    );
  }

  return (
    <SellerPage
      title="Discounts"
      description="Reward customers with a storewide deal, a product deal or a coupon code."
      actions={
        allowed ? (
          <Button variant="hero" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            New discount
          </Button>
        ) : undefined
      }>
      {!allowed && (
        <Alert className="mb-6">
          <Lock className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>Discounts are a paid feature</AlertTitle>
          <AlertDescription className="flex flex-col sm:flex-row sm:items-center gap-3">
            <span>
              You are on the {planName} plan. Anything you saved before stays safe and works
              again when your plan is active.
            </span>
            <Button asChild size="sm" variant="hero" className="shrink-0">
              <Link to="/seller/subscription">View plans</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {promotions.length === 0 ? (
        <Card className="p-12 text-center">
          <Percent className="h-14 w-14 mx-auto mb-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-xl font-semibold mb-2">No discounts yet</h2>
          <p className="text-muted-foreground">
            Create a discount to encourage bigger orders.
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {promotions.map(p => (
            <li key={p.id}>
              <Card className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{p.name}</p>
                    <Badge variant="secondary">
                      {p.discount_type === "percent"
                        ? `${p.value}% off`
                        : `${formatCurrency(p.value)} off`}
                    </Badge>
                    {p.coupon_code && <Badge variant="outline">{p.coupon_code}</Badge>}
                    {!p.is_active && <Badge variant="outline">Paused</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {p.scope === "store" ? "Whole store" : "One product"}
                    {p.min_order > 0 && ` · from ${formatCurrency(p.min_order)}`}
                    {p.ends_at && ` · ends ${new Date(p.ends_at).toLocaleDateString("en-NG")}`}
                    {p.usage_limit && ` · used ${p.used_count}/${p.usage_limit}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={p.is_active}
                    disabled={!allowed}
                    onCheckedChange={() => toggleActive(p)}
                    aria-label={`${p.is_active ? "Pause" : "Activate"} ${p.name}`}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!allowed}
                    onClick={() => openEdit(p)}>
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">Edit {p.name}</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={!allowed}
                    onClick={() => remove(p)}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">Delete {p.name}</span>
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit discount" : "New discount"}</DialogTitle>
            <DialogDescription>
              Only one discount applies to an order: the best automatic one, or the coupon a
              customer enters.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="promoName">Name</Label>
              <Input
                id="promoName"
                value={form.name}
                maxLength={80}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="Weekend sale"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="promoType">Discount type</Label>
                <Select
                  value={form.discount_type}
                  onValueChange={v =>
                    setForm({ ...form, discount_type: v as "percent" | "fixed" })
                  }>
                  <SelectTrigger id="promoType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Percentage off</SelectItem>
                    <SelectItem value="fixed">Fixed amount off</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="promoValue">
                  {form.discount_type === "percent" ? "Percentage (1–90)" : "Amount (₦)"}
                </Label>
                <Input
                  id="promoValue"
                  type="number"
                  min="1"
                  step="0.01"
                  value={form.value}
                  onChange={e => setForm({ ...form, value: e.target.value })}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="promoScope">Applies to</Label>
                <Select
                  value={form.scope}
                  onValueChange={v => setForm({ ...form, scope: v as "store" | "product" })}>
                  <SelectTrigger id="promoScope">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="store">Whole store</SelectItem>
                    <SelectItem value="product">One product</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.scope === "product" && (
                <div className="space-y-2">
                  <Label htmlFor="promoProduct">Product</Label>
                  <Select
                    value={form.product_id}
                    onValueChange={v => setForm({ ...form, product_id: v })}>
                    <SelectTrigger id="promoProduct">
                      <SelectValue placeholder="Choose a product" />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map(p => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="promoCoupon">Coupon code (optional)</Label>
              <Input
                id="promoCoupon"
                value={form.coupon_code}
                maxLength={24}
                onChange={e =>
                  setForm({ ...form, coupon_code: e.target.value.toUpperCase() })
                }
                placeholder="SAVE10"
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to apply the discount automatically.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="promoStart">Starts</Label>
                <Input
                  id="promoStart"
                  type="datetime-local"
                  value={form.starts_at}
                  onChange={e => setForm({ ...form, starts_at: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="promoEnd">Ends</Label>
                <Input
                  id="promoEnd"
                  type="datetime-local"
                  value={form.ends_at}
                  onChange={e => setForm({ ...form, ends_at: e.target.value })}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="promoMin">Minimum order (₦)</Label>
                <Input
                  id="promoMin"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.min_order}
                  onChange={e => setForm({ ...form, min_order: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="promoLimit">Usage limit (optional)</Label>
                <Input
                  id="promoLimit"
                  type="number"
                  min="1"
                  value={form.usage_limit}
                  onChange={e => setForm({ ...form, usage_limit: e.target.value })}
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Switch
                id="promoActive"
                checked={form.is_active}
                onCheckedChange={v => setForm({ ...form, is_active: v })}
              />
              <Label htmlFor="promoActive">Active</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="hero" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save discount"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SellerPage>
  );
};

export default PromotionsPage;

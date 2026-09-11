import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SellerPage } from "@/components/SellerPage";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Check, Upload, Info, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency, cn } from "@/lib/utils";
import { useMetaTags } from "@/hooks/use-meta-tags";
import {
  Plan,
  Subscription as Sub,
  STATUS_LABEL,
  STATUS_TONE,
  effectivePlan,
  isEntitled,
  loadPlans,
  loadSubscription
} from "@/lib/plan";

interface Settings {
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
  payment_instructions: string | null;
}

interface RequestRow {
  id: string;
  plan_id: string;
  amount: number;
  payment_reference: string;
  status: string;
  decision_reason: string | null;
  created_at: string;
}

const featureList = (p: Plan) => [
  `Up to ${p.max_products} products`,
  "Availability controls and WhatsApp ordering",
  "Saved orders with order references",
  p.allow_stock ? "Stock quantities and low-stock alerts" : null,
  p.allow_discounts ? "Discounts, coupons and promotions" : null,
  p.allow_reviews ? "Verified customer reviews" : null,
  p.allow_branding ? "Your own store colours and logo" : null,
  p.allow_advanced_orders ? "Enhanced orders and analytics" : "Basic analytics"
].filter(Boolean) as string[];

const SubscriptionPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [sub, setSub] = useState<Sub | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [productCount, setProductCount] = useState(0);

  const [reference, setReference] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useMetaTags({
    title: "Your plan | SellNova",
    description: "Compare SellNova plans and upgrade your store."
  });

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const { data: store } = await supabase
      .from("stores")
      .select("id")
      .eq("seller_id", user.id)
      .maybeSingle();

    if (!store) {
      navigate("/seller/onboarding");
      return;
    }
    setStoreId(store.id);

    const [planRows, subRow, settingRow, reqRows, count] = await Promise.all([
      loadPlans(),
      loadSubscription(store.id),
      supabase
        .from("platform_settings")
        .select("bank_name, account_name, account_number, payment_instructions")
        .maybeSingle(),
      supabase
        .from("subscription_requests")
        .select("id, plan_id, amount, payment_reference, status, decision_reason, created_at")
        .eq("store_id", store.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("store_id", store.id)
    ]);

    setPlans(planRows);
    setSub(subRow);
    setSettings((settingRow.data as Settings) ?? null);
    setRequests((reqRows.data ?? []) as RequestRow[]);
    setProductCount(count.count ?? 0);
    setLoading(false);
  }, [user, navigate]);

  useEffect(() => {
    load();
  }, [load]);

  const current = useMemo(() => effectivePlan(plans, sub), [plans, sub]);
  const paidPlan = plans.find(p => p.code === "paid");
  const pending = requests.find(r => r.status === "pending");
  const lastRejected = requests.find(r => r.status === "rejected");

  const bankConfigured = Boolean(
    settings?.bank_name && settings?.account_name && settings?.account_number
  );
  const priceConfigured = (paidPlan?.price_ngn ?? 0) > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeId || !paidPlan || !user) return;

    const ref = reference.trim();
    if (ref.length < 4 || ref.length > 80) {
      toast.error("Enter the payment reference from your bank transfer.");
      return;
    }
    if (proof) {
      const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
      if (!allowed.includes(proof.type)) {
        toast.error("Proof must be a JPG, PNG, WebP or PDF file.");
        return;
      }
      if (proof.size > 5 * 1024 * 1024) {
        toast.error("Proof must be smaller than 5MB.");
        return;
      }
    }

    setSubmitting(true);
    try {
      let proofPath: string | null = null;
      if (proof) {
        const ext = proof.name.split(".").pop()?.toLowerCase() || "jpg";
        proofPath = `${user.id}/${storeId}-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("payment-proofs")
          .upload(proofPath, proof, { upsert: false });
        if (upErr) throw upErr;
      }

      const { error } = await supabase.from("subscription_requests").insert({
        store_id: storeId,
        plan_id: paidPlan.id,
        amount: paidPlan.price_ngn,
        payment_reference: ref,
        proof_path: proofPath,
        status: "pending"
      });
      if (error) throw error;

      toast.success("Payment sent for review. We'll confirm shortly.");
      setReference("");
      setProof(null);
      await load();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not send your request."
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <SellerPage title="Your plan">
        <div className="grid md:grid-cols-2 gap-6">
          <Skeleton className="h-72 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      </SellerPage>
    );
  }

  const status = sub?.status ?? "free";
  const usagePct = Math.min(
    100,
    Math.round((productCount / Math.max(current.max_products, 1)) * 100)
  );

  return (
    <SellerPage
      title="Your plan"
      description="Compare plans, track your usage and upgrade when you're ready.">
      <Card className="p-6 mb-8">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <h2 className="text-xl font-semibold">{current.name} plan</h2>
          <span
            className={cn(
              "text-xs font-semibold px-2.5 py-1 rounded-full",
              STATUS_TONE[status]
            )}>
            {STATUS_LABEL[status]}
          </span>
        </div>

        {isEntitled(sub) && sub?.expires_at && (
          <p className="text-sm text-muted-foreground mb-4">
            Active until {new Date(sub.expires_at).toLocaleDateString()}.
          </p>
        )}
        {status === "expired" && (
          <p className="text-sm text-destructive mb-4">
            Your paid plan has expired. Your saved settings and stock numbers are
            kept — renew to use them again.
          </p>
        )}
        {status === "suspended" && (
          <p className="text-sm text-destructive mb-4">
            Your plan is suspended. Please contact support.
          </p>
        )}

        <div className="max-w-md">
          <div className="flex justify-between text-sm mb-1">
            <span>Products used</span>
            <span className="font-medium">
              {productCount} of {current.max_products}
            </span>
          </div>
          <div
            className="h-2 rounded-full bg-muted overflow-hidden"
            role="progressbar"
            aria-valuenow={productCount}
            aria-valuemin={0}
            aria-valuemax={current.max_products}
            aria-label="Products used">
            <div
              className="h-full bg-primary"
              style={{ width: `${usagePct}%` }}
            />
          </div>
          {productCount >= current.max_products && (
            <p className="text-sm text-destructive mt-2">
              You've reached your product limit. Your existing products stay
              online — upgrade to add more.
            </p>
          )}
        </div>
      </Card>

      <div className="grid md:grid-cols-2 gap-6 mb-8">
        {plans.map(plan => {
          const isCurrent = plan.id === current.id;
          return (
            <Card
              key={plan.id}
              className={cn(
                "p-6 flex flex-col",
                isCurrent && "ring-2 ring-primary"
              )}>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-xl font-bold">{plan.name}</h3>
                {plan.code === "paid" ? (
                  priceConfigured ? (
                    <p className="text-lg font-bold text-primary">
                      {formatCurrency(plan.price_ngn)}
                      <span className="text-sm font-normal text-muted-foreground">
                        {" "}
                        / {plan.duration_days} days
                      </span>
                    </p>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      Price coming soon
                    </span>
                  )
                ) : (
                  <p className="text-lg font-bold text-primary">Free</p>
                )}
              </div>
              {plan.description && (
                <p className="text-sm text-muted-foreground mt-2">
                  {plan.description}
                </p>
              )}
              <ul className="mt-4 space-y-2 flex-1">
                {featureList(plan).map(f => (
                  <li key={f} className="flex gap-2 text-sm">
                    <Check
                      className="h-4 w-4 text-primary shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                    {f}
                  </li>
                ))}
              </ul>
              {isCurrent && (
                <p className="mt-4 text-sm font-medium text-primary">
                  Your current plan
                </p>
              )}
            </Card>
          );
        })}
      </div>

      {paidPlan && !isEntitled(sub) && (
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-1">Upgrade to Paid</h2>
          <p className="text-muted-foreground text-sm mb-6">
            Pay by bank transfer, then send us the details. We confirm manually,
            usually within a day.
          </p>

          {!bankConfigured || !priceConfigured ? (
            <Alert>
              <Info className="h-4 w-4" aria-hidden="true" />
              <AlertTitle>Upgrades aren't open yet</AlertTitle>
              <AlertDescription>
                Our payment details are still being set up. Please check back
                shortly — nothing to do for now.
              </AlertDescription>
            </Alert>
          ) : pending ? (
            <Alert>
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              <AlertTitle>Payment under review</AlertTitle>
              <AlertDescription>
                We received reference{" "}
                <strong>{pending.payment_reference}</strong> on{" "}
                {new Date(pending.created_at).toLocaleDateString()}. You'll be
                upgraded as soon as it's confirmed.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {lastRejected && (
                <Alert variant="destructive" className="mb-6">
                  <AlertTitle>Your last payment wasn't confirmed</AlertTitle>
                  <AlertDescription>
                    {lastRejected.decision_reason ||
                      "We couldn't match that payment. Please check the details and try again."}
                  </AlertDescription>
                </Alert>
              )}

              <div className="rounded-lg border bg-muted/40 p-4 mb-6 text-sm space-y-1">
                <p className="font-semibold mb-2">
                  Transfer {formatCurrency(paidPlan.price_ngn)} to:
                </p>
                <p>
                  <span className="text-muted-foreground">Bank: </span>
                  {settings?.bank_name}
                </p>
                <p>
                  <span className="text-muted-foreground">Account name: </span>
                  {settings?.account_name}
                </p>
                <p>
                  <span className="text-muted-foreground">Account number: </span>
                  {settings?.account_number}
                </p>
                {settings?.payment_instructions && (
                  <p className="pt-2 text-muted-foreground">
                    {settings.payment_instructions}
                  </p>
                )}
              </div>

              <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
                <div>
                  <Label htmlFor="reference">Payment reference *</Label>
                  <Input
                    id="reference"
                    value={reference}
                    onChange={e => setReference(e.target.value)}
                    maxLength={80}
                    required
                    placeholder="e.g. the narration or transaction ID"
                  />
                </div>
                <div>
                  <Label htmlFor="proof">Payment proof (optional)</Label>
                  <Input
                    id="proof"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={e => setProof(e.target.files?.[0] ?? null)}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    A screenshot or receipt, up to 5MB. Only you and our team can
                    see it.
                  </p>
                </div>
                <Button
                  type="submit"
                  variant="hero"
                  disabled={submitting}
                  className="w-full sm:w-auto">
                  <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
                  {submitting ? "Sending…" : "Send for review"}
                </Button>
              </form>
            </>
          )}
        </Card>
      )}

      {requests.length > 0 && (
        <Card className="p-6 mt-8">
          <h2 className="text-lg font-semibold mb-4">Payment history</h2>
          <ul className="divide-y">
            {requests.map(r => (
              <li
                key={r.id}
                className="py-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                <div>
                  <p className="font-medium">{r.payment_reference}</p>
                  <p className="text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()} ·{" "}
                    {formatCurrency(r.amount)}
                  </p>
                  {r.decision_reason && (
                    <p className="text-muted-foreground">{r.decision_reason}</p>
                  )}
                </div>
                <span className="capitalize font-medium">{r.status}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </SellerPage>
  );
};

export default SubscriptionPage;

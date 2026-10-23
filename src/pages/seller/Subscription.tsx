import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SellerPage } from "@/components/SellerPage";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency } from "@/lib/utils";
import { effectivePlan, isEntitled, Plan, Subscription } from "@/lib/plan";
import {
  message,
  paymentSnapshot,
  PaymentRequest,
  PaymentSettings,
} from "@/lib/billing";

export default function SubscriptionPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [settings, setSettings] = useState<PaymentSettings | null>(null);
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [productCount, setProductCount] = useState(0);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reference, setReference] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const load = useCallback(async () => {
    if (!user) return;
    try {
      setError("");
      const store = await supabase
        .from("stores")
        .select("id")
        .eq("seller_id", user.id)
        .maybeSingle();
      if (store.error) throw store.error;
      if (!store.data) {
        navigate("/seller/onboarding");
        return;
      }
      setStoreId(store.data.id);
      const [p, s, bank, history, products] = await Promise.all([
        supabase.from("plans").select("*").order("sort_order"),
        supabase
          .from("store_subscriptions")
          .select("store_id,plan_id,status,started_at,expires_at")
          .eq("store_id", store.data.id)
          .maybeSingle(),
        supabase.from("platform_settings").select("*").single(),
        supabase
          .from("subscription_requests")
          .select("*")
          .eq("store_id", store.data.id)
          .order("created_at", { ascending: false }),
        supabase.from("products").select("id", { count: "exact", head: true }).eq("store_id", store.data.id),
      ]);
      if (p.error) throw p.error;
      if (s.error) throw s.error;
      if (bank.error) throw bank.error;
      if (history.error) throw history.error;
      if (products.error) throw products.error;
      setPlans(p.data);
      setSub(s.data as Subscription | null);
      setSettings(bank.data);
      setRequests(history.data);
      setProductCount(products.count ?? 0);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, [user, navigate]);
  useEffect(() => {
    void load();
  }, [load]);
  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      await load();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(false);
    }
  };
  const draft = requests.find((r) => r.status === "draft");
  const pending = requests.find((r) => r.status === "pending");
  const snapshot = draft ? paymentSnapshot(draft) : null;
  const current = effectivePlan(plans, sub);
  const paid = plans.find((p) => p.code === "paid");
  const notify = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft || !user) return;
    const ref = reference.trim();
    if (ref.length < 4 || ref.length > 80) {
      toast.error("Enter a transfer reference of 4–80 characters.");
      return;
    }
    if (
      proof &&
      (!["image/jpeg", "image/png", "application/pdf"].includes(proof.type) ||
        proof.size > 5 * 1024 * 1024)
    ) {
      toast.error("Upload a JPG, PNG or PDF up to 5MB.");
      return;
    }
    await act(async () => {
      let path: string | null = null;
      if (proof) {
        const ext =
          proof.type === "application/pdf"
            ? "pdf"
            : proof.type === "image/png"
              ? "png"
              : "jpg";
        path = `${user.id}/${draft.id}-${crypto.randomUUID()}.${ext}`;
        const upload = await supabase.storage
          .from("payment-proofs")
          .upload(path, proof, { upsert: false });
        if (upload.error) throw upload.error;
      }
      const result = await supabase.rpc("sellnova_notify_payment", {
        _request_id: draft.id,
        _reference: ref,
        _proof_path: path,
      });
      if (result.error) throw result.error;
      setReference("");
      setProof(null);
      toast.success("Payment is pending administrator verification.");
    });
  };
  return (
    <SellerPage
      title="Your plan"
      description="Free access has no time limit. Upgrade or renew by verified bank transfer."
    >
      {loading ? (
        <p role="status">Loading plans…</p>
      ) : error ? (
        <Card className="p-6">
          <p role="alert">{error}</p>
          <Button onClick={() => void load()}>Retry</Button>
        </Card>
      ) : (
        <>
          <Card className="p-6 mb-6">
            <h2 className="text-xl font-semibold">
              Current plan: {current.name}
            </h2>
            <p>
              {current.max_products} products.{" "}
              {isEntitled(sub) && sub?.expires_at
                ? `Paid access ends ${new Date(sub.expires_at).toLocaleString()}.`
                : "Free access continues indefinitely."}
            </p>
            <p>{productCount} saved products · current plan limit {current.max_products}</p>
            <progress className="w-full max-w-md" aria-label="Products used" value={Math.min(productCount, current.max_products)} max={current.max_products} />
            {sub?.status === "suspended" && <p role="alert">Your Paid subscription is suspended. Contact support before renewing.</p>}
            <p className="text-sm text-muted-foreground">
              Your saved products are kept when Paid access expires.
            </p>
          </Card>
          <div className="grid gap-6 md:grid-cols-2 mb-6">
            {plans.map((p) => (
              <Card key={p.id} className="p-6">
                <h2 className="text-xl font-bold">{p.name}</h2>
                <p className="text-xl my-3">
                  {p.code === "free"
                    ? "Free forever"
                    : `${formatCurrency(p.price_ngn)} / ${p.duration_days} days`}
                </p>
                <ul className="list-disc pl-5 space-y-2">
                  <li>Up to {p.max_products} products</li>
                  <li>WhatsApp ordering and saved orders</li>
                  <li>
                    {p.allow_stock
                      ? "Stock tracking and low-stock alerts"
                      : "Basic analytics and availability controls"}
                  </li>
                  {p.allow_discounts && <li>Discounts and promotions</li>}
                  {p.allow_reviews && <li>Verified customer reviews</li>}
                  {p.allow_branding && <li>Custom colours and logo</li>}
                </ul>
              </Card>
            ))}
          </div>
          <Card className="p-6 space-y-4">
            <h2 className="text-xl font-semibold">
              {isEntitled(sub) ? "Paid access is active" : "Upgrade to Paid"}
            </h2>
            {isEntitled(sub) ? (
              <div>
                <p>Your Paid subscription is active. Payment instructions will be available after it expires.</p>
                <Button disabled>Get payment instructions</Button>
              </div>
            ) : pending ? (
              <div role="status">
                <p>
                  Pending: payment under review. Paid features activate only
                  after approval.
                </p>
                <p>
                  Reference: {pending.payment_reference} ·{" "}
                  {formatCurrency(pending.amount)}
                </p>
                {paymentSnapshot(pending) && (
                  <p>
                    {paymentSnapshot(pending)?.bank_name} ·{" "}
                    {paymentSnapshot(pending)?.account_name} ·{" "}
                    {paymentSnapshot(pending)?.account_number}
                  </p>
                )}
              </div>
            ) : draft && snapshot ? (
              <>
                <div className="rounded border p-4 space-y-1">
                  <h3 className="font-semibold">
                    Your saved payment instructions
                  </h3>
                  <p>
                    Transfer {formatCurrency(draft.amount)} for{" "}
                    {snapshot.duration_days} days.
                  </p>
                  <p>Bank: {snapshot.bank_name}</p>
                  <p>Account name: {snapshot.account_name}</p>
                  <p>Account number: {snapshot.account_number}</p>
                  <p className="whitespace-pre-wrap">
                    {snapshot.payment_instructions}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    These details are saved for this request, even if future
                    prices change.
                  </p>
                </div>
                <form onSubmit={notify} className="space-y-4 max-w-lg">
                  <div>
                    <Label htmlFor="reference">Transfer reference</Label>
                    <Input
                      id="reference"
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      minLength={4}
                      maxLength={80}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="proof">Payment proof (optional)</Label>
                    <Input
                      id="proof"
                      type="file"
                      accept="image/jpeg,image/png,application/pdf"
                      onChange={(e) => setProof(e.target.files?.[0] ?? null)}
                    />
                    <p className="text-sm">
                      JPG, PNG or PDF, up to 5MB. Private to you and
                      administrators.
                    </p>
                  </div>
                  <Button disabled={busy} type="submit">
                    {busy ? "Sending…" : "I Have Made Payment"}
                  </Button>
                </form>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const r = await supabase.rpc("sellnova_cancel_payment", {
                        _request_id: draft.id,
                      });
                      if (r.error) throw r.error;
                    })
                  }
                >
                  Cancel unused payment quote
                </Button>
              </>
            ) : (
              <>
                <p>
                  {settings?.payment_collection_enabled
                    ? `Paid access costs ${formatCurrency(paid?.price_ngn ?? 0)} for ${paid?.duration_days} days. Save a quote to see your transfer instructions.`
                    : "Payment collection is currently paused. Free access remains available."}
                </p>
                <Button
                  disabled={
                    busy || isEntitled(sub) ||
                    !settings?.payment_collection_enabled || !paid
                  }
                  onClick={() =>
                    void act(async () => {
                      if (!storeId || isEntitled(sub)) return;
                      const r = await supabase.rpc("sellnova_begin_payment", {
                        _store_id: storeId,
                      });
                      if (r.error) throw r.error;
                    })
                  }
                >
                  Get payment instructions
                </Button>
              </>
            )}
          </Card>
          <Card className="p-6 mt-6">
            <h2 className="text-xl font-semibold mb-3">Payment history</h2>
            {requests.length === 0 && <p>No payment requests yet.</p>}
            <ul className="divide-y">
              {requests.map((r) => (
                <li key={r.id} className="py-4 space-y-1">
                  <p className="font-medium capitalize">
                    {r.status === "draft" ? "Awaiting your transfer" : r.status}{" "}
                    · {formatCurrency(r.amount)}
                  </p>
                  <p>
                    {r.status === "draft" ? "Saved quote" : r.payment_reference}{" "}
                    · {new Date(r.created_at).toLocaleString()}
                  </p>
                  <p>
                    {r.duration_days
                      ? `${r.duration_days} days`
                      : "Legacy request"}
                  </p>
                  {paymentSnapshot(r) && (
                    <details>
                      <summary>Saved payment instructions</summary>
                      <p>
                        {paymentSnapshot(r)?.bank_name} ·{" "}
                        {paymentSnapshot(r)?.account_name} ·{" "}
                        {paymentSnapshot(r)?.account_number}
                      </p>
                      <p>{paymentSnapshot(r)?.payment_instructions}</p>
                    </details>
                  )}
                  {r.decision_reason && <p>{r.decision_reason}</p>}
                  {r.activated_until && (
                    <p>
                      Renewal period ends{" "}
                      {new Date(r.activated_until).toLocaleString()}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </SellerPage>
  );
}

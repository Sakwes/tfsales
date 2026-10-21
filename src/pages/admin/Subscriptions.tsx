import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import {
  message,
  paymentSnapshot,
  PaymentRequest,
  PaymentSettings,
} from "@/lib/billing";
import type { Json } from "@/integrations/supabase/types";

type ReviewRow = PaymentRequest & {
  stores: { store_name: string; seller_id: string } | null;
};
function Review({
  request: r,
  reload,
}: {
  request: ReviewRow;
  reload: () => Promise<void>;
}) {
  const [verified, setVerified] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [proofUrl, setProofUrl] = useState("");
  const snapshot = paymentSnapshot(r);
  const decide = async (approve: boolean) => {
    setBusy(true);
    try {
      const result = await supabase.rpc("sellnova_review_payment", {
        _request_id: r.id,
        _approve: approve,
        _verified: verified,
        _reason: reason.trim() || null,
      });
      if (result.error) throw result.error;
      toast.success(approve ? "Subscription approved." : "Payment rejected.");
      await reload();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="p-5 space-y-3">
      <h3 className="font-semibold">
        {r.stores?.store_name ?? r.store_id} ·{" "}
        <span className="capitalize">{r.status}</span>
      </h3>
      <p>
        {formatCurrency(r.amount)} · {r.duration_days ?? "Unrecorded"} days ·{" "}
        {r.payment_reference}
      </p>
      <p className="text-sm">
        Request {r.id} · {new Date(r.created_at).toLocaleString()}
      </p>
      {snapshot ? (
        <div className="border rounded p-3 text-sm">
          <p>Saved transfer instructions</p>
          <p>
            {snapshot.bank_name} · {snapshot.account_name} ·{" "}
            {snapshot.account_number}
          </p>
          <p className="whitespace-pre-wrap">{snapshot.payment_instructions}</p>
        </div>
      ) : (
        <p role="alert">
          Legacy request without saved instructions. Reconcile the transfer
          before rejecting and asking for a new quote; approval is blocked.
        </p>
      )}
      {r.proof_path && (
        <>
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              const result = await supabase.storage
                .from("payment-proofs")
                .createSignedUrl(r.proof_path!, 60);
              if (result.error) toast.error(message(result.error));
              else setProofUrl(result.data.signedUrl);
            }}
          >
            View private payment proof
          </Button>
          {proofUrl && (
            <a
              href={proofUrl}
              target="_blank"
              rel="noreferrer"
              className="block underline"
            >
              Open proof (link expires after 60 seconds)
            </a>
          )}
        </>
      )}
      {r.status === "pending" && (
        <>
          <Label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={verified}
              onChange={(e) => setVerified(e.target.checked)}
            />
            I verified this transfer, amount and reference in the bank account.
          </Label>
          <Label htmlFor={`reason-${r.id}`}>
            Decision note (required when rejecting)
          </Label>
          <Textarea
            id={`reason-${r.id}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={1000}
          />
          <div className="flex gap-3">
            <Button
              disabled={busy || !verified || !snapshot}
              onClick={() => void decide(true)}
            >
              Approve payment
            </Button>
            <Button
              variant="destructive"
              disabled={busy || !reason.trim()}
              onClick={() => void decide(false)}
            >
              Reject payment
            </Button>
          </div>
        </>
      )}
      {r.decision_reason && <p>{r.decision_reason}</p>}
      {r.activated_until && (
        <p>
          Entitlement through {new Date(r.activated_until).toLocaleString()}
        </p>
      )}
    </Card>
  );
}

export default function AdminSubscriptions() {
  const [settings, setSettings] = useState<PaymentSettings | null>(null);
  const [amount, setAmount] = useState("1500");
  const [days, setDays] = useState("30");
  const [bank, setBank] = useState("");
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [instructions, setInstructions] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [requests, setRequests] = useState<ReviewRow[]>([]);
  const [audit, setAudit] = useState<
    { id: string; action: string; created_at: string; details: Json }[]
  >([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState("pending");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const load = useCallback(async () => {
    try {
      setError("");
      const [s, p, r, a] = await Promise.all([
        supabase.from("platform_settings").select("*").single(),
        supabase
          .from("plans")
          .select("price_ngn,duration_days")
          .eq("code", "paid")
          .single(),
        supabase
          .from("subscription_requests")
          .select("*,stores(store_name,seller_id)", { count: "exact" })
          .eq("status", filter)
          .order("created_at", { ascending: false })
          .range(page * 25, page * 25 + 24),
        supabase
          .from("admin_audit_log")
          .select("id,action,created_at,details")
          .in("action", [
            "payment.settings.updated",
            "payment.approved",
            "payment.rejected",
          ])
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      if (s.error) throw s.error;
      if (p.error) throw p.error;
      if (r.error) throw r.error;
      if (a.error) throw a.error;
      setSettings(s.data);
      setAmount(String(p.data.price_ngn));
      setDays(String(p.data.duration_days));
      setBank(s.data.bank_name ?? "");
      setName(s.data.account_name ?? "");
      setNumber(s.data.account_number ?? "");
      setInstructions(s.data.payment_instructions ?? "");
      setEnabled(s.data.payment_collection_enabled);
      setRequests(r.data as ReviewRow[]);
      setTotal(r.count ?? 0);
      setAudit(a.data);
      setLoaded(true);
    } catch (e) {
      setError(message(e));
    }
  }, [filter, page]);
  useEffect(() => {
    void load();
  }, [load]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!settings) return;
    setSaving(true);
    try {
      const result = await supabase.rpc("sellnova_update_payment_settings", {
        _version: settings.version,
        _amount: Number(amount),
        _days: Number(days),
        _bank: bank.trim(),
        _name: name.trim(),
        _number: number.trim(),
        _instructions: instructions.trim(),
        _enabled: enabled,
      });
      if (result.error) throw result.error;
      toast.success("Payment settings saved and audited.");
      await load();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <main className="max-w-6xl mx-auto p-4 md:p-8 space-y-6">
      <header>
        <Link className="underline" to="/admin">
          Back to admin dashboard
        </Link>
        <h1 className="text-3xl font-bold mt-4">Subscriptions and payments</h1>
        <p>Configure bank transfers and verify payment notifications.</p>
      </header>
      {error && (
        <div role="alert">
          <p>{error}</p>
          <Button onClick={() => void load()}>Reload</Button>
        </div>
      )}
      {!loaded && !error && <p role="status">Loading payment settings…</p>}
      {loaded && (
        <>
          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-4">
              Subscription settings
            </h2>
            <p className="mb-4 text-sm">
              Changes apply to new quotes. Saved requests retain their price,
              duration and transfer instructions.
            </p>
            <form onSubmit={save} className="grid md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="amount">Subscription amount (NGN)</Label>
                <Input
                  id="amount"
                  type="number"
                  min="1"
                  max="1000000"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="days">Subscription duration (days)</Label>
                <Input
                  id="days"
                  type="number"
                  min="1"
                  max="365"
                  step="1"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="bank">Bank / payment provider</Label>
                <Input
                  id="bank"
                  placeholder="e.g. OPay"
                  value={bank}
                  onChange={(e) => setBank(e.target.value)}
                  maxLength={100}
                  required={enabled}
                />
              </div>
              <div>
                <Label htmlFor="name">Account name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  required={enabled}
                />
              </div>
              <div>
                <Label htmlFor="number">Account number</Label>
                <Input
                  id="number"
                  inputMode="numeric"
                  pattern={enabled ? "[0-9]{10}" : undefined}
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  maxLength={30}
                  required={enabled}
                />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="instructions">Payment instructions</Label>
                <Textarea
                  id="instructions"
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  maxLength={2000}
                />
              </div>
              <Label className="flex gap-2 items-center md:col-span-2">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                Enable payment collection
              </Label>
              <Button type="submit" disabled={saving || Boolean(error)}>
                {saving ? "Saving…" : "Save payment settings"}
              </Button>
            </form>
          </Card>
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">Payment requests</h2>
            <Label htmlFor="request-status">Request status</Label>
            <select
              id="request-status"
              className="border rounded p-2"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(0);
              }}
            >
              {["pending", "approved", "rejected", "draft"].map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <p>
              {total} matching requests. Page {page + 1}.
            </p>
            <Button variant="outline" onClick={() => void load()}>
              Refresh requests
            </Button>
            {requests.length === 0 && <p>No matching requests.</p>}
            {requests.map((r) => (
              <Review key={r.id} request={r} reload={load} />
            ))}
            <div className="flex gap-3">
              <Button
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                disabled={(page + 1) * 25 >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </section>
          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-4">
              Recent administrative audit
            </h2>
            {audit.length === 0 && <p>No billing changes yet.</p>}
            {audit.map((a) => (
              <details key={a.id} className="border-b py-2">
                <summary>
                  {a.action} · {new Date(a.created_at).toLocaleString()}
                </summary>
                <pre className="whitespace-pre-wrap break-all text-xs p-2">
                  {JSON.stringify(a.details, null, 2)}
                </pre>
              </details>
            ))}
          </Card>
        </>
      )}
    </main>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { SellerPage } from "@/components/SellerPage";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Lock, MessageSquare, Star, Store } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMetaTags } from "@/hooks/use-meta-tags";
import { effectivePlan, loadPlans, loadSubscription } from "@/lib/plan";

interface Review {
  id: string;
  rating: number;
  comment: string | null;
  customer_name: string | null;
  status: "pending" | "approved" | "hidden";
  seller_response: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<Review["status"], string> = {
  pending: "Waiting for approval",
  approved: "Shown on your store",
  hidden: "Hidden"
};

const Stars = ({ rating }: { rating: number }) => (
  <span className="flex items-center gap-0.5" aria-label={`${rating} out of 5 stars`}>
    {[1, 2, 3, 4, 5].map(v => (
      <Star
        key={v}
        aria-hidden="true"
        className={v <= rating ? "h-4 w-4 fill-primary text-primary" : "h-4 w-4 text-muted-foreground"}
      />
    ))}
  </span>
);

const ReviewsPage = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [planName, setPlanName] = useState("Free");
  const [reviews, setReviews] = useState<Review[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  useMetaTags({
    title: "Reviews | SellNova",
    description: "Read what your customers said and reply to them."
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

    const [plans, sub, list] = await Promise.all([
      loadPlans(),
      loadSubscription(store.id),
      supabase
        .from("reviews")
        .select("id, rating, comment, customer_name, status, seller_response, created_at")
        .eq("store_id", store.id)
        .order("created_at", { ascending: false })
    ]);

    const plan = effectivePlan(plans, sub);
    setAllowed(plan.allow_reviews);
    setPlanName(plan.name);
    setReviews((list.data ?? []) as unknown as Review[]);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const respond = async (review: Review) => {
    const text = (drafts[review.id] ?? review.seller_response ?? "").trim();
    if (text.length === 0) {
      toast.error("Write a reply first");
      return;
    }
    if (text.length > 1000) {
      toast.error("Your reply is too long");
      return;
    }
    setSavingId(review.id);
    const { error: saveError } = await supabase
      .from("reviews")
      .update({ seller_response: text })
      .eq("id", review.id);
    setSavingId(null);
    if (saveError) {
      toast.error(saveError.message || "Could not save your reply");
      return;
    }
    toast.success("Reply saved");
    await load();
  };

  if (loading) {
    return (
      <SellerPage title="Reviews" description="Loading your reviews…">
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
        <span className="sr-only" role="status">
          Loading reviews
        </span>
      </SellerPage>
    );
  }

  if (error) {
    return (
      <SellerPage title="Reviews">
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
      <SellerPage title="Reviews">
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
      title="Reviews"
      description="Only customers with a completed order can leave a review, and only once.">
      {!allowed && (
        <Alert className="mb-6">
          <Lock className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>Customer reviews are a paid feature</AlertTitle>
          <AlertDescription className="flex flex-col sm:flex-row sm:items-center gap-3">
            <span>
              You are on the {planName} plan. Reviews you already received stay saved.
            </span>
            <Button asChild size="sm" variant="hero" className="shrink-0">
              <Link to="/seller/subscription">View plans</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {reviews.length === 0 ? (
        <Card className="p-12 text-center">
          <MessageSquare
            className="h-14 w-14 mx-auto mb-4 text-muted-foreground"
            aria-hidden="true"
          />
          <h2 className="text-xl font-semibold mb-2">No reviews yet</h2>
          <p className="text-muted-foreground">
            Complete an order, then share the review link with your customer.
          </p>
        </Card>
      ) : (
        <ul className="space-y-4">
          {reviews.map(review => (
            <li key={review.id}>
              <Card className="p-5 space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Stars rating={review.rating} />
                  <span className="font-medium">
                    {review.customer_name || "A customer"}
                  </span>
                  <Badge variant="secondary">{STATUS_LABEL[review.status]}</Badge>
                  <span className="text-sm text-muted-foreground ml-auto">
                    {new Date(review.created_at).toLocaleDateString("en-NG")}
                  </span>
                </div>

                {review.comment && (
                  <p className="text-muted-foreground whitespace-pre-line">
                    {review.comment}
                  </p>
                )}

                <div className="space-y-2 border-t pt-3">
                  <label
                    className="text-sm font-medium"
                    htmlFor={`reply-${review.id}`}>
                    Your reply
                  </label>
                  <Textarea
                    id={`reply-${review.id}`}
                    rows={3}
                    maxLength={1000}
                    disabled={!allowed}
                    value={drafts[review.id] ?? review.seller_response ?? ""}
                    onChange={e =>
                      setDrafts({ ...drafts, [review.id]: e.target.value })
                    }
                    placeholder="Thank your customer or explain what happened"
                  />
                  <Button
                    size="sm"
                    variant="hero"
                    disabled={!allowed || savingId === review.id}
                    onClick={() => respond(review)}>
                    {savingId === review.id ? "Saving…" : "Save reply"}
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </SellerPage>
  );
};

export default ReviewsPage;

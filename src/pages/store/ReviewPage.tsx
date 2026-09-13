import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Star, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMetaTags } from "@/hooks/use-meta-tags";

interface Context {
  valid: boolean;
  store_name?: string;
  store_slug?: string;
  order_reference?: string;
}

const ReviewPage = () => {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [context, setContext] = useState<Context | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useMetaTags({
    title: "Rate your order | SellNova",
    description: "Tell the seller how your order went."
  });

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("sellnova_review_context", {
      _token: token ?? ""
    });
    setContext(error ? { valid: false } : ((data as unknown) as Context));
    setLoading(false);
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    if (rating < 1) {
      toast.error("Please choose a rating from 1 to 5 stars");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.rpc("sellnova_submit_review", {
      _token: token ?? "",
      _rating: rating,
      _comment: comment
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message || "This review link is no longer valid");
      return;
    }
    setDone(true);
  };

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md p-8 space-y-4">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-24 w-full" />
        </Card>
        <span className="sr-only" role="status">
          Loading review page
        </span>
      </main>
    );
  }

  if (!context?.valid) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md p-10 text-center">
          <h1 className="text-2xl font-bold mb-2">This review link is not valid</h1>
          <p className="text-muted-foreground mb-6">
            The link may have already been used, or the order is not completed yet.
          </p>
          <Button asChild variant="hero">
            <Link to="/">Go to SellNova</Link>
          </Button>
        </Card>
      </main>
    );
  }

  if (done) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md p-10 text-center">
          <CheckCircle2
            className="h-14 w-14 mx-auto mb-4 text-emerald-600"
            aria-hidden="true"
          />
          <h1 className="text-2xl font-bold mb-2">Thank you</h1>
          <p className="text-muted-foreground mb-6">
            Your review was sent to {context.store_name}.
          </p>
          {context.store_slug && (
            <Button asChild variant="outline">
              <Link to={`/store/${context.store_slug}`}>Back to the store</Link>
            </Button>
          )}
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-8">
        <h1 className="text-2xl font-bold mb-1">How was your order?</h1>
        <p className="text-muted-foreground mb-6">
          {context.store_name} · order {context.order_reference}
        </p>

        <fieldset className="mb-6">
          <legend className="text-sm font-medium mb-2">Your rating</legend>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map(value => (
              <button
                key={value}
                type="button"
                aria-label={`${value} star${value === 1 ? "" : "s"}`}
                aria-pressed={rating === value}
                onClick={() => setRating(value)}
                className="rounded-md p-1">
                <Star
                  className={
                    value <= rating
                      ? "h-8 w-8 fill-primary text-primary"
                      : "h-8 w-8 text-muted-foreground"
                  }
                  aria-hidden="true"
                />
              </button>
            ))}
          </div>
        </fieldset>

        <div className="space-y-2 mb-6">
          <Label htmlFor="comment">Tell the seller more (optional)</Label>
          <Textarea
            id="comment"
            rows={4}
            maxLength={1000}
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="What did you like? What could be better?"
          />
        </div>

        <Button
          variant="hero"
          className="w-full"
          onClick={submit}
          disabled={submitting}>
          {submitting ? "Sending…" : "Send review"}
        </Button>
      </Card>
    </main>
  );
};

export default ReviewPage;

import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import React from "react";
import { Link } from "react-router-dom";
import { useMetaTags } from "@/hooks/use-meta-tags";

const Support = () => {
  useMetaTags({ title: "Support | SellNova", description: "Get help with your SellNova store, account or shareable store link." });

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto px-4 py-8">
        <Link to="/">
          <Button variant="ghost" className="mb-6">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Home
          </Button>
        </Link>

        <div className="prose prose-gray dark:prose-invert max-w-none">
          <h1 className="text-3xl font-bold mb-2">Support</h1>
          <p className="text-muted-foreground mb-8">
            Last updated: January 7, 2026
          </p>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">
              For support, please reach out to our team via phone or email.
            </h2>
            <p className="text-muted-foreground mb-4">
              Phone:{" "}
              <Link
                to="tel:07038748137"
                className="text-primary hover:opacity-50 transition-opacity">
                07038748137
              </Link>
              , email:{" "}
              <Link
                to="mailto:info@tfsolutions.com.ng"
                className="text-primary hover:opacity-50 transition-opacity">
                info@tfsolutions.com.ng
              </Link>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

export default Support;

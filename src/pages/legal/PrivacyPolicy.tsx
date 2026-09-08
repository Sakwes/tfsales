import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useMetaTags } from "@/hooks/use-meta-tags";

const PrivacyPolicy = () => {
  useMetaTags({ title: "Privacy Policy | SellNova", description: "How SellNova collects, uses and protects your personal information." });

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
          <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
          <p className="text-muted-foreground mb-8">Last updated: January 7, 2026</p>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">1. Information We Collect</h2>
            <p className="text-muted-foreground mb-4">
              We collect information you provide directly to us, including:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Account information (email address, phone number)</li>
              <li>Store information (store name, product listings)</li>
              <li>Usage data (page views, clicks, analytics)</li>
              <li>Device information (IP address, browser type)</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">2. How We Use Your Information</h2>
            <p className="text-muted-foreground mb-4">
              We use the information we collect to:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Provide and maintain our services</li>
              <li>Process transactions and send related information</li>
              <li>Send you technical notices and support messages</li>
              <li>Provide analytics and insights about your store performance</li>
              <li>Detect and prevent fraudulent activities</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">3. Information Sharing</h2>
            <p className="text-muted-foreground mb-4">
              We do not sell your personal information. We may share information with:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Service providers who assist in our operations</li>
              <li>Law enforcement when required by law</li>
              <li>Other parties with your consent</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">4. Data Security</h2>
            <p className="text-muted-foreground mb-4">
              We implement appropriate security measures to protect your personal information. However, no method of transmission over the Internet is 100% secure, and we cannot guarantee absolute security.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">5. Your Rights</h2>
            <p className="text-muted-foreground mb-4">
              You have the right to:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Access your personal information</li>
              <li>Correct inaccurate data</li>
              <li>Request deletion of your data</li>
              <li>Object to processing of your data</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">6. Contact Us</h2>
            <p className="text-muted-foreground mb-4">
              If you have questions about this Privacy Policy, please contact us through our support channels.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;

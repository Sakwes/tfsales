import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const TermsAndConditions = () => {
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
          <h1 className="text-3xl font-bold mb-2">Terms and Conditions</h1>
          <p className="text-muted-foreground mb-8">Last updated: January 7, 2026</p>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">1. Acceptance of Terms</h2>
            <p className="text-muted-foreground mb-4">
              By accessing and using Tech Fusion Solutions ("the Platform"), you accept and agree to be bound by these Terms and Conditions. If you do not agree to these terms, please do not use our services.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">2. Description of Service</h2>
            <p className="text-muted-foreground mb-4">
              Tech Fusion Solutions provides an online platform that enables users ("Sellers") to create and manage their own e-commerce stores. The Platform allows Sellers to:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Create a personalized online storefront</li>
              <li>Upload and manage product listings</li>
              <li>Share their store URL with potential customers</li>
              <li>Track store analytics and performance</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">3. User Registration</h2>
            <p className="text-muted-foreground mb-4">
              To use the Platform, you must:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Be at least 18 years of age or have parental consent</li>
              <li>Provide accurate and complete registration information</li>
              <li>Maintain the security of your account credentials</li>
              <li>Notify us immediately of any unauthorized account access</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">4. Seller Responsibilities</h2>
            <p className="text-muted-foreground mb-4">
              As a Seller on our Platform, you agree to:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Provide accurate product descriptions, images, and pricing</li>
              <li>Ensure all products listed comply with applicable laws and regulations</li>
              <li>Fulfill orders in a timely manner as advertised</li>
              <li>Handle customer inquiries and complaints professionally</li>
              <li>Not sell prohibited, illegal, or counterfeit items</li>
              <li>Maintain accurate inventory information</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">5. Prohibited Items</h2>
            <p className="text-muted-foreground mb-4">
              The following items are strictly prohibited on the Platform:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Illegal drugs or controlled substances</li>
              <li>Weapons and ammunition</li>
              <li>Counterfeit or stolen goods</li>
              <li>Adult content or services</li>
              <li>Items that infringe on intellectual property rights</li>
              <li>Hazardous materials</li>
              <li>Any items prohibited by local, state, or federal law</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">6. Intellectual Property</h2>
            <p className="text-muted-foreground mb-4">
              You retain ownership of content you upload to the Platform. By uploading content, you grant us a non-exclusive license to display and distribute your content as necessary to operate the service. You represent that you have the right to upload and share all content on your store.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">7. Privacy and Data</h2>
            <p className="text-muted-foreground mb-4">
              Your use of the Platform is also governed by our Privacy Policy. We collect and process data as described therein. You agree to our collection and use of information in accordance with our Privacy Policy.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">8. Limitation of Liability</h2>
            <p className="text-muted-foreground mb-4">
              Tech Fusion Solutions is not responsible for:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Transactions between Sellers and their customers</li>
              <li>Product quality, safety, or legality</li>
              <li>The accuracy of product listings</li>
              <li>Any disputes arising from sales made through the Platform</li>
              <li>Service interruptions or data loss</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">9. Account Termination</h2>
            <p className="text-muted-foreground mb-4">
              We reserve the right to suspend or terminate accounts that:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Violate these Terms and Conditions</li>
              <li>Engage in fraudulent or illegal activities</li>
              <li>Receive multiple customer complaints</li>
              <li>Remain inactive for extended periods</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">10. Modifications to Terms</h2>
            <p className="text-muted-foreground mb-4">
              We may update these Terms and Conditions from time to time. We will notify users of significant changes via email or through the Platform. Continued use of the service after changes constitutes acceptance of the new terms.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">11. Governing Law</h2>
            <p className="text-muted-foreground mb-4">
              These Terms and Conditions shall be governed by and construed in accordance with applicable laws. Any disputes arising from these terms shall be resolved through appropriate legal channels.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">12. Contact Information</h2>
            <p className="text-muted-foreground mb-4">
              For questions about these Terms and Conditions, please contact us through our support channels available on the Platform.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

export default TermsAndConditions;

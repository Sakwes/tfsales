import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Mail, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import logo from "@/assets/logo.png";

const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const location = useLocation();
  const { toast } = useToast();
  const { resetPassword } = useAuth();

  // Show errors from navigation state (e.g., expired reset links)
  useEffect(() => {
    const state = location.state as { error?: string } | null;
    if (state?.error) {
      toast({
        title: "Link Expired",
        description: state.error,
        variant: "destructive",
      });
      window.history.replaceState({}, document.title);
    }
  }, [location.state, toast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !email.includes("@")) {
      toast({
        title: "Invalid Email",
        description: "Please enter a valid email address",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    const { error } = await resetPassword(email);
    setLoading(false);

    if (error) {
      toast({
        title: "Error",
        description: error.message || "Could not send reset email",
        variant: "destructive"
      });
      return;
    }

    setEmailSent(true);
    toast({
      title: "Email Sent!",
      description: "Check your inbox for password reset instructions"
    });
  };

  if (emailSent) {
    return (
      <div className="min-h-screen bg-gradient-hero flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <Card className="p-8 shadow-glow animate-fade-in text-center">
            <div className="flex items-center justify-center mb-6">
              <div className="bg-primary/10 p-4 rounded-full">
                <CheckCircle className="h-12 w-12 text-primary" />
              </div>
            </div>

            <h1 className="text-2xl font-bold mb-2">Check Your Email</h1>
            <p className="text-muted-foreground mb-6">
              We've sent password reset instructions to <strong>{email}</strong>
            </p>

            <div className="space-y-3">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setEmailSent(false)}>
                Try a different email
              </Button>

              <div>
                <Link to="/auth/login">
                  <Button variant="hero" className="w-full">
                    Back to Login
                  </Button>
                </Link>
              </div>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-hero flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Link
          to="/auth/login"
          className="inline-flex items-center text-white mb-6 hover:opacity-50 transition-opacity">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Login
        </Link>

        <Card className="p-8 shadow-glow animate-fade-in">
          <div className="flex items-center justify-center mb-6">
            <div className="bg-white p-3 rounded-xl">
              <img src={logo} alt="TechFusion Logo" className="h-8 w-8" />
            </div>
          </div>

          <h1 className="text-2xl font-bold text-center mb-2">
            Forgot Password?
          </h1>
          <p className="text-muted-foreground text-center mb-6">
            Enter your email and we'll send you reset instructions
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="pl-10"
                  required
                />
              </div>
            </div>

            <Button
              type="submit"
              variant="hero"
              className="w-full"
              size="lg"
              disabled={loading}>
              {loading ? "Sending..." : "Send Reset Link"}
            </Button>

            <p className="text-sm text-center text-muted-foreground">
              Remember your password?{" "}
              <Link
                to="/auth/login"
                className="text-primary hover:underline font-medium">
                Login here
              </Link>
            </p>
          </form>
        </Card>
      </div>
    </div>
  );
};

export default ForgotPassword;

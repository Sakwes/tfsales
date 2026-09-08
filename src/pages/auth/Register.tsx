import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Mail, Lock, Eye, EyeClosed, CheckCircle, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import logo from "@/assets/logo.png";
import { useMetaTags } from "@/hooks/use-meta-tags";

const Register = () => {
  useMetaTags({ title: "Create your free SellNova account", description: "Sign up free and launch your online store in minutes. Sell on WhatsApp, Facebook and Instagram." });

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [registrationComplete, setRegistrationComplete] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [resending, setResending] = useState(false);
  const { toast } = useToast();
  const { signUp, resendActivationEmail } = useAuth();

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

    if (password.length < 6) {
      toast({
        title: "Invalid Password",
        description: "Password must be at least 6 characters",
        variant: "destructive"
      });
      return;
    }

    if (password !== confirmPassword) {
      toast({
        title: "Passwords Don't Match",
        description: "Please make sure both passwords are the same",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    const { error } = await signUp(email, password);
    setLoading(false);

    if (error) {
      const raw = error.message || "";
      const friendly = /already registered|already exists|User already/i.test(raw)
        ? "An account with this email already exists. Try logging in instead."
        : /rate|too many/i.test(raw)
          ? "Too many attempts. Please wait a moment and try again."
          : "We couldn't create your account right now. Please check your details and try again.";

      toast({
        title: "Registration Failed",
        description: friendly,
        variant: "destructive"
      });
      return;
    }

    setSubmittedEmail(email);
    setRegistrationComplete(true);
  };

  const handleResendEmail = async () => {
    setResending(true);
    const { error } = await resendActivationEmail(submittedEmail);
    setResending(false);

    if (error) {
      toast({
        title: "Failed to Resend",
        description: error.message || "Could not resend activation email",
        variant: "destructive"
      });
      return;
    }

    toast({
      title: "Email Sent!",
      description: "A new activation email has been sent to your inbox"
    });
  };

  if (registrationComplete) {
    return (
      <div className="min-h-screen bg-gradient-hero flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <Link
            to="/"
            className="inline-flex items-center text-white mb-6 hover:opacity-50 transition-opacity">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Home
          </Link>

          <Card className="p-8 shadow-glow animate-fade-in">
            <div className="flex items-center justify-center mb-6">
              <div className="bg-green-100 p-4 rounded-full">
                <CheckCircle className="h-12 w-12 text-green-600" />
              </div>
            </div>

            <h1 className="text-2xl font-bold text-center mb-2">
              Check Your Email
            </h1>
            <p className="text-muted-foreground text-center mb-4">
              Your account activation email has been sent to:
            </p>
            <p className="text-center font-semibold text-primary mb-6">
              {submittedEmail}
            </p>
            <p className="text-sm text-muted-foreground text-center mb-6">
              Please click the link in the email to activate your account. If you don't see it, check your spam folder.
            </p>

            <div className="space-y-4">
              <Button
                variant="outline"
                className="w-full"
                onClick={handleResendEmail}
                disabled={resending}>
                {resending ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Resending...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Resend Activation Email
                  </>
                )}
              </Button>

              <p className="text-sm text-center text-muted-foreground">
                Already activated?{" "}
                <Link
                  to="/auth/login"
                  className="text-primary hover:underline font-medium">
                  Login here
                </Link>
              </p>
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
          to="/"
          className="inline-flex items-center text-white mb-6 hover:opacity-50 transition-opacity">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Home
        </Link>

        <Card className="p-8 shadow-glow animate-fade-in">
          <div className="flex items-center justify-center mb-6">
            <div className="bg-white p-3 rounded-xl">
              <img src={logo} className="h-8 w-8" alt="SellNova logo" />
            </div>
          </div>

          <h1 className="text-2xl font-bold text-center mb-2">
            Create An Account
          </h1>
          <p className="text-muted-foreground text-center mb-6">
            Enter your email to get started
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

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="pl-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute z-10 px-2 py-1 right-px top-0 bottom-0 my-auto hover:opacity-50 transition-opacity">
                  {!showPassword ? (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <EyeClosed className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Must be at least 6 characters
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="pl-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute z-10 px-2 py-1 right-px top-0 bottom-0 my-auto hover:opacity-50 transition-opacity">
                  {!showConfirmPassword ? (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <EyeClosed className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              variant="hero"
              className="w-full"
              size="lg"
              disabled={loading}>
              {loading ? "Creating Account..." : "Create Account"}
            </Button>

            <p className="text-sm text-center text-muted-foreground">
              Already have an account?{" "}
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

export default Register;

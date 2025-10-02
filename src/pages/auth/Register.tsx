import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Store, ArrowLeft, Phone, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const Register = () => {
  const [step, setStep] = useState<"phone" | "verify">("phone");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const navigate = useNavigate();
  const { toast } = useToast();

  const handlePhoneSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (phone.length < 10) {
      toast({
        title: "Invalid Phone Number",
        description: "Please enter a valid phone number",
        variant: "destructive",
      });
      return;
    }
    
    if (pin.length !== 4 || confirmPin.length !== 4) {
      toast({
        title: "Invalid PIN",
        description: "PIN must be exactly 4 digits",
        variant: "destructive",
      });
      return;
    }
    
    if (pin !== confirmPin) {
      toast({
        title: "PINs Don't Match",
        description: "Please make sure both PINs are the same",
        variant: "destructive",
      });
      return;
    }
    
    // Simulate SMS sending
    toast({
      title: "Verification Code Sent!",
      description: "Check your phone for the verification code",
    });
    
    setStep("verify");
  };

  const handleVerificationSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (verificationCode.length !== 6) {
      toast({
        title: "Invalid Code",
        description: "Please enter the 6-digit verification code",
        variant: "destructive",
      });
      return;
    }
    
    // Simulate successful verification
    toast({
      title: "Account Created!",
      description: "Welcome to SellerApp",
    });
    
    navigate("/seller/onboarding");
  };

  return (
    <div className="min-h-screen bg-gradient-hero flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Link to="/" className="inline-flex items-center text-white mb-6 hover:opacity-80 transition-opacity">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Home
        </Link>
        
        <Card className="p-8 shadow-glow animate-fade-in">
          <div className="flex items-center justify-center mb-6">
            <div className="bg-gradient-primary p-3 rounded-xl">
              <Store className="h-8 w-8 text-white" />
            </div>
          </div>
          
          <h1 className="text-2xl font-bold text-center mb-2">Create Seller Account</h1>
          <p className="text-muted-foreground text-center mb-6">
            {step === "phone" 
              ? "Enter your phone number to get started" 
              : "Enter the verification code sent to your phone"}
          </p>
          
          {step === "phone" ? (
            <form onSubmit={handlePhoneSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="+1 (555) 000-0000"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="pl-10"
                    required
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="pin">Choose 4-Digit PIN</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="pin"
                    type="password"
                    placeholder="••••"
                    maxLength={4}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                    className="pl-10"
                    required
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="confirmPin">Confirm PIN</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="confirmPin"
                    type="password"
                    placeholder="••••"
                    maxLength={4}
                    value={confirmPin}
                    onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                    className="pl-10"
                    required
                  />
                </div>
              </div>
              
              <Button type="submit" variant="hero" className="w-full" size="lg">
                Send Verification Code
              </Button>
              
              <p className="text-sm text-center text-muted-foreground">
                Already have an account?{" "}
                <Link to="/auth/login" className="text-primary hover:underline font-medium">
                  Login here
                </Link>
              </p>
            </form>
          ) : (
            <form onSubmit={handleVerificationSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code">Verification Code</Label>
                <Input
                  id="code"
                  type="text"
                  placeholder="000000"
                  maxLength={6}
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ''))}
                  className="text-center text-2xl tracking-widest"
                  required
                />
                <p className="text-xs text-muted-foreground text-center">
                  Code sent to {phone}
                </p>
              </div>
              
              <Button type="submit" variant="hero" className="w-full" size="lg">
                Verify & Create Account
              </Button>
              
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => setStep("phone")}
              >
                Change Phone Number
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
};

export default Register;

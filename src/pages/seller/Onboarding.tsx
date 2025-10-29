import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Store, Phone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

const Onboarding = () => {
  const [storeName, setStoreName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [existingStore, setExistingStore] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    async function checkStore() {
      if (!user) return;
      const { data } = await supabase
        .from('stores')
        .select('id')
        .eq('seller_id', user.id)
        .maybeSingle();
      
      if (data) {
        setExistingStore(true);
        navigate('/seller/dashboard');
      }
    }
    checkStore();
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!termsAccepted) {
      toast({
        title: "Terms Required",
        description: "Please read and accept the terms and conditions",
        variant: "destructive",
      });
      return;
    }
    
    if (storeName.length < 3) {
      toast({
        title: "Invalid Store Name",
        description: "Store name must be at least 3 characters",
        variant: "destructive",
      });
      return;
    }
    
    if (contactPhone.length < 10) {
      toast({
        title: "Invalid Phone Number",
        description: "Please enter a valid contact phone number",
        variant: "destructive",
      });
      return;
    }
    
    setLoading(true);
    
    const { data, error } = await supabase
      .from('stores')
      .insert({
        seller_id: user?.id,
        store_name: storeName.trim(),
        contact_phone: contactPhone,
      })
      .select()
      .single();
    
    setLoading(false);
    
    if (error) {
      toast({
        title: "Error Creating Store",
        description: error.message || "Could not create store",
        variant: "destructive",
      });
      return;
    }
    
    toast({
      title: "Store Created!",
      description: "Let's add some products to your store",
    });
    
    navigate("/seller/dashboard");
  };

  return (
    <div className="min-h-screen bg-background p-4 flex items-center justify-center">
      <div className="w-full max-w-2xl">
        <Card className="p-8 shadow-card animate-fade-in">
          <div className="flex items-center justify-center mb-6">
            <div className="bg-gradient-primary p-3 rounded-xl">
              <Store className="h-8 w-8 text-white" />
            </div>
          </div>
          
          <h1 className="text-3xl font-bold text-center mb-2">Set Up Your Store</h1>
          <p className="text-muted-foreground text-center mb-8">
            Let's create your online storefront
          </p>
          
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="storeName">Store Name *</Label>
              <Input
                id="storeName"
                type="text"
                placeholder="My Awesome Store"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                This will be part of your store URL: sellerapp.com/{storeName.toLowerCase().replace(/\s+/g, '-')}
              </p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="contactPhone">Contact Phone Number *</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="contactPhone"
                  type="tel"
                  placeholder="+1 (555) 000-0000"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  className="pl-10"
                  required
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Customers will use this to contact you
              </p>
            </div>
            
            <Card className="p-6 bg-muted/50">
              <h3 className="font-semibold mb-2">Terms and Conditions</h3>
              <div className="text-sm text-muted-foreground space-y-2 max-h-40 overflow-y-auto mb-4">
                <p>By creating a store on SellerApp, you agree to:</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Sell only legal products and services</li>
                  <li>Provide accurate product descriptions and pricing</li>
                  <li>Respond to customer inquiries in a timely manner</li>
                  <li>Not engage in fraudulent or misleading activities</li>
                  <li>Comply with all applicable laws and regulations</li>
                  <li>Allow SellerApp to display your store publicly</li>
                  <li>Pay any applicable fees or commissions</li>
                </ul>
                <p className="mt-2">
                  SellerApp reserves the right to deactivate stores that violate these terms.
                </p>
              </div>
              
              <div className="flex items-start space-x-2">
                <Checkbox
                  id="terms"
                  checked={termsAccepted}
                  onCheckedChange={(checked) => setTermsAccepted(checked as boolean)}
                />
                <label
                  htmlFor="terms"
                  className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  I have read and agree to the terms and conditions *
                </label>
              </div>
            </Card>
            
            <Button 
              type="submit" 
              variant="hero" 
              className="w-full" 
              size="lg"
              disabled={!termsAccepted || loading}
            >
              {loading ? "Creating Store..." : "Create Your Store"}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
};

export default Onboarding;

import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Store, Smartphone, Globe, TrendingUp, Shield, Zap } from "lucide-react";

const Landing = () => {
  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-hero py-20 px-4 sm:px-6 lg:px-8">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PHBhdGggZD0iTTM2IDE2YzAtMi4yMSAxLjc5LTQgNC00czQgMS43OSA0IDQtMS43OSA0LTQgNC00LTEuNzktNC00em0tMTYgMGMwLTIuMjEgMS43OS00IDQtNHM0IDEuNzkgNCA0LTEuNzkgNC00IDQtNC0xLjc5LTQtNHptMzIgMzJjMC0yLjIxIDEuNzktNCA0LTRzNCAxLjc5IDQgNC0xLjc5IDQtNCA0LTQtMS43OS00LTR6bS0xNiAwYzAtMi4yMSAxLjc5LTQgNC00czQgMS43OSA0IDQtMS43OSA0LTQgNC00LTEuNzktNC00em0tMTYgMGMwLTIuMjEgMS43OS00IDQtNHM0IDEuNzkgNCA0LTEuNzkgNC00IDQtNC0xLjc5LTQtNHoiLz48L2c+PC9nPjwvc3ZnPg==')] opacity-30"></div>
        
        <div className="relative max-w-7xl mx-auto text-center">
          <div className="flex items-center justify-center mb-6 animate-fade-in">
            <div className="bg-white/10 backdrop-blur-sm p-4 rounded-2xl">
              <Store className="h-12 w-12 text-white" />
            </div>
          </div>
          
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-6 animate-fade-in">
            Your Store, Online in Minutes
          </h1>
          
          <p className="text-xl text-white/90 mb-8 max-w-2xl mx-auto animate-fade-in">
            Create your own e-commerce store with just your phone number. 
            Upload products, share your link, and start selling today.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center animate-fade-in">
            <Link to="/auth/register">
              <Button size="lg" variant="accent" className="w-full sm:w-auto text-lg px-8">
                Start Selling Now
              </Button>
            </Link>
            <Link to="/auth/login">
              <Button size="lg" variant="outline" className="w-full sm:w-auto text-lg px-8 bg-white/10 border-white/20 text-white hover:bg-white/20">
                Seller Login
              </Button>
            </Link>
          </div>
          
          <div className="mt-12 grid grid-cols-3 gap-6 max-w-2xl mx-auto text-white">
            <div className="animate-fade-in">
              <div className="text-3xl font-bold">1000+</div>
              <div className="text-sm text-white/80">Active Sellers</div>
            </div>
            <div className="animate-fade-in">
              <div className="text-3xl font-bold">50K+</div>
              <div className="text-sm text-white/80">Products Listed</div>
            </div>
            <div className="animate-fade-in">
              <div className="text-3xl font-bold">200K+</div>
              <div className="text-sm text-white/80">Monthly Visits</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-background">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Everything You Need to Sell Online</h2>
            <p className="text-muted-foreground text-lg">Simple, fast, and powerful e-commerce for everyone</p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            <Card className="p-6 shadow-card hover:shadow-glow transition-all duration-300">
              <div className="bg-gradient-primary p-3 rounded-lg w-fit mb-4">
                <Smartphone className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Quick Sign Up</h3>
              <p className="text-muted-foreground">
                Register with just your phone number and a 4-digit PIN. No complex forms or lengthy processes.
              </p>
            </Card>
            
            <Card className="p-6 shadow-card hover:shadow-glow transition-all duration-300">
              <div className="bg-gradient-secondary p-3 rounded-lg w-fit mb-4">
                <Store className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Easy Store Setup</h3>
              <p className="text-muted-foreground">
                Name your store, add products with images, and you're ready to sell. Up to 12 products with 3 images each.
              </p>
            </Card>
            
            <Card className="p-6 shadow-card hover:shadow-glow transition-all duration-300">
              <div className="bg-accent p-3 rounded-lg w-fit mb-4">
                <Globe className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Shareable Store URL</h3>
              <p className="text-muted-foreground">
                Get your unique store link (sellerapp.com/yourstore) to share on WhatsApp, Facebook, and Instagram.
              </p>
            </Card>
            
            <Card className="p-6 shadow-card hover:shadow-glow transition-all duration-300">
              <div className="bg-gradient-primary p-3 rounded-lg w-fit mb-4">
                <Zap className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Real-time Updates</h3>
              <p className="text-muted-foreground">
                Edit products, prices, and descriptions anytime. Changes reflect instantly on your store.
              </p>
            </Card>
            
            <Card className="p-6 shadow-card hover:shadow-glow transition-all duration-300">
              <div className="bg-gradient-secondary p-3 rounded-lg w-fit mb-4">
                <TrendingUp className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Track Performance</h3>
              <p className="text-muted-foreground">
                Monitor your store visits and understand your customers better with built-in analytics.
              </p>
            </Card>
            
            <Card className="p-6 shadow-card hover:shadow-glow transition-all duration-300">
              <div className="bg-accent p-3 rounded-lg w-fit mb-4">
                <Shield className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Secure & Reliable</h3>
              <p className="text-muted-foreground">
                Your data is protected with SMS verification and secure authentication. Sell with confidence.
              </p>
            </Card>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-muted/30">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Start Selling in 3 Simple Steps</h2>
            <p className="text-muted-foreground text-lg">From signup to sales in less than 10 minutes</p>
          </div>
          
          <div className="space-y-8">
            <div className="flex flex-col md:flex-row gap-6 items-center">
              <div className="bg-gradient-primary text-white rounded-full w-16 h-16 flex items-center justify-center text-2xl font-bold flex-shrink-0 shadow-glow">
                1
              </div>
              <Card className="flex-1 p-6 shadow-card">
                <h3 className="text-xl font-semibold mb-2">Create Your Account</h3>
                <p className="text-muted-foreground">
                  Enter your phone number and choose a 4-digit PIN. Verify with SMS code and you're in!
                </p>
              </Card>
            </div>
            
            <div className="flex flex-col md:flex-row gap-6 items-center">
              <div className="bg-gradient-secondary text-white rounded-full w-16 h-16 flex items-center justify-center text-2xl font-bold flex-shrink-0 shadow-glow">
                2
              </div>
              <Card className="flex-1 p-6 shadow-card">
                <h3 className="text-xl font-semibold mb-2">Set Up Your Store</h3>
                <p className="text-muted-foreground">
                  Name your store, add contact details, and upload your products with images and prices.
                </p>
              </Card>
            </div>
            
            <div className="flex flex-col md:flex-row gap-6 items-center">
              <div className="bg-accent text-white rounded-full w-16 h-16 flex items-center justify-center text-2xl font-bold flex-shrink-0 shadow-glow">
                3
              </div>
              <Card className="flex-1 p-6 shadow-card">
                <h3 className="text-xl font-semibold mb-2">Share & Start Selling</h3>
                <p className="text-muted-foreground">
                  Generate your store URL and share it on social media. Your customers can browse and contact you to buy!
                </p>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-primary relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PHBhdGggZD0iTTM2IDE2YzAtMi4yMSAxLjc5LTQgNC00czQgMS43OSA0IDQtMS43OSA0LTQgNC00LTEuNzktNC00em0tMTYgMGMwLTIuMjEgMS43OS00IDQtNHM0IDEuNzkgNCA0LTEuNzkgNC00IDQtNC0xLjc5LTQtNHptMzIgMzJjMC0yLjIxIDEuNzktNCA0LTRzNCAxLjc5IDQgNC0xLjc5IDQtNCA0LTQtMS43OS00LTR6bS0xNiAwYzAtMi4yMSAxLjc5LTQgNC00czQgMS43OSA0IDQtMS43OSA0LTQgNC00LTEuNzktNC00em0tMTYgMGMwLTIuMjEgMS43OS00IDQtNHM0IDEuNzkgNCA0LTEuNzkgNC00IDQtNC0xLjc5LTQtNHoiLz48L2c+PC9nPjwvc3ZnPg==')] opacity-20"></div>
        
        <div className="relative max-w-4xl mx-auto text-center text-white">
          <h2 className="text-3xl sm:text-4xl font-bold mb-6">
            Ready to Launch Your Online Store?
          </h2>
          <p className="text-xl text-white/90 mb-8">
            Join thousands of sellers already growing their business online
          </p>
          <Link to="/auth/register">
            <Button size="lg" variant="accent" className="text-lg px-8">
              Get Started for Free
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-card py-12 px-4 sm:px-6 lg:px-8 border-t">
        <div className="max-w-7xl mx-auto text-center">
          <div className="flex items-center justify-center mb-4">
            <Store className="h-8 w-8 text-primary mr-2" />
            <span className="text-xl font-bold">SellerApp</span>
          </div>
          <p className="text-muted-foreground mb-4">
            Empowering sellers to build their online presence
          </p>
          <div className="flex justify-center gap-6 text-sm text-muted-foreground">
            <a href="#" className="hover:text-primary transition-colors">Terms</a>
            <a href="#" className="hover:text-primary transition-colors">Privacy</a>
            <a href="#" className="hover:text-primary transition-colors">Support</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;

import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Home, Search } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-gradient-hero flex items-center justify-center p-4">
      <Card className="p-8 text-center max-w-md shadow-glow animate-fade-in">
        <div className="flex items-center justify-center mb-6">
          <div className="bg-primary/10 p-4 rounded-full">
            <Search className="h-12 w-12 text-primary" />
          </div>
        </div>

        <h1 className="text-6xl font-bold text-primary mb-2">404</h1>
        <h2 className="text-2xl font-bold mb-2">Page Not Found</h2>
        <p className="text-muted-foreground mb-6">
          The page you're looking for doesn't exist or has been moved.
        </p>

        <Link to="/">
          <Button variant="hero" size="lg" className="w-full">
            <Home className="mr-2 h-4 w-4" />
            Return to Home
          </Button>
        </Link>
      </Card>
    </div>
  );
};

export default NotFound;

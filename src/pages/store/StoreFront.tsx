import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Store, Phone, MessageCircle, ShoppingBag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  images: string[];
}

interface StoreData {
  id: string;
  store_name: string;
  contact_phone: string;
  products: Product[];
}

const StoreFront = () => {
  const { storeName } = useParams();
  const [store, setStore] = useState<StoreData | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    loadStore();
  }, [storeName]);

  const loadStore = async () => {
    if (!storeName) return;
    
    setLoading(true);
    
    const normalizedName = storeName.toLowerCase().replace(/-/g, ' ');
    
    const { data: storeData, error: storeError } = await supabase
      .from('stores')
      .select('*')
      .ilike('store_name', normalizedName)
      .eq('is_active', true)
      .maybeSingle();
    
    if (storeError || !storeData) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    
    // Track visitor
    await supabase
      .from('store_visitors')
      .insert({
        store_id: storeData.id,
      });
    
    const { data: productsData } = await supabase
      .from('products')
      .select('*')
      .eq('store_id', storeData.id)
      .order('created_at', { ascending: false });
    
    setStore({
      ...storeData,
      products: productsData || [],
    });
    setLoading(false);
  };

  const handleContactSeller = () => {
    if (!store) return;
    const phone = store.contact_phone.replace(/\D/g, '');
    window.open(`https://wa.me/${phone}`, '_blank');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (notFound || !store) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="p-12 text-center max-w-md">
          <Store className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-2xl font-bold mb-2">Store Not Found</h2>
          <p className="text-muted-foreground">
            This store doesn't exist or has been deactivated
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Store Header */}
      <header className="bg-gradient-primary text-white py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-4 mb-4">
            <div className="bg-white/10 backdrop-blur-sm p-3 rounded-xl">
              <Store className="h-8 w-8" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">{store.store_name}</h1>
              <p className="text-white/80 flex items-center gap-2 mt-1">
                <Phone className="h-4 w-4" />
                {store.contact_phone}
              </p>
            </div>
          </div>
          
          <Button 
            variant="accent" 
            onClick={handleContactSeller}
            className="w-full sm:w-auto"
          >
            <MessageCircle className="mr-2 h-4 w-4" />
            Contact Seller on WhatsApp
          </Button>
        </div>
      </header>

      {/* Products Section */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-2">Our Products</h2>
          <p className="text-muted-foreground">
            {store.products.length} products available
          </p>
        </div>

        {store.products.length === 0 ? (
          <Card className="p-12 text-center">
            <ShoppingBag className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-xl font-semibold mb-2">No Products Available</h3>
            <p className="text-muted-foreground">
              This store is still setting up. Check back soon!
            </p>
          </Card>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {store.products.map((product) => (
              <Card 
                key={product.id} 
                className="overflow-hidden shadow-card hover:shadow-glow transition-all cursor-pointer"
                onClick={() => setSelectedProduct(product)}
              >
                <div className="aspect-square bg-muted flex items-center justify-center">
                  {product.images.length > 0 ? (
                    <img 
                      src={product.images[0]} 
                      alt={product.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <ShoppingBag className="h-16 w-16 text-muted-foreground" />
                  )}
                </div>
                <div className="p-4">
                  <h3 className="font-semibold mb-2">{product.name}</h3>
                  <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                    {product.description}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-xl font-bold text-primary">
                      ${product.price.toFixed(2)}
                    </span>
                    <Button size="sm" variant="hero">
                      View Details
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Product Detail Modal */}
        {selectedProduct && (
          <div 
            className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
            onClick={() => setSelectedProduct(null)}
          >
            <Card 
              className="w-full max-w-3xl max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="grid md:grid-cols-2 gap-6 p-6">
                <div className="space-y-4">
                  <div className="aspect-square bg-muted rounded-lg flex items-center justify-center">
                    {selectedProduct.images.length > 0 ? (
                      <img 
                        src={selectedProduct.images[0]} 
                        alt={selectedProduct.name}
                        className="w-full h-full object-cover rounded-lg"
                      />
                    ) : (
                      <ShoppingBag className="h-24 w-24 text-muted-foreground" />
                    )}
                  </div>
                  {selectedProduct.images.length > 1 && (
                    <div className="grid grid-cols-3 gap-2">
                      {selectedProduct.images.slice(1).map((img, i) => (
                        <div key={i} className="aspect-square bg-muted rounded overflow-hidden">
                          <img 
                            src={img} 
                            alt={`${selectedProduct.name} ${i + 2}`}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                
                <div className="flex flex-col">
                  <h2 className="text-2xl font-bold mb-2">{selectedProduct.name}</h2>
                  <p className="text-3xl font-bold text-primary mb-4">
                    ${selectedProduct.price.toFixed(2)}
                  </p>
                  <p className="text-muted-foreground mb-6">
                    {selectedProduct.description}
                  </p>
                  
                  <div className="mt-auto space-y-3">
                    <Button 
                      variant="hero" 
                      className="w-full" 
                      size="lg"
                      onClick={handleContactSeller}
                    >
                      <MessageCircle className="mr-2 h-5 w-5" />
                      Contact Seller to Buy
                    </Button>
                    <Button 
                      variant="outline" 
                      className="w-full"
                      onClick={() => setSelectedProduct(null)}
                    >
                      Close
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-card border-t py-8 px-4 sm:px-6 lg:px-8 mt-12">
        <div className="max-w-7xl mx-auto text-center text-muted-foreground">
          <p className="mb-2">Powered by Tech fusion Solutions</p>
          <p className="text-sm">Create your own store in minutes</p>
        </div>
      </footer>
    </div>
  );
};

export default StoreFront;

import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Store, Plus, Edit, Trash2, ExternalLink, Copy, Package } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  images: string[];
}

const Dashboard = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [editingProduct, setEditingProduct] = useState<string | null>(null);
  const { toast } = useToast();
  
  const storeUrl = "sellerapp.com/my-awesome-store";
  const maxProducts = 12;
  const maxImagesPerProduct = 3;

  const copyStoreUrl = () => {
    navigator.clipboard.writeText(`https://${storeUrl}`);
    toast({
      title: "URL Copied!",
      description: "Share your store link with customers",
    });
  };

  const handleDeleteProduct = (productId: string) => {
    setProducts(products.filter(p => p.id !== productId));
    toast({
      title: "Product Deleted",
      description: "Product has been removed from your store",
    });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-gradient-primary p-2 rounded-lg">
                <Store className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold">My Awesome Store</h1>
                <p className="text-sm text-muted-foreground">Seller Dashboard</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Link to="/">
                <Button variant="ghost" size="sm">
                  Logout
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Store URL Card */}
        <Card className="p-6 mb-8 shadow-card bg-gradient-primary text-white">
          <h2 className="text-lg font-semibold mb-4">Your Store URL</h2>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 bg-white/10 backdrop-blur-sm rounded-lg p-3 font-mono text-sm">
              https://{storeUrl}
            </div>
            <Button 
              variant="accent" 
              onClick={copyStoreUrl}
              className="sm:w-auto"
            >
              <Copy className="mr-2 h-4 w-4" />
              Copy Link
            </Button>
            <Link to={`/store/my-awesome-store`} target="_blank">
              <Button 
                variant="outline" 
                className="w-full sm:w-auto bg-white/10 border-white/20 text-white hover:bg-white/20"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Preview
              </Button>
            </Link>
          </div>
        </Card>

        {/* Products Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold">Your Products</h2>
            <p className="text-muted-foreground">
              {products.length} of {maxProducts} products
            </p>
          </div>
          
          {products.length < maxProducts && (
            <Button 
              variant="hero" 
              onClick={() => setShowAddProduct(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Product
            </Button>
          )}
        </div>

        {/* Products Grid */}
        {products.length === 0 ? (
          <Card className="p-12 text-center">
            <Package className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-xl font-semibold mb-2">No Products Yet</h3>
            <p className="text-muted-foreground mb-6">
              Start adding products to your store to begin selling
            </p>
            <Button variant="hero" onClick={() => setShowAddProduct(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Your First Product
            </Button>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {products.map((product) => (
              <Card key={product.id} className="overflow-hidden shadow-card hover:shadow-glow transition-all">
                <div className="aspect-square bg-muted flex items-center justify-center">
                  {product.images.length > 0 ? (
                    <img 
                      src={product.images[0]} 
                      alt={product.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Package className="h-16 w-16 text-muted-foreground" />
                  )}
                </div>
                <div className="p-4">
                  <h3 className="font-semibold mb-1">{product.name}</h3>
                  <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                    {product.description}
                  </p>
                  <p className="text-lg font-bold text-primary mb-3">
                    ${product.price.toFixed(2)}
                  </p>
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="flex-1"
                      onClick={() => setEditingProduct(product.id)}
                    >
                      <Edit className="mr-2 h-4 w-4" />
                      Edit
                    </Button>
                    <Button 
                      variant="destructive" 
                      size="sm"
                      onClick={() => handleDeleteProduct(product.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Add/Edit Product Form */}
        {(showAddProduct || editingProduct) && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
              <h2 className="text-2xl font-bold mb-6">
                {editingProduct ? "Edit Product" : "Add New Product"}
              </h2>
              
              <form className="space-y-4">
                <div className="space-y-2">
                  <Label>Product Images (Max {maxImagesPerProduct})</Label>
                  <div className="grid grid-cols-3 gap-4">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="aspect-square border-2 border-dashed rounded-lg flex items-center justify-center bg-muted hover:bg-muted/80 cursor-pointer transition-colors">
                        <Plus className="h-8 w-8 text-muted-foreground" />
                      </div>
                    ))}
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="productName">Product Name *</Label>
                  <Input
                    id="productName"
                    placeholder="e.g., Handmade Leather Bag"
                    required
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="description">Description *</Label>
                  <Textarea
                    id="description"
                    placeholder="Describe your product..."
                    rows={4}
                    required
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="price">Price *</Label>
                  <Input
                    id="price"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    required
                  />
                </div>
                
                <div className="flex gap-3">
                  <Button type="submit" variant="hero" className="flex-1">
                    {editingProduct ? "Save Changes" : "Add Product"}
                  </Button>
                  <Button 
                    type="button" 
                    variant="outline"
                    onClick={() => {
                      setShowAddProduct(false);
                      setEditingProduct(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
};

export default Dashboard;

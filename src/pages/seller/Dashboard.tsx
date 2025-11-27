import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Store, Plus, Edit, Trash2, ExternalLink, Copy, Package, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
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
}

const Dashboard = () => {
  const [store, setStore] = useState<StoreData | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  
  // Form state
  const [productName, setProductName] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [productPrice, setProductPrice] = useState("");
  const [productImages, setProductImages] = useState<string[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  
  const { toast } = useToast();
  const { user, signOut } = useAuth();
  
  const maxProducts = 12;
  const maxImagesPerProduct = 3;

  useEffect(() => {
    loadStoreAndProducts();
  }, [user]);

  const loadStoreAndProducts = async () => {
    if (!user) return;
    
    setLoading(true);
    
    // Load store
    const { data: storeData, error: storeError } = await supabase
      .from('stores')
      .select('*')
      .eq('seller_id', user.id)
      .maybeSingle();
    
    if (storeError || !storeData) {
      setLoading(false);
      return;
    }
    
    setStore(storeData);
    
    // Load products
    const { data: productsData, error: productsError } = await supabase
      .from('products')
      .select('*')
      .eq('store_id', storeData.id)
      .order('created_at', { ascending: false });
    
    if (!productsError && productsData) {
      setProducts(productsData);
    }
    
    setLoading(false);
  };

  const copyStoreUrl = () => {
    const url = `${import.meta.env.VITE_STORE_URL}/${store?.store_name?.toLowerCase().replace(/\s+/g, '-')}`;
    navigator.clipboard.writeText(url);
    toast({
      title: "URL Copied!",
      description: "Share your store link with customers",
    });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (uploadedFiles.length + files.length > maxImagesPerProduct) {
      toast({
        title: "Too Many Images",
        description: `Maximum ${maxImagesPerProduct} images per product`,
        variant: "destructive",
      });
      return;
    }
    setUploadedFiles([...uploadedFiles, ...files]);
  };

  const removeFile = (index: number) => {
    setUploadedFiles(uploadedFiles.filter((_, i) => i !== index));
  };

  const uploadImages = async (files: File[]): Promise<string[]> => {
    const urls: string[] = [];
    
    for (const file of files) {
      const fileExt = file.name.split('.').pop();
      const fileName = `${user?.id}/${Math.random()}.${fileExt}`;
      
      const { data, error } = await supabase.storage
        .from('product-images')
        .upload(fileName, file);
      
      if (error) throw error;
      
      const { data: { publicUrl } } = supabase.storage
        .from('product-images')
        .getPublicUrl(fileName);
      
      urls.push(publicUrl);
    }
    
    return urls;
  };

  const handleSubmitProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!store) return;
    
    if (uploadedFiles.length === 0 && !editingProduct) {
      toast({
        title: "Images Required",
        description: "Please upload at least one product image",
        variant: "destructive",
      });
      return;
    }
    
    if (!editingProduct && products.length >= maxProducts) {
      toast({
        title: "Product Limit Reached",
        description: `Maximum ${maxProducts} products allowed`,
        variant: "destructive",
      });
      return;
    }
    
    setUploading(true);
    
    try {
      let imageUrls = editingProduct ? editingProduct.images : [];
      
      if (uploadedFiles.length > 0) {
        const newUrls = await uploadImages(uploadedFiles);
        imageUrls = [...imageUrls, ...newUrls].slice(0, maxImagesPerProduct);
      }
      
      const productData = {
        store_id: store.id,
        name: productName,
        description: productDescription,
        price: parseFloat(productPrice),
        images: imageUrls,
      };
      
      if (editingProduct) {
        const { error } = await supabase
          .from('products')
          .update(productData)
          .eq('id', editingProduct.id);
        
        if (error) throw error;
        
        toast({
          title: "Product Updated",
          description: "Your product has been updated successfully",
        });
      } else {
        const { error } = await supabase
          .from('products')
          .insert(productData);
        
        if (error) throw error;
        
        toast({
          title: "Product Added",
          description: "Your product has been added to your store",
        });
      }
      
      resetForm();
      await loadStoreAndProducts();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Could not save product",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteProduct = async (productId: string) => {
    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', productId);
    
    if (error) {
      toast({
        title: "Error",
        description: "Could not delete product",
        variant: "destructive",
      });
      return;
    }
    
    toast({
      title: "Product Deleted",
      description: "Product has been removed from your store",
    });
    
    await loadStoreAndProducts();
  };

  const resetForm = () => {
    setProductName("");
    setProductDescription("");
    setProductPrice("");
    setProductImages([]);
    setUploadedFiles([]);
    setShowAddProduct(false);
    setEditingProduct(null);
  };

  const startEdit = (product: Product) => {
    setEditingProduct(product);
    setProductName(product.name);
    setProductDescription(product.description || "");
    setProductPrice(product.price.toString());
    setProductImages(product.images);
    setUploadedFiles([]);
  };

  const handleLogout = async () => {
    await signOut();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!store) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="p-8 text-center">
          <Store className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-2xl font-bold mb-2">No Store Found</h2>
          <p className="text-muted-foreground mb-4">
            You need to set up your store first
          </p>
          <Link to="/seller/onboarding">
            <Button variant="hero">Set Up Store</Button>
          </Link>
        </Card>
      </div>
    );
  }

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
                <h1 className="text-xl font-bold">{store.store_name}</h1>
                <p className="text-sm text-muted-foreground">Seller Dashboard</p>
              </div>
            </div>
            
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Store URL Card */}
        <Card className="p-6 mb-8 shadow-card bg-gradient-primary text-white">
          <h2 className="text-lg font-semibold mb-4">Your Store URL</h2>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 bg-white/10 backdrop-blur-sm rounded-lg p-3 font-mono text-sm">
              {import.meta.env.VITE_STORE_URL}/{store.store_name.toLowerCase().replace(/\s+/g, '-')}
            </div>
            <Button
              variant="accent" 
              onClick={copyStoreUrl}
              className="sm:w-auto"
            >
              <Copy className="mr-2 h-4 w-4" />
              Copy Link
            </Button>
            <Link to={`/store/${store.store_name.toLowerCase().replace(/\s+/g, '-')}`} target="_blank">
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
                      onClick={() => startEdit(product)}
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
              
              <form onSubmit={handleSubmitProduct} className="space-y-4">
                <div className="space-y-2">
                  <Label>Product Images (Max {maxImagesPerProduct})</Label>
                  <div className="grid grid-cols-3 gap-4">
                    {uploadedFiles.map((file, i) => (
                      <div key={i} className="relative aspect-square border-2 rounded-lg overflow-hidden">
                        <img 
                          src={URL.createObjectURL(file)} 
                          alt={`Upload ${i + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => removeFile(i)}
                          className="absolute top-1 right-1 bg-destructive text-white rounded-full p-1"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                    {productImages.map((url, i) => (
                      <div key={`existing-${i}`} className="aspect-square border-2 rounded-lg overflow-hidden">
                        <img 
                          src={url} 
                          alt={`Product ${i + 1}`}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ))}
                    {(uploadedFiles.length + productImages.length) < maxImagesPerProduct && (
                      <label className="aspect-square border-2 border-dashed rounded-lg flex items-center justify-center bg-muted hover:bg-muted/80 cursor-pointer transition-colors">
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={handleFileSelect}
                          className="hidden"
                        />
                        <Plus className="h-8 w-8 text-muted-foreground" />
                      </label>
                    )}
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="productName">Product Name *</Label>
                  <Input
                    id="productName"
                    placeholder="e.g., Handmade Leather Bag"
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    required
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="description">Description *</Label>
                  <Textarea
                    id="description"
                    placeholder="Describe your product..."
                    rows={4}
                    value={productDescription}
                    onChange={(e) => setProductDescription(e.target.value)}
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
                    value={productPrice}
                    onChange={(e) => setProductPrice(e.target.value)}
                    required
                  />
                </div>
                
                <div className="flex gap-3">
                  <Button type="submit" variant="hero" className="flex-1" disabled={uploading}>
                    {uploading ? "Saving..." : (editingProduct ? "Save Changes" : "Add Product")}
                  </Button>
                  <Button 
                    type="button" 
                    variant="outline"
                    onClick={resetForm}
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

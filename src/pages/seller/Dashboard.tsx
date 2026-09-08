import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import {
  Store,
  Plus,
  Edit,
  Trash2,
  ExternalLink,
  Copy,
  Package,
  X,
  Mail,
  Phone,
  BarChart3,
  LogOut,
  Pencil
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/logo.png";
import { formatCurrency } from "@/lib/utils";
import { isReservedStoreName } from "@/lib/constants";
import { RoleSwitcher } from "@/components/RoleSwitcher";
import {
  formatPhoneForDisplay,
  isValidContactPhone,
  storeSlug,
  storeUrl
} from "@/lib/store";

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
  slug: string | null;
  contact_phone: string;
  whatsapp_phone: string | null;
}


const Dashboard = () => {
  const navigate = useNavigate();
  const [store, setStore] = useState<StoreData | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  // Form state
  const [productName, setProductName] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [productPrice, setProductPrice] = useState("");
  const [productImages, setProductImages] = useState<string[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);

  // Edit store state
  const [showEditStore, setShowEditStore] = useState(false);
  const [editStoreName, setEditStoreName] = useState("");
  const [editContactPhone, setEditContactPhone] = useState("");
  const [savingStore, setSavingStore] = useState(false);

  const { toast } = useToast();
  const { user, signOut } = useAuth();

  const maxProducts = 12;
  const maxImagesPerProduct = 3;

  useEffect(() => {
    checkAdmin();
    loadStoreAndProducts();
  }, [user]);

  const loadStoreAndProducts = async () => {
    if (!user) return;

    setLoading(true);

    // Load store
    const { data: storeData, error: storeError } = await supabase
      .from("stores")
      .select("*")
      .eq("seller_id", user.id)
      .maybeSingle();

    if (storeError || !storeData) {
      setLoading(false);
      return;
    }

    setStore(storeData);

    // Load products
    const { data: productsData, error: productsError } = await supabase
      .from("products")
      .select("*")
      .eq("store_id", storeData.id)
      .order("created_at", { ascending: false });

    if (!productsError && productsData) {
      setProducts(productsData);
    }

    setLoading(false);
  };

  const checkAdmin = async () => {
    if (!user) return;

    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    // Dual-role users stay here and choose their view with the switcher.
    setIsAdmin(!!data);
  };

  const copyStoreUrl = async () => {
    if (!store) return;
    try {
      await navigator.clipboard.writeText(storeUrl(store));
      toast({
        title: "Link copied",
        description: "Share your store link with customers"
      });
    } catch {
      toast({
        title: "Could not copy",
        description: "Long-press the link above to copy it manually",
        variant: "destructive"
      });
    }
  };


  const openEditStore = () => {
    if (!store) return;
    setEditStoreName(store.store_name);
    setEditContactPhone(store.contact_phone);
    setShowEditStore(true);
  };

  const handleSaveStore = async () => {
    if (!store) return;

    const trimmedName = editStoreName.trim();

    if (trimmedName.length < 3) {
      toast({ title: "Invalid Store Name", description: "Store name must be at least 3 characters", variant: "destructive" });
      return;
    }

    if (isReservedStoreName(trimmedName)) {
      toast({ title: "Store Name Not Available", description: "This store name is reserved. Please choose a different name.", variant: "destructive" });
      return;
    }

    if (!isValidContactPhone(editContactPhone)) {
      toast({ title: "Invalid Phone Number", description: "Enter a valid WhatsApp number, e.g. 08031234567", variant: "destructive" });
      return;
    }


    setSavingStore(true);

    // Check uniqueness (case-insensitive) excluding current store
    const { data: existing } = await supabase
      .from("stores")
      .select("id")
      .ilike("store_name", trimmedName)
      .neq("id", store.id)
      .maybeSingle();

    if (existing) {
      toast({ title: "Store Name Taken", description: "Another store already uses this name. Please choose a different one.", variant: "destructive" });
      setSavingStore(false);
      return;
    }

    const { error } = await supabase
      .from("stores")
      .update({ store_name: trimmedName, contact_phone: editContactPhone })
      .eq("id", store.id);

    if (error) {
      toast({ title: "Error", description: error.message || "Could not update store", variant: "destructive" });
      setSavingStore(false);
      return;
    }

    toast({ title: "Store Updated", description: "Your store details have been updated successfully" });
    setShowEditStore(false);
    setSavingStore(false);
    await loadStoreAndProducts();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    const maxBytes = 5 * 1024 * 1024;

    if (uploadedFiles.length + productImages.length + files.length > maxImagesPerProduct) {
      toast({
        title: "Too Many Images",
        description: `Maximum ${maxImagesPerProduct} images per product`,
        variant: "destructive"
      });
      e.target.value = "";
      return;
    }

    const badType = files.find(f => !allowed.includes(f.type));
    if (badType) {
      toast({
        title: "Unsupported Image",
        description: "Please upload JPG, PNG or WebP photos only",
        variant: "destructive"
      });
      e.target.value = "";
      return;
    }

    const tooBig = files.find(f => f.size > maxBytes);
    if (tooBig) {
      toast({
        title: "Image Too Large",
        description: "Each photo must be smaller than 5MB",
        variant: "destructive"
      });
      e.target.value = "";
      return;
    }

    setUploadedFiles([...uploadedFiles, ...files]);
    e.target.value = "";
  };


  const removeFile = (index: number) => {
    setUploadedFiles(uploadedFiles.filter((_, i) => i !== index));
  };

  const removeExistingImage = (index: number) => {
    setProductImages(productImages.filter((_, i) => i !== index));
  };

  const uploadImages = async (files: File[]): Promise<string[]> => {
    const urls: string[] = [];

    for (const file of files) {
      const fileExt = file.name.split(".").pop();
      const fileName = `${user?.id}/${Math.random()}.${fileExt}`;

      const { data, error } = await supabase.storage
        .from("product-images")
        .upload(fileName, file);

      if (error) throw error;

      const {
        data: { publicUrl }
      } = supabase.storage.from("product-images").getPublicUrl(fileName);

      urls.push(publicUrl);
    }

    return urls;
  };

  const handleSubmitProduct = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!store) return;

    const totalImages = uploadedFiles.length + (editingProduct ? productImages.length : 0);
    if (totalImages === 0) {
      toast({
        title: "Images Required",
        description: "Please upload at least one product image",
        variant: "destructive"
      });
      return;
    }

    if (!editingProduct && products.length >= maxProducts) {
      toast({
        title: "Product Limit Reached",
        description: `Maximum ${maxProducts} products allowed`,
        variant: "destructive"
      });
      return;
    }

    setUploading(true);

    try {
      let imageUrls = editingProduct ? productImages : [];

      if (uploadedFiles.length > 0) {
        const newUrls = await uploadImages(uploadedFiles);
        imageUrls = [...imageUrls, ...newUrls].slice(0, maxImagesPerProduct);
      }

      const productData = {
        store_id: store.id,
        name: productName,
        description: productDescription,
        price: parseFloat(productPrice),
        images: imageUrls
      };

      if (editingProduct) {
        const { error } = await supabase
          .from("products")
          .update(productData)
          .eq("id", editingProduct.id);

        if (error) throw error;

        toast({
          title: "Product Updated",
          description: "Your product has been updated successfully"
        });
      } else {
        const { error } = await supabase.from("products").insert(productData);

        if (error) throw error;

        toast({
          title: "Product Added",
          description: "Your product has been added to your store"
        });
      }

      resetForm();
      await loadStoreAndProducts();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Could not save product",
        variant: "destructive"
      });
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteProduct = async (productId: string) => {
    setIsDeleting(true);
    const { error } = await supabase
      .from("products")
      .delete()
      .eq("id", productId);

    if (error) {
      toast({
        title: "Error",
        description: "Could not delete product",
        variant: "destructive"
      });
      setIsDeleting(false);
      return;
    }

    setShowDeleteModal(false);
    setIsDeleting(false);
    setDeletingProduct(null);
    toast({
      title: "Product Deleted",
      description: "Product has been removed from your store"
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

  const handleDescriptionChange = (
    e: React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    // Limit to 200 words
    const words = e.target.value.split(" ");
    if (words.length > 200) {
      e.target.value = words.slice(0, 200).join(" ");
    }
    setProductDescription(e.target.value);
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
      <div className="w-full h-full min-h-screen flex flex-col">
        {/* Header */}
        <header className="h-fit w-full bg-card border-b shadow-sm sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="bg-white rounded-xl shrink-0 p-3 border border-gray-100">
                  <img src={logo} className="h-8 w-8 text-white" alt="" />
                </div>
                <div></div>
              </div>

              <div className="w-full md:w-fit flex gap-2 justify-end md:gap-4 md:items-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLogout}
                  className="hidden md:flex">
                  Logout
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLogout}
                  className="md:hidden">
                  <LogOut className="mr-0 h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </header>
        <div className="h-full flex-grow flex justify-center items-center p-4">
          <Card className="p-8 text-center">
            <Store className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-2xl font-bold mb-2">No Store Found</h2>
            <p className="text-muted-foreground mb-4">
              You need to set up your store first
            </p>
            <Link to="/seller/onboarding">
              <Button variant="hero">Set Up Store</Button>
            </Link>

            {isAdmin && (
              <div>
                <Link to="/admin" className="mt-4 inline-block">
                  <Button variant="outline">Go to Admin Dashboard</Button>
                </Link>
              </div>
            )}
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-white rounded-xl shrink-0 p-3 border border-gray-100">
                <img src={logo} className="h-8 w-8 text-white" alt="" />
              </div>
              <div>
                <h1 className="text-xl font-bold">{store.store_name}</h1>
                {/* <div className="flex flex-wrap items-center gap-1 md:gap-3 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Mail className="h-3 w-3" />
                    {user?.email}
                  </span>
                  <span className="flex items-center gap-1">
                    <Phone className="h-3 w-3" />
                    {store.contact_phone}
                  </span>
                </div> */}
              </div>
            </div>

            <div className="w-full md:w-fit flex gap-2 justify-end md:gap-4 md:items-center">
              <Link to="/seller/analytics">
                <Button variant="outline" size="sm">
                  <BarChart3 className="mr-0 h-4 w-4" />
                  <span className="hidden md:flex">Analytics</span>
                </Button>
              </Link>
              {/* eslint-disable-next-line */}
              <RoleSwitcher />

              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                className="hidden md:flex">
                Logout
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleLogout}
                className="md:hidden">
                <LogOut className="mr-0 h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Store URL Card */}
        <Card className="p-6 mb-8 shadow-card bg-gradient-primary text-white">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
            <div>
              <h2 className="text-lg font-semibold">Your Store URL</h2>
              <p className="text-xs text-white/90 font-medium">
                Share your store with customers using the link below.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right text-xs text-white">
                <p className="flex items-center gap-1 justify-end">
                  <Phone className="h-3 w-3" />
                  {store.contact_phone}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="bg-white/10 border-white/20 text-white hover:bg-white/20"
                onClick={openEditStore}>
                <Pencil className="h-3.5 w-3.5 mr-1" />
                Edit
              </Button>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 bg-white/10 backdrop-blur-sm rounded-lg p-3 font-mono text-sm break-all">
              {import.meta.env.VITE_STORE_URL}/store/
              {store.store_name.toLowerCase().replace(/\s+/g, "-")}
            </div>
            <Button
              variant="accent"
              onClick={copyStoreUrl}
              className="sm:w-auto">
              <Copy className="mr-2 h-4 w-4" />
              Copy Link
            </Button>
            <Link
              to={`/store/${store.store_name
                .toLowerCase()
                .replace(/\s+/g, "-")}`}
              target="_blank">
              <Button
                variant="outline"
                className="w-full sm:w-auto bg-white/10 border-white/20 text-white hover:bg-white/20">
                <ExternalLink className="mr-2 h-4 w-4" />
                Preview
              </Button>
            </Link>
          </div>
          <p className="text-xs text-white/90 mt-3 text-center sm:text-left">
            When shared on social media, your store will show your name and
            contact info for better engagement.
          </p>
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
            <Button variant="hero" onClick={() => setShowAddProduct(true)}>
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
            {products.map(product => (
              <Card
                key={product.id}
                className="overflow-hidden shadow-card hover:shadow-glow transition-all">
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
                    {formatCurrency(product.price)}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => startEdit(product)}>
                      <Edit className="mr-2 h-4 w-4" />
                      Edit
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        setDeletingProduct(product);
                        setShowDeleteModal(true);
                      }}>
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
                      <div
                        key={i}
                        className="relative aspect-square border-2 rounded-lg overflow-hidden">
                        <img
                          src={URL.createObjectURL(file)}
                          alt={`Upload ${i + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => removeFile(i)}
                          className="absolute top-1 right-1 bg-destructive text-white rounded-full p-1">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                    {productImages.map((url, i) => (
                      <div
                        key={`existing-${i}`}
                        className="relative aspect-square border-2 rounded-lg overflow-hidden">
                        <img
                          src={url}
                          alt={`Product ${i + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => removeExistingImage(i)}
                          className="absolute top-1 right-1 bg-destructive text-white rounded-full p-1">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                    {uploadedFiles.length + productImages.length <
                      maxImagesPerProduct && (
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
                    onChange={e => setProductName(e.target.value)}
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
                    onChange={handleDescriptionChange}
                    required
                  />
                  <p className="text-xs text-muted-foreground text-right">
                    {productDescription.length === 0
                      ? 0
                      : productDescription.split(" ").length}
                    /200 words
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="price">Price *</Label>
                  <Input
                    id="price"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={productPrice}
                    onChange={e => setProductPrice(e.target.value)}
                    required
                  />
                </div>

                <div className="flex gap-3">
                  <Button
                    type="submit"
                    variant="hero"
                    className="flex-1"
                    disabled={uploading}>
                    {uploading
                      ? "Saving..."
                      : editingProduct
                        ? "Save Changes"
                        : "Add Product"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={resetForm}
                    disabled={uploading}>
                    Cancel
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        )}

        {/* Edit Store Dialog */}
        <Dialog open={showEditStore} onOpenChange={setShowEditStore}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Store Details</DialogTitle>
              <DialogDescription>
                Update your store name and contact phone number.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="editStoreName">Store Name</Label>
                <Input
                  id="editStoreName"
                  value={editStoreName}
                  onChange={e => {
                    const value = e.target.value.replace(/[^a-zA-Z0-9\s]/g, "");
                    setEditStoreName(value);
                  }}
                  placeholder="My Awesome Store"
                />
                <p className="text-[10px] text-muted-foreground">
                  Only letters, numbers, and spaces are allowed.
                </p>
                <p className="text-xs text-muted-foreground">
                  Store URL: {import.meta.env.VITE_STORE_URL}/store/
                  {editStoreName.trim().toLowerCase().replace(/\s+/g, "-") || "your-store-name"}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="editContactPhone">Contact Phone</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="editContactPhone"
                    type="tel"
                    value={editContactPhone}
                    onChange={e => setEditContactPhone(e.target.value)}
                    placeholder="+234xxxxxxxxxx"
                    className="pl-10"
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowEditStore(false)}
                disabled={savingStore}>
                Cancel
              </Button>
              <Button
                variant="hero"
                onClick={handleSaveStore}
                disabled={savingStore}>
                {savingStore ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {showDeleteModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
              <h2 className="text-2xl font-bold mb-6">
                Confirm Product Deletion
              </h2>
              <p className="text-gray-600 mb-5">
                Are you sure you want to delete this product? This action cannot
                be undone.
              </p>
              <div className="flex justify-end gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="w-fit mt-4"
                  onClick={() => {
                    setShowDeleteModal(false);
                    setDeletingProduct(null);
                  }}
                  disabled={isDeleting}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="w-fit mt-4"
                  disabled={isDeleting}
                  onClick={() => handleDeleteProduct(deletingProduct.id)}>
                  {isDeleting ? "Deleting..." : "Delete"}
                </Button>
              </div>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
};

export default Dashboard;

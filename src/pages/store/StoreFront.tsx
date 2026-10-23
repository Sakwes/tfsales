import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { brandingStyle } from "@/lib/branding";
import { useStoreBranding } from "@/hooks/use-store-branding";
import { stockState } from "@/lib/plan";
import { CheckoutDialog } from "@/components/store/CheckoutDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Store,
  Phone,
  MessageCircle,
  ShoppingBag,
  ShoppingCart,
  Minus,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { useMetaTags } from "@/hooks/use-meta-tags";
import { isReservedStoreName } from "@/lib/constants";
import {
  formatPhoneForDisplay,
  siteOrigin,
  slugify,
  storeSlug,
  whatsAppLink
} from "@/lib/store";

interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
  images: string[];
  is_available: boolean;
  track_stock: boolean;
  stock_quantity: number;
  low_stock_threshold: number;
}

interface CartItem {
  id: string;
  name: string;
  price: number;
  image: string | null;
  quantity: number;
}

interface StoreData {
  id: string;
  store_name: string;
  slug: string | null;
  contact_phone: string;
  whatsapp_phone: string | null;
  products: Product[];
}

const cartKey = (storeId: string) => `sellnova:cart:${storeId}`;

const StoreFront = () => {
  const { storeName } = useParams();
  const [store, setStore] = useState<StoreData | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartStoreId, setCartStoreId] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutItems, setCheckoutItems] = useState<CartItem[]>([]);
  const [checkoutAttempt, setCheckoutAttempt] = useState(0);
  const [hasReceipt, setHasReceipt] = useState(false);

  const loadedStoreId = store?.id;
  const { branding, logoUrl, clearLogo } = useStoreBranding(loadedStoreId);
  const theme = brandingStyle(branding);
  const catalogGeneration = useRef(0);
  const currentStore = useRef(loadedStoreId);
  currentStore.current = loadedStoreId;
  const refreshCatalog = useCallback(async () => {
    if (!loadedStoreId) return null;
    const token = ++catalogGeneration.current;
    try {
      const result = await supabase.rpc("sellnova_storefront_products", { _store_id: loadedStoreId });
      if (currentStore.current !== loadedStoreId || token !== catalogGeneration.current) return null;
      if (result.error) throw result.error;
      const products = (result.data ?? []) as Product[];
      setStore(previous => previous?.id === loadedStoreId ? { ...previous, products } : previous);
      setSelectedProduct(previous => previous ? products.find(p => p.id === previous.id) ?? null : null);
      setCatalogError("");
      return products;
    } catch {
      if (currentStore.current === loadedStoreId && token === catalogGeneration.current) {
        setCatalogError("We could not verify the current catalog. Please refresh before ordering.");
        setStore(previous => previous?.id === loadedStoreId ? { ...previous, products: [] } : previous);
        setSelectedProduct(null);
      }
      return null;
    }
  }, [loadedStoreId]);
  useEffect(() => {
    if (!loadedStoreId) return;
    const visible = () => { if (document.visibilityState === "visible") void refreshCatalog(); };
    const timer = window.setInterval(visible, 15_000);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); };
  }, [loadedStoreId, refreshCatalog]);

  const cartCount = cart.reduce((sum, i) => sum + i.quantity, 0);
  const cartTotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);

  const whatsappNumber = store?.whatsapp_phone || store?.contact_phone || "";
  const canonicalUrl = useMemo(
    () => `${siteOrigin()}/store/${storeSlug(store) || storeName || ""}`,
    [store, storeName]
  );

  useMetaTags({
    title: store
      ? `${store.store_name} — Shop online on SellNova`
      : "Loading store… | SellNova",
    description: store
      ? `Browse ${store.products.length} product${
          store.products.length === 1 ? "" : "s"
        } from ${store.store_name} and order instantly on WhatsApp.`
      : "Loading store details…",
    image: store?.products?.[0]?.images?.[0] || "/logo.png",
    url: canonicalUrl,
    type: "website",
    phone: store ? formatPhoneForDisplay(whatsappNumber) : undefined,
    storeName: store?.store_name
  });

  const loadStore = useCallback(async () => {
    if (!storeName) return;

    if (isReservedStoreName(storeName)) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    setNotFound(false);

    const requested = slugify(storeName);

    // Canonical slug lookup first.
    let { data: storeData } = await supabase
      .from("stores")
      .select("*")
      .eq("slug", requested)
      .eq("is_active", true)
      .maybeSingle();

    // Legacy fallback: old links were built from the store name directly.
    if (!storeData) {
      const pattern = requested.replace(/-/g, "_");
      const { data: legacy } = await supabase
        .from("stores")
        .select("*")
        .ilike("store_name", pattern)
        .eq("is_active", true)
        .limit(1);
      storeData = legacy?.[0] ?? null;
    }

    if (!storeData) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    const { data: productsData, error: productsError } = await supabase.rpc("sellnova_storefront_products", { _store_id: storeData.id });
    setCatalogError(productsError ? "We could not verify the current catalog. Please refresh before ordering." : "");

    setStore({
      id: storeData.id,
      store_name: storeData.store_name,
      slug: storeData.slug,
      contact_phone: storeData.contact_phone,
      whatsapp_phone: storeData.whatsapp_phone,
      products: (productsData || []) as Product[]
    });
    setLoading(false);

    // Count one visit per browsing session per store.
    const visitKey = `sellnova:visited:${storeData.id}`;
    if (!sessionStorage.getItem(visitKey)) {
      sessionStorage.setItem(visitKey, "1");
      await supabase.from("store_visitors").insert({ store_id: storeData.id });
    }
  }, [storeName]);

  useEffect(() => {
    loadStore();
  }, [loadStore]);

  // Restore the cart for this store.
  useEffect(() => {
    if (!loadedStoreId) return;
    setCartStoreId(null);
    setCheckoutOpen(false);
    setHasReceipt(false);
    setCheckoutItems([]);
    try {
      const saved = localStorage.getItem(cartKey(loadedStoreId));
      setCart(saved ? (JSON.parse(saved) as CartItem[]) : []);
    } catch {
      setCart([]);
    }
    setCartStoreId(loadedStoreId);
  }, [loadedStoreId]);

  useEffect(() => {
    if (!loadedStoreId || cartStoreId !== loadedStoreId) return;
    try {
      localStorage.setItem(cartKey(loadedStoreId), JSON.stringify(cart));
    } catch {
      /* storage unavailable — cart stays in memory */
    }
  }, [cart, loadedStoreId, cartStoreId]);

  // Structured data for search engines.
  useEffect(() => {
    if (!store) return;
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.text = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Store",
      name: store.store_name,
      url: canonicalUrl,
      telephone: formatPhoneForDisplay(whatsappNumber),
      makesOffer: store.products.slice(0, 12).map(p => ({
        "@type": "Offer",
        priceCurrency: "NGN",
        price: p.price,
        itemOffered: { "@type": "Product", name: p.name, image: p.images?.[0] }
      }))
    });
    document.head.appendChild(script);
    return () => {
      script.remove();
    };
  }, [store, canonicalUrl, whatsappNumber]);

  const addToCart = async (requested: Product, qty = 1) => {
    const latest = await refreshCatalog();
    const product = latest?.find(p => p.id === requested.id);
    if (!product) { toast.error("This product is no longer public. Please choose another product."); return; }
    const existing = cart.find(item => item.id === product.id)?.quantity ?? 0;
    if (!stockState(product).sellable || (product.track_stock && existing + qty > product.stock_quantity)) {
      toast.error("This quantity is no longer available. Please refresh the store.");
      return;
    }
    setCart(prev => {
      const existing = prev.find(i => i.id === product.id);
      if (existing) {
        return prev.map(i =>
          i.id === product.id ? { ...i, quantity: i.quantity + qty } : i
        );
      }
      return [
        ...prev,
        {
          id: product.id,
          name: product.name,
          price: Number(product.price),
          image: product.images?.[0] ?? null,
          quantity: qty
        }
      ];
    });
    toast.success(`${product.name} added to your cart`);
  };

  const updateQuantity = (id: string, delta: number) => {
    setCart(prev =>
      prev
        .map(i =>
          i.id === id ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i
        )
        .filter(i => i.quantity > 0)
    );
  };

  const removeFromCart = (id: string) =>
    setCart(prev => prev.filter(i => i.id !== id));

  const handleSendOrder = async () => {
    if (!store || cart.length === 0) return;
    const latest = await refreshCatalog();
    if (!latest || cart.some(item => !latest.some(p => p.id === item.id && stockState(p).sellable))) {
      toast.error("Your cart contains products that are no longer public or available. Remove them before checkout.");
      return;
    }
    const selection = (items: CartItem[]) => JSON.stringify(items.map(item => [item.id, item.quantity]));
    // Reopening an unchanged checkout preserves its in-flight/saved guard and buyer details.
    if (hasReceipt || selection(cart) !== selection(checkoutItems)) {
      setCheckoutItems(cart.map(item => ({ ...item })));
      setCheckoutAttempt(attempt => attempt + 1);
      setHasReceipt(false);
    }
    setCartOpen(false);
    setCheckoutOpen(true);
  };

  const handleContactSeller = () => {
    if (!store) return;
    window.open(
      whatsAppLink(
        whatsappNumber,
        `Hello ${store.store_name}, I found your store on SellNova.`
      ),
      "_blank",
      "noopener"
    );
  };

  const openProduct = async (product: Product) => {
    setSelectedProduct(product);
    setCurrentImageIndex(0);
    setQuantity(1);

    if (!store) return;
    const key = `sellnova:viewed:${product.id}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    await supabase
      .from("product_views")
      .insert({ product_id: product.id, store_id: store.id });
  };

  const imageCount = selectedProduct?.images?.length ?? 0;
  const nextImage = () =>
    setCurrentImageIndex(prev => (prev + 1) % Math.max(imageCount, 1));
  const prevImage = () =>
    setCurrentImageIndex(
      prev => (prev - 1 + Math.max(imageCount, 1)) % Math.max(imageCount, 1)
    );

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="bg-gradient-primary h-44" />
        <div className="max-w-7xl mx-auto px-4 py-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-3">
              <Skeleton className="aspect-square w-full rounded-xl" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
        <span className="sr-only" role="status">
          Loading store
        </span>
      </div>
    );
  }

  if (notFound || !store) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="p-12 text-center max-w-md">
          <Store className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
          <h1 className="text-2xl font-bold mb-2">Store not found</h1>
          <p className="text-muted-foreground mb-6">
            This store link doesn’t exist or the store is currently
            unavailable.
          </p>
          <Button asChild variant="hero">
            <a href="/">Go to SellNova</a>
          </Button>
        </Card>
      </div>
    );
  }

  const cartPanel = (
    <SheetContent style={theme} className="flex flex-col w-full sm:max-w-md">
      <SheetHeader>
        <SheetTitle>Your cart</SheetTitle>
      </SheetHeader>

      {cart.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
          <ShoppingCart className="h-12 w-12 mb-3" aria-hidden="true" />
          <p>Your cart is empty</p>
          <p className="text-sm">Add a product to start your order.</p>
        </div>
      ) : (
        <>
          <ul className="flex-1 overflow-y-auto space-y-4 py-4">
            {cart.map(item => (
              <li key={item.id} className="flex gap-3 items-center">
                <div className="h-16 w-16 shrink-0 rounded-md bg-muted overflow-hidden flex items-center justify-center">
                  {item.image ? (
                    <img
                      src={item.image}
                      alt={item.name}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ShoppingBag
                      className="h-6 w-6 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{item.name}</p>
                  {!store?.products.some(p => p.id === item.id) && <p role="alert" className="text-sm text-destructive">No longer public — remove before checkout</p>}
                  <p className="text-sm text-muted-foreground">
                    {formatCurrency(item.price)}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      aria-label={`Reduce quantity of ${item.name}`}
                      onClick={() => updateQuantity(item.id, -1)}>
                      <Minus className="h-3 w-3" aria-hidden="true" />
                    </Button>
                    <span className="w-6 text-center text-sm" aria-live="polite">
                      {item.quantity}
                    </span>
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      aria-label={`Increase quantity of ${item.name}`}
                      onClick={() => updateQuantity(item.id, 1)}>
                      <Plus className="h-3 w-3" aria-hidden="true" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 ml-auto"
                      aria-label={`Remove ${item.name} from cart`}
                      onClick={() => removeFromCart(item.id)}>
                      <Trash2
                        className="h-4 w-4 text-destructive"
                        aria-hidden="true"
                      />
                    </Button>
                  </div>
                </div>
                <p className="font-semibold whitespace-nowrap">
                  {formatCurrency(item.price * item.quantity)}
                </p>
              </li>
            ))}
          </ul>

          <div className="border-t pt-4 space-y-3">
            <div className="flex justify-between text-lg font-bold">
              <span>Total</span>
              <span className="text-primary">{formatCurrency(cartTotal)}</span>
            </div>
            <Button
              variant="hero"
              size="lg"
              className="w-full"
              onClick={handleSendOrder}>
              <MessageCircle className="mr-2 h-5 w-5" aria-hidden="true" />
              Send order on WhatsApp
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setCart([])}>
              Clear cart
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Payment and delivery are arranged directly with the seller.
            </p>
          </div>
        </>
      )}
    </SheetContent>
  );

  return (
    <div style={theme} className="min-h-screen bg-background text-foreground pb-24 sm:pb-0">
      {store && <CheckoutDialog
        key={`${store.id}:${checkoutAttempt}`}
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        theme={theme}
        storeId={store.id}
        storeName={store.store_name}
        sellerPhone={whatsappNumber}
        storeUrl={canonicalUrl}
        items={checkoutItems}
        onSaved={() => {
          let persisted = false;
          try { localStorage.setItem(cartKey(store.id), "[]"); persisted = true; } catch { /* retain checkout UUID */ }
          setCart([]); setHasReceipt(true);
          return persisted;
        }}
      />}
      {hasReceipt && <div className="p-3 text-center border-b"><Button variant="outline" onClick={() => setCheckoutOpen(true)}>View saved order</Button></div>}
      <header className="bg-gradient-primary text-primary-foreground py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-4 mb-5">
            <div className="bg-white/10 backdrop-blur-sm p-3 rounded-xl">
              {logoUrl ? (
                <img src={logoUrl} alt={`${store.store_name} logo`}
                  className="h-16 w-16 object-contain" onError={clearLogo} />
              ) : <Store className="h-8 w-8" aria-hidden="true" />}
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold break-words">
                {store.store_name}
              </h1>
              <a
                href={whatsAppLink(whatsappNumber)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-foreground/90 hover:text-primary-foreground inline-flex items-center gap-2 mt-1 underline-offset-4 hover:underline">
                <Phone className="h-4 w-4" aria-hidden="true" />
                {formatPhoneForDisplay(whatsappNumber)}
              </a>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              variant="accent"
              onClick={handleContactSeller}
              className="w-full sm:w-auto">
              <MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" />
              Chat with seller on WhatsApp
            </Button>

            <Sheet open={cartOpen} onOpenChange={setCartOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="secondary"
                  className="w-full sm:w-auto"
                  aria-label={`Open cart, ${cartCount} item${
                    cartCount === 1 ? "" : "s"
                  }`}>
                  <ShoppingCart className="mr-2 h-4 w-4" aria-hidden="true" />
                  Cart
                  {cartCount > 0 && (
                    <span className="ml-2 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold h-5 min-w-5 px-1.5">
                      {cartCount}
                    </span>
                  )}
                </Button>
              </SheetTrigger>
              {cartPanel}
            </Sheet>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 min-h-[60vh]">
        <h2 className="text-2xl font-bold mb-6">Our products</h2>

        {catalogError ? <Card className="p-6"><p role="alert">{catalogError}</p><Button onClick={() => void refreshCatalog()}>Refresh catalog</Button></Card> : store.products.length === 0 ? (
          <Card className="p-12 text-center">
            <ShoppingBag
              className="h-16 w-16 mx-auto mb-4 text-muted-foreground"
              aria-hidden="true"
            />
            <h3 className="text-xl font-semibold mb-2">No products yet</h3>
            <p className="text-muted-foreground mb-6">
              This store is still setting up. Check back soon, or send a message
              to ask what’s available.
            </p>
            <Button variant="outline" onClick={handleContactSeller}>
              <MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" />
              Message the seller
            </Button>
          </Card>
        ) : (
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {store.products.map(product => (
              <li key={product.id}>
                <Card className="h-full flex flex-col overflow-hidden shadow-card hover:shadow-glow transition-shadow">
                  <button
                    type="button"
                    onClick={() => openProduct(product)}
                    className="text-left"
                    aria-label={`View details for ${product.name}`}>
                    <div className="aspect-square bg-muted flex items-center justify-center">
                      {product.images?.length ? (
                        <img
                          src={product.images[0]}
                          alt={product.name}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <ShoppingBag
                          className="h-16 w-16 text-muted-foreground"
                          aria-hidden="true"
                        />
                      )}
                    </div>
                  </button>
                  <div className="p-4 flex flex-col flex-1">
                    <h3 className="font-semibold mb-1">{product.name}</h3>
                    {product.description && (
                      <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                        {product.description}
                      </p>
                    )}
                    <p className="text-xl font-bold text-primary mt-auto">
                      {formatCurrency(product.price)}
                    </p>
                    <p className="text-sm text-muted-foreground">{stockState(product).label}</p>
                    <div className="grid grid-cols-2 gap-2 mt-3">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openProduct(product)}>
                        Details
                      </Button>
                      <Button
                        size="sm"
                        variant="hero"
                        disabled={!stockState(product).sellable}
                        onClick={() => addToCart(product, 1)}>
                        Add
                      </Button>
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </main>

      {/* Mobile sticky cart bar */}
      {cartCount > 0 && (
        <div className="sm:hidden fixed bottom-0 inset-x-0 z-40 border-t bg-card p-3 flex items-center gap-3 shadow-lg">
          <div className="flex-1">
            <p className="text-xs text-muted-foreground">
              {cartCount} item{cartCount === 1 ? "" : "s"}
            </p>
            <p className="font-bold">{formatCurrency(cartTotal)}</p>
          </div>
          <Button variant="hero" onClick={() => setCartOpen(true)}>
            <ShoppingCart className="mr-2 h-4 w-4" aria-hidden="true" />
            View cart
          </Button>
        </div>
      )}

      {/* Accessible product dialog */}
      <Dialog
        open={!!selectedProduct}
        onOpenChange={open => !open && setSelectedProduct(null)}>
        <DialogContent style={theme} className="max-w-3xl max-h-[90vh] overflow-y-auto">
          {selectedProduct && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedProduct.name}</DialogTitle>
                <DialogDescription>
                  {formatCurrency(selectedProduct.price)}
                </DialogDescription>
              </DialogHeader>

              <p className="text-sm text-muted-foreground">{stockState(selectedProduct).label}. Pending orders do not guarantee stock.</p>
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <div className="relative aspect-square bg-muted rounded-lg flex items-center justify-center overflow-hidden">
                    {imageCount > 0 ? (
                      <>
                        <img
                          src={selectedProduct.images[currentImageIndex]}
                          alt={`${selectedProduct.name} — photo ${
                            currentImageIndex + 1
                          } of ${imageCount}`}
                          className="w-full h-full object-cover"
                        />
                        {imageCount > 1 && (
                          <>
                            <Button
                              variant="secondary"
                              size="icon"
                              aria-label="Previous photo"
                              className="absolute left-2 top-1/2 -translate-y-1/2 shadow-lg"
                              onClick={prevImage}>
                              <ChevronLeft
                                className="h-4 w-4"
                                aria-hidden="true"
                              />
                            </Button>
                            <Button
                              variant="secondary"
                              size="icon"
                              aria-label="Next photo"
                              className="absolute right-2 top-1/2 -translate-y-1/2 shadow-lg"
                              onClick={nextImage}>
                              <ChevronRight
                                className="h-4 w-4"
                                aria-hidden="true"
                              />
                            </Button>
                          </>
                        )}
                      </>
                    ) : (
                      <ShoppingBag
                        className="h-24 w-24 text-muted-foreground"
                        aria-hidden="true"
                      />
                    )}
                  </div>

                  {imageCount > 1 && (
                    <div className="flex gap-2">
                      {selectedProduct.images.map((img, index) => (
                        <button
                          key={img}
                          type="button"
                          onClick={() => setCurrentImageIndex(index)}
                          aria-label={`Show photo ${index + 1}`}
                          aria-current={index === currentImageIndex}
                          className={`h-16 w-16 rounded-md overflow-hidden border-2 ${
                            index === currentImageIndex
                              ? "border-primary"
                              : "border-transparent"
                          }`}>
                          <img
                            src={img}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-col">
                  {selectedProduct.description && (
                    <p className="text-muted-foreground whitespace-pre-line mb-4">
                      {selectedProduct.description}
                    </p>
                  )}

                  <div className="mt-auto space-y-4">
                    <div className="flex items-center gap-3">
                      <span id="qty-label" className="text-sm font-medium">
                        Quantity
                      </span>
                      <div
                        className="flex items-center gap-2"
                        role="group"
                        aria-labelledby="qty-label">
                        <Button
                          size="icon"
                          variant="outline"
                          aria-label="Decrease quantity"
                          onClick={() => setQuantity(q => Math.max(1, q - 1))}>
                          <Minus className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <span className="w-8 text-center" aria-live="polite">
                          {quantity}
                        </span>
                        <Button
                          size="icon"
                          variant="outline"
                          aria-label="Increase quantity"
                          onClick={() => setQuantity(q => Math.min(99, q + 1))}>
                          <Plus className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>

                    <p className="text-lg font-bold">
                      Subtotal:{" "}
                      <span className="text-primary">
                        {formatCurrency(selectedProduct.price * quantity)}
                      </span>
                    </p>

                    <Button
                      variant="hero"
                      size="lg"
                      className="w-full"
                      disabled={!stockState(selectedProduct).sellable}
                      onClick={() => {
                        addToCart(selectedProduct, quantity);
                        setSelectedProduct(null);
                      }}>
                      <ShoppingCart className="mr-2 h-5 w-5" aria-hidden="true" />
                      Add to cart
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <footer className="border-t py-8 text-center text-sm text-muted-foreground">
        <p>
          {store.store_name} · Powered by{" "}
          <a href="/" className="text-primary hover:underline">
            SellNova
          </a>
        </p>
      </footer>
    </div>
  );
};

export default StoreFront;

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { SellerPage } from "@/components/SellerPage";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Lock, Store, Trash2, Upload, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMetaTags } from "@/hooks/use-meta-tags";
import { effectivePlan, isEntitled, loadPlans, loadSubscription } from "@/lib/plan";
import {
  Branding as BrandingValues,
  DEFAULT_BRANDING,
  brandingStyle,
  contrastRatio,
  isHex
} from "@/lib/branding";

const LOGO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const LOGO_MAX = 2 * 1024 * 1024;

const BrandingPage = () => {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [storeId, setStoreId] = useState<string | null>(null);
  const [storeName, setStoreName] = useState("");
  const [allowed, setAllowed] = useState(false);
  const [statusLabel, setStatusLabel] = useState("Free plan");

  const [primary, setPrimary] = useState(DEFAULT_BRANDING.primary_color);
  const [accent, setAccent] = useState(DEFAULT_BRANDING.accent_color);
  const [background, setBackground] = useState(DEFAULT_BRANDING.background_color);
  const [useBackground, setUseBackground] = useState(false);
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useMetaTags({
    title: "Store design | SellNova",
    description: "Choose your storefront colours and upload your business logo."
  });

  const signLogo = useCallback(async (path: string | null) => {
    if (!path) {
      setLogoUrl(null);
      return;
    }
    const { data } = await supabase.storage
      .from("store-logos")
      .createSignedUrl(path, 60 * 60);
    setLogoUrl(data?.signedUrl ?? null);
  }, []);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    const { data: store, error: storeError } = await supabase
      .from("stores")
      .select("id, store_name")
      .eq("seller_id", user.id)
      .maybeSingle();

    if (storeError) {
      setError("We could not load your store. Please try again.");
      setLoading(false);
      return;
    }
    if (!store) {
      setLoading(false);
      return;
    }

    setStoreId(store.id);
    setStoreName(store.store_name);

    const [plans, sub, branding] = await Promise.all([
      loadPlans(),
      loadSubscription(store.id),
      supabase
        .from("store_branding")
        .select("primary_color, accent_color, background_color, logo_path")
        .eq("store_id", store.id)
        .maybeSingle()
    ]);

    const plan = effectivePlan(plans, sub);
    setAllowed(plan.allow_branding);
    setStatusLabel(`${plan.name} plan`);

    const b = branding.data as BrandingValues | null;
    if (b) {
      setPrimary(b.primary_color || DEFAULT_BRANDING.primary_color);
      setAccent(b.accent_color || DEFAULT_BRANDING.accent_color);
      setUseBackground(!!b.background_color);
      setBackground(b.background_color || DEFAULT_BRANDING.background_color);
      setLogoPath(b.logo_path);
      await signLogo(b.logo_path);
    }

    setLoading(false);
  }, [user, signLogo]);

  useEffect(() => {
    load();
  }, [load]);

  const preview: BrandingValues = {
    primary_color: primary,
    accent_color: accent,
    background_color: useBackground ? background : null,
    logo_path: logoPath
  };

  const lowContrast =
    isHex(primary) && contrastRatio(primary, "#FFFFFF") < 2 && contrastRatio(primary, "#000000") < 2;

  const handleSave = async () => {
    if (!storeId) return;
    if (!isHex(primary) || !isHex(accent) || (useBackground && !isHex(background))) {
      toast.error("Use full hex colours such as #C8940B");
      return;
    }

    setSaving(true);
    const { error: saveError } = await supabase.from("store_branding").upsert({
      store_id: storeId,
      primary_color: primary,
      accent_color: accent,
      background_color: useBackground ? background : null,
      logo_path: logoPath
    });
    setSaving(false);

    if (saveError) {
      toast.error(saveError.message || "Could not save your store design");
      return;
    }
    toast.success("Store design saved");
  };

  const handleReset = () => {
    setPrimary(DEFAULT_BRANDING.primary_color);
    setAccent(DEFAULT_BRANDING.accent_color);
    setBackground(DEFAULT_BRANDING.background_color);
    setUseBackground(false);
  };

  const handleLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user || !storeId) return;

    if (!LOGO_TYPES.includes(file.type)) {
      toast.error("Upload a JPG, PNG or WebP image");
      return;
    }
    if (file.size > LOGO_MAX) {
      toast.error("Your logo must be smaller than 2MB");
      return;
    }

    setUploading(true);
    const ext = file.name.split(".").pop()?.toLowerCase() || "png";
    const path = `${user.id}/logo-${Date.now()}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from("store-logos")
      .upload(path, file, { upsert: true });

    if (upErr) {
      setUploading(false);
      toast.error(upErr.message || "Could not upload your logo");
      return;
    }

    const previousPath = logoPath;
    const { error: saveErr } = await supabase.from("store_branding").upsert({
      store_id: storeId,
      primary_color: primary,
      accent_color: accent,
      background_color: useBackground ? background : null,
      logo_path: path
    });

    if (saveErr) {
      setUploading(false);
      toast.error(saveErr.message || "Could not save your logo");
      return;
    }

    if (previousPath) {
      await supabase.storage.from("store-logos").remove([previousPath]);
    }

    setLogoPath(path);
    await signLogo(path);
    setUploading(false);
    toast.success("Logo updated");
  };

  const handleRemoveLogo = async () => {
    if (!storeId || !logoPath) return;
    setUploading(true);
    const { error: saveErr } = await supabase
      .from("store_branding")
      .upsert({ store_id: storeId, logo_path: null, primary_color: primary, accent_color: accent, background_color: useBackground ? background : null });
    if (saveErr) {
      setUploading(false);
      toast.error(saveErr.message || "Could not remove your logo");
      return;
    }
    await supabase.storage.from("store-logos").remove([logoPath]);
    setLogoPath(null);
    setLogoUrl(null);
    setUploading(false);
    toast.success("Logo removed");
  };

  if (loading) {
    return (
      <SellerPage title="Store design" description="Loading your storefront look…">
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-72 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
        <span className="sr-only" role="status">
          Loading store design
        </span>
      </SellerPage>
    );
  }

  if (error) {
    return (
      <SellerPage title="Store design">
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button className="mt-4" onClick={load}>
          Try again
        </Button>
      </SellerPage>
    );
  }

  if (!storeId) {
    return (
      <SellerPage title="Store design">
        <Card className="p-10 text-center">
          <Store className="h-14 w-14 mx-auto mb-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-xl font-semibold mb-2">Set up your store first</h2>
          <p className="text-muted-foreground mb-6">
            You need a store before you can choose its colours and logo.
          </p>
          <Button asChild variant="hero">
            <Link to="/seller/onboarding">Set up store</Link>
          </Button>
        </Card>
      </SellerPage>
    );
  }

  return (
    <SellerPage
      title="Store design"
      description="Make your public store page look like your own business.">
      {!allowed && (
        <Alert className="mb-6">
          <Lock className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>Store design is a paid feature</AlertTitle>
          <AlertDescription className="flex flex-col sm:flex-row sm:items-center gap-3">
            <span>
              You are on the {statusLabel}. Your customers see the standard SellNova look.
              Anything you saved before stays safe and comes back when your plan is active.
            </span>
            <Button asChild size="sm" variant="hero" className="shrink-0">
              <Link to="/seller/subscription">View plans</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6 space-y-6">
          <div>
            <h2 className="text-lg font-semibold">Colours</h2>
            <p className="text-sm text-muted-foreground">
              Use full hex codes, for example #C8940B.
            </p>
          </div>

          <fieldset disabled={!allowed} className="space-y-5 disabled:opacity-60">
            <div className="space-y-2">
              <Label htmlFor="primary">Main colour</Label>
              <div className="flex gap-3">
                <Input
                  id="primary"
                  type="color"
                  aria-label="Pick main colour"
                  value={isHex(primary) ? primary : DEFAULT_BRANDING.primary_color}
                  onChange={e => setPrimary(e.target.value.toUpperCase())}
                  className="h-10 w-14 p-1"
                />
                <Input
                  aria-label="Main colour hex code"
                  value={primary}
                  onChange={e => setPrimary(e.target.value.toUpperCase())}
                  placeholder="#C8940B"
                  aria-invalid={!isHex(primary)}
                />
              </div>
              {!isHex(primary) && (
                <p className="text-xs text-destructive">Enter a hex code like #C8940B.</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="accent">Button colour</Label>
              <div className="flex gap-3">
                <Input
                  id="accent"
                  type="color"
                  aria-label="Pick button colour"
                  value={isHex(accent) ? accent : DEFAULT_BRANDING.accent_color}
                  onChange={e => setAccent(e.target.value.toUpperCase())}
                  className="h-10 w-14 p-1"
                />
                <Input
                  aria-label="Button colour hex code"
                  value={accent}
                  onChange={e => setAccent(e.target.value.toUpperCase())}
                  placeholder="#C8940B"
                  aria-invalid={!isHex(accent)}
                />
              </div>
              {!isHex(accent) && (
                <p className="text-xs text-destructive">Enter a hex code like #C8940B.</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  id="useBackground"
                  type="checkbox"
                  checked={useBackground}
                  onChange={e => setUseBackground(e.target.checked)}
                  className="h-4 w-4 rounded border-input"
                />
                <Label htmlFor="useBackground">Use a custom page background</Label>
              </div>
              {useBackground && (
                <div className="flex gap-3">
                  <Input
                    type="color"
                    aria-label="Pick background colour"
                    value={isHex(background) ? background : DEFAULT_BRANDING.background_color}
                    onChange={e => setBackground(e.target.value.toUpperCase())}
                    className="h-10 w-14 p-1"
                  />
                  <Input
                    aria-label="Background colour hex code"
                    value={background}
                    onChange={e => setBackground(e.target.value.toUpperCase())}
                    placeholder="#FBFBFD"
                    aria-invalid={!isHex(background)}
                  />
                </div>
              )}
            </div>

            {lowContrast && (
              <p className="text-xs text-muted-foreground">
                This colour may be hard to read. Text will switch automatically for contrast.
              </p>
            )}

            <div className="space-y-3 border-t pt-5">
              <div>
                <h3 className="font-semibold">Business logo</h3>
                <p className="text-sm text-muted-foreground">
                  JPG, PNG or WebP up to 2MB. A square image looks best.
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-xl border bg-muted overflow-hidden flex items-center justify-center">
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt={`${storeName} logo`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Store className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleLogo}
                    className="sr-only"
                    id="logoInput"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}>
                    <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
                    {uploading ? "Uploading…" : logoPath ? "Replace logo" : "Upload logo"}
                  </Button>
                  {logoPath && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={handleRemoveLogo}
                      disabled={uploading}>
                      <Trash2 className="mr-2 h-4 w-4 text-destructive" aria-hidden="true" />
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 border-t pt-5">
              <Button type="button" variant="hero" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save design"}
              </Button>
              <Button type="button" variant="outline" onClick={handleReset} disabled={saving}>
                <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
                Reset to default
              </Button>
            </div>
          </fieldset>
        </Card>

        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-1">Live preview</h2>
          <p className="text-sm text-muted-foreground mb-4">
            This is how your store page will look to customers.
          </p>
          <div
            style={allowed ? brandingStyle(preview) : undefined}
            className="rounded-xl border overflow-hidden bg-background text-foreground">
            <div className="bg-gradient-primary text-primary-foreground p-5">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-xl bg-white/15 overflow-hidden flex items-center justify-center">
                  {allowed && logoUrl ? (
                    <img
                      src={logoUrl}
                      alt={`${storeName} logo`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Store className="h-6 w-6" aria-hidden="true" />
                  )}
                </div>
                <div>
                  <p className="font-bold text-lg">{storeName}</p>
                  <p className="text-sm opacity-90">+234 800 000 0000</p>
                </div>
              </div>
            </div>
            <div className="p-5 space-y-3">
              <div className="h-24 rounded-lg bg-muted" aria-hidden="true" />
              <p className="font-semibold">Sample product</p>
              <p className="text-primary font-bold">₦12,500.00</p>
              <div className="flex gap-2">
                <Button size="sm" variant="hero">
                  Add to cart
                </Button>
                <Button size="sm" variant="accent">
                  Chat on WhatsApp
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </SellerPage>
  );
};

export default BrandingPage;

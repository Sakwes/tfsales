import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  Shield,
  Search,
  TrendingUp,
  Users,
  Store,
  Eye,
  Ban,
  CheckCircle,
  ExternalLink,
  Package,
  Calendar,
  BarChart3,
  MousePointerClick,
  Pencil,
  Phone
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { storeSlug, storeUrl } from "@/lib/store";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
// import { RoleSwitcher } from "@/components/RoleSwitcher";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import CustomLineChart from "@/components/graphs/CustomLineChart";
import { isReservedStoreName } from "@/lib/constants";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/utils";

interface Seller {
  id: string;
  store_id: string;
  contact_phone: string;
  email: string;
  store_name: string;
  is_active: boolean;
  products_count: number;
  created_at: string;
  total_visits: number;
  total_product_views: number;
}

interface DailyStats {
  date: string;
  visits: number;
  productViews: number;
}

interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
  images: string[];
  created_at: string;
  updated_at: string;
}

const AdminDashboard = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<{
    from: Date;
    to: Date;
  }>({
    from: startOfDay(subDays(new Date(), 7)),
    to: endOfDay(new Date())
  });
  const [tempDateRange, setTempDateRange] = useState<{
    from: Date | undefined;
    to: Date | undefined;
  }>({ from: undefined, to: undefined });
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [platformTotalVisits, setPlatformTotalVisits] = useState(0);
  const [platformTotalProductViews, setPlatformTotalProductViews] = useState(0);
  const [selectedSeller, setSelectedSeller] = useState<Seller | null>(null);
  const [sellerProducts, setSellerProducts] = useState<Product[]>([]);
  const [isSellerModalOpen, setIsSellerModalOpen] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false);
  const [sellerToToggle, setSellerToToggle] = useState<{
    storeId: string;
    storeName: string;
    isActive: boolean;
  } | null>(null);
  const [isEditStoreModalOpen, setIsEditStoreModalOpen] = useState(false);
  const [editStoreName, setEditStoreName] = useState("");
  const [editContactPhone, setEditContactPhone] = useState("");
  const [savingStore, setSavingStore] = useState(false);
  const { signOut } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    loadSellers();
    loadPlatformStats();
  }, [dateRange]);

  const getDateRangeLabel = () => {
    return `${format(dateRange.from, "MMM dd")} - ${format(dateRange.to, "MMM dd, yyyy")}`;
  };

  const getDisplayDays = () => {
    const daysDiff = Math.ceil((dateRange.to.getTime() - dateRange.from.getTime()) / (1000 * 60 * 60 * 24));
    return Math.min(daysDiff, 14);
  };

  const handleDatePickerOpen = () => {
    setTempDateRange({
      from: dateRange.from,
      to: dateRange.to
    });
    setIsDatePickerOpen(true);
  };

  const handleApplyDateRange = () => {
    if (tempDateRange.from && tempDateRange.to) {
      setDateRange({
        from: startOfDay(tempDateRange.from),
        to: endOfDay(tempDateRange.to)
      });
      setIsDatePickerOpen(false);
    }
  };

  const handleCancelDateRange = () => {
    setTempDateRange({ from: undefined, to: undefined });
    setIsDatePickerOpen(false);
  };

  const handleViewSellerDetails = async (seller: Seller) => {
    setSelectedSeller(seller);
    setIsSellerModalOpen(true);
    setLoadingProducts(true);

    try {
      const { data: products, error } = await supabase
        .from("products")
        .select("id, name, description, price, images, created_at, updated_at")
        .eq("store_id", seller.store_id)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching products:", error);
        toast({
          title: "Error",
          description: "Could not load seller products",
          variant: "destructive"
        });
        setSellerProducts([]);
      } else {
        setSellerProducts(products || []);
      }
    } catch (error) {
      console.error("Error:", error);
      setSellerProducts([]);
    } finally {
      setLoadingProducts(false);
    }
  };

  const handleCloseSellerModal = () => {
    setIsSellerModalOpen(false);
    setSelectedSeller(null);
    setSellerProducts([]);
  };

  const loadPlatformStats = async () => {
    const startDate = dateRange.from;
    const endDate = dateRange.to;

    // Get total platform visits
    const { count: visitsCount } = await supabase
      .from("store_visitors")
      .select("*", { count: "exact", head: true })
      .gte("visited_at", startDate.toISOString())
      .lte("visited_at", endDate.toISOString());

    setPlatformTotalVisits(visitsCount || 0);

    // Get total product views
    const { count: productViewsCount } = await supabase
      .from("product_views")
      .select("*", { count: "exact", head: true })
      .gte("viewed_at", startDate.toISOString())
      .lte("viewed_at", endDate.toISOString());

    setPlatformTotalProductViews(productViewsCount || 0);

    // Get daily breakdown for visits
    const { data: visitsData } = await supabase
      .from("store_visitors")
      .select("visited_at")
      .gte("visited_at", startDate.toISOString())
      .lte("visited_at", endDate.toISOString());

    // Get daily breakdown for product views
    const { data: productViewsData } = await supabase
      .from("product_views")
      .select("viewed_at")
      .gte("viewed_at", startDate.toISOString())
      .lte("viewed_at", endDate.toISOString());

    // Initialize daily map - show last 14 days max for clarity
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const displayDays = Math.min(daysDiff, 14);
    const dailyMap = new Map<string, { visits: number; views: number }>();

    for (let i = displayDays - 1; i >= 0; i--) {
      const day = format(subDays(endDate, i), "yyyy-MM-dd");
      dailyMap.set(day, { visits: 0, views: 0 });
    }

    // Count visits per day
    visitsData?.forEach(visit => {
      const day = format(new Date(visit.visited_at), "yyyy-MM-dd");
      const existing = dailyMap.get(day);
      if (existing) {
        dailyMap.set(day, { ...existing, visits: existing.visits + 1 });
      }
    });

    // Count product views per day
    productViewsData?.forEach(view => {
      const day = format(new Date(view.viewed_at), "yyyy-MM-dd");
      const existing = dailyMap.get(day);
      if (existing) {
        dailyMap.set(day, { ...existing, views: existing.views + 1 });
      }
    });

    // Convert to chart format
    const chartData = Array.from(dailyMap.entries()).map(([date, stats]) => ({
      label: format(new Date(date), "MMM dd"),
      date: date,
      visits: stats.visits,
      views: stats.views
    }));

    setDailyStats(chartData);
  };

  // Update your state to use the new format:
  const [dailyStats, setDailyStats] = useState<
    Array<{
      label: string;
      date: string;
      visits: number;
      views: number;
    }>
  >([]);

  const loadSellers = async () => {
    setLoading(true);

    const startDate = dateRange.from;
    const endDate = dateRange.to;

    try {
      const { data: stores, error: storesError } = await supabase
        .from("stores")
        .select(
          `
          id,
          seller_id,
          store_name,
          contact_phone,
          is_active,
          created_at,
          profiles:seller_id(email)
        `
        )
        .order("created_at", { ascending: false });

      if (storesError) {
        console.error("Error fetching stores:", storesError);
        toast({
          title: "Error",
          description: "Could not load sellers data",
          variant: "destructive"
        });
        setLoading(false);
        return;
      }

      if (!stores || stores.length === 0) {
        setSellers([]);
        setLoading(false);
        return;
      }

      const sellersData = await Promise.all(
        stores.map(async (store) => {
          const { count: productsCount } = await supabase
            .from("products")
            .select("*", { count: "exact", head: true })
            .eq("store_id", store.id);

          const { count: visitsCount } = await supabase
            .from("store_visitors")
            .select("*", { count: "exact", head: true })
            .eq("store_id", store.id)
            .gte("visited_at", startDate.toISOString())
            .lte("visited_at", endDate.toISOString());

          const { count: productViewsCount } = await supabase
            .from("product_views")
            .select("*", { count: "exact", head: true })
            .eq("store_id", store.id)
            .gte("viewed_at", startDate.toISOString())
            .lte("viewed_at", endDate.toISOString());

          return {
            id: store.seller_id,
            store_id: store.id,
            contact_phone: store.contact_phone || "N/A",
            email: store.profiles?.email || "No email",
            store_name: store.store_name,
            is_active: store.is_active,
            products_count: productsCount || 0,
            created_at: store.created_at,
            total_visits: visitsCount || 0,
            total_product_views: productViewsCount || 0
          };
        })
      );

      setSellers(sellersData);
    } catch (error) {
      console.error("Error loading sellers:", error);
      toast({
        title: "Error",
        description: "An unexpected error occurred",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStoreStatus = (storeId: string, storeName: string, currentStatus: boolean) => {
    setSellerToToggle({
      storeId,
      storeName,
      isActive: currentStatus
    });
    setIsConfirmDialogOpen(true);
  };

  const confirmToggleStoreStatus = async () => {
    if (!sellerToToggle) return;

    const { error } = await supabase
      .from("stores")
      .update({ is_active: !sellerToToggle.isActive })
      .eq("id", sellerToToggle.storeId);

    if (error) {
      toast({
        title: "Error",
        description: "Could not update store status",
        variant: "destructive"
      });
      setIsConfirmDialogOpen(false);
      setSellerToToggle(null);
      return;
    }

    toast({
      title: sellerToToggle.isActive ? "Store Blocked" : "Store Unblocked",
      description: `${sellerToToggle.storeName} has been ${
        sellerToToggle.isActive ? "blocked" : "unblocked"
      } successfully`
    });

    setIsConfirmDialogOpen(false);
    setSellerToToggle(null);
    await loadSellers();
  };

  const cancelToggleStoreStatus = () => {
    setIsConfirmDialogOpen(false);
    setSellerToToggle(null);
  };

  const openEditStoreModal = (seller: Seller) => {
    setSelectedSeller(seller);
    setEditStoreName(seller.store_name);
    setEditContactPhone(seller.contact_phone);
    setIsEditStoreModalOpen(true);
  };

  const handleSaveStore = async () => {
    if (!selectedSeller) return;

    const trimmedName = editStoreName.trim();

    if (trimmedName.length < 3) {
      toast({ title: "Invalid Store Name", description: "Store name must be at least 3 characters", variant: "destructive" });
      return;
    }

    if (isReservedStoreName(trimmedName)) {
      toast({ title: "Store Name Not Available", description: "This store name is reserved. Please choose a different name.", variant: "destructive" });
      return;
    }

    if (editContactPhone.length < 10) {
      toast({ title: "Invalid Phone Number", description: "Please enter a valid contact phone number", variant: "destructive" });
      return;
    }

    setSavingStore(true);

    // Check uniqueness (case-insensitive) excluding current store
    const { data: existing } = await supabase
      .from("stores")
      .select("id")
      .ilike("store_name", trimmedName)
      .neq("id", selectedSeller.store_id)
      .maybeSingle();

    if (existing) {
      toast({ title: "Store Name Taken", description: "Another store already uses this name. Please choose a different one.", variant: "destructive" });
      setSavingStore(false);
      return;
    }

    const { error } = await supabase
      .from("stores")
      .update({ store_name: trimmedName, contact_phone: editContactPhone })
      .eq("id", selectedSeller.store_id);

    if (error) {
      toast({ title: "Error", description: error.message || "Could not update store", variant: "destructive" });
      setSavingStore(false);
      return;
    }

    toast({ title: "Store Updated", description: `${trimmedName} has been updated successfully` });
    setIsEditStoreModalOpen(false);
    setSavingStore(false);
    // Update selectedSeller in place if the details modal is open
    setSelectedSeller({ ...selectedSeller, store_name: trimmedName, contact_phone: editContactPhone });
    await loadSellers();
  };

  const filteredSellers = sellers.filter(
    seller =>
      seller.store_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      seller.contact_phone.includes(searchQuery) ||
      seller.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalSellers = sellers.length;
  const activeSellers = sellers.filter(s => s.is_active).length;
  const totalProducts = sellers.reduce((sum, s) => sum + s.products_count, 0);

  const maxDailyVisits = Math.max(...dailyStats.map(d => d.visits), 1);
  console.log("The dailyStats value is:", dailyStats);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-gradient-primary text-white py-6 px-4 sm:px-6 lg:px-8 shadow-glow">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="bg-white/10 backdrop-blur-sm p-2 rounded-lg">
                  <Shield className="h-6 w-6" />
                </div>
                <h1 className="text-2xl font-bold">Admin Dashboard</h1>
              </div>
              <p className="text-white/80">
                Manage sellers and monitor platform activity
              </p>
            </div>
            <div className="flex items-center gap-3">
              {/* <RoleSwitcher /> */}
              <Button
                variant="outline"
                className="bg-white/10 border-white/20 text-white hover:bg-white/20"
                onClick={signOut}>
                Logout
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Date Range Filter */}
        <div className="flex justify-end mb-6">
          <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="w-fit sm:w-[280px] justify-start text-left font-normal"
                onClick={handleDatePickerOpen}
              >
                <Calendar className="mr-2 h-4 w-4" />
                {format(dateRange.from, "MMM dd, yyyy")} - {format(dateRange.to, "MMM dd, yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <div className="p-4 space-y-4">
                <CalendarComponent
                  initialFocus
                  mode="range"
                  defaultMonth={tempDateRange.from || dateRange.from}
                  selected={{
                    from: tempDateRange.from,
                    to: tempDateRange.to
                  }}
                  onSelect={(range) => {
                    // If both dates are already selected, reset and start fresh
                    if (tempDateRange.from && tempDateRange.to) {
                      setTempDateRange({
                        from: range?.from,
                        to: undefined
                      });
                    } else {
                      setTempDateRange({
                        from: range?.from,
                        to: range?.to
                      });
                    }
                  }}
                  numberOfMonths={2}
                  className="hidden sm:block"
                />
                <CalendarComponent
                  initialFocus
                  mode="range"
                  defaultMonth={tempDateRange.from || dateRange.from}
                  selected={{
                    from: tempDateRange.from,
                    to: tempDateRange.to
                  }}
                  onSelect={(range) => {
                    // If both dates are already selected, reset and start fresh
                    if (tempDateRange.from && tempDateRange.to) {
                      setTempDateRange({
                        from: range?.from,
                        to: undefined
                      });
                    } else {
                      setTempDateRange({
                        from: range?.from,
                        to: range?.to
                      });
                    }
                  }}
                  numberOfMonths={1}
                  className="sm:hidden"
                />
                <div className="flex gap-2 pt-3 border-t">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={handleCancelDateRange}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={handleApplyDateRange}
                    disabled={!tempDateRange.from || !tempDateRange.to}
                  >
                    Apply
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Stats Cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card className="p-6 shadow-card">
            <div className="flex items-center justify-between mb-2">
              <Users className="h-8 w-8" />
              <Badge variant="secondary" className="text-green-500 bg-green-100">{activeSellers} Active</Badge>
            </div>
            <div className="text-3xl font-bold mb-1">{totalSellers}</div>
            <div className="text-sm text-muted-foreground">Total Sellers</div>
          </Card>

          <Card className="p-6 shadow-card">
            <div className="flex items-center justify-between mb-2">
              <Package className="h-8 w-8 text-secondary" />
            </div>
            <div className="text-3xl font-bold mb-1">{totalProducts}</div>
            <div className="text-sm text-muted-foreground">Total Products</div>
          </Card>

          <Card className="p-6 shadow-card">
            <div className="flex items-center justify-between mb-2">
              <Eye className="h-8 w-8" />
            </div>
            <div className="text-3xl font-bold mb-1">{platformTotalVisits}</div>
            <div className="text-sm text-muted-foreground">
              Store Visits
            </div>
          </Card>

          <Card className="p-6 shadow-card bg-gradient-primary text-white">
            <div className="flex items-center justify-between mb-2">
              <MousePointerClick className="h-8 w-8" />
            </div>
            <div className="text-3xl font-bold mb-1">
              {platformTotalProductViews}
            </div>
            <div className="text-sm text-white/80">
              Product Views
            </div>
          </Card>
        </div>

        {/* Platform Analytics Chart */}
        <Card className="p-6 shadow-card mb-8">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Platform Activity (Last {getDisplayDays()} days)
          </h3>
          <CustomLineChart
            chartData={dailyStats}
            colorList={["#c7910a", "#050317"]}
            dataKeys={["visits", "views"]}
            lineNames={["Store Visits", "Product Views"]}
            isMoney={false}
            showHeading={true}
            customClass="h-full"
          />
          <div className="flex items-center gap-4 mt-4 pt-4 border-t text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-primary" />
              <span className="text-muted-foreground">Store Visits</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-secondary" />
              <span className="text-muted-foreground">Product Views</span>
            </div>
          </div>
        </Card>

        {/* Sellers Table */}
        <Card className="shadow-card">
          <div className="p-6 border-b">
            <div className="flex flex-col sm:flex-row justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold mb-1">All Sellers</h2>
                <p className="text-sm text-muted-foreground">
                  Manage and monitor seller accounts with analytics
                </p>
              </div>

              <div className="relative w-full sm:w-64 h-fit">
                <Search className="absolute left-3 top-0 bottom-0 my-auto h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, email or phone..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Store Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead className="text-center">Products</TableHead>
                  <TableHead className="text-center">Visits</TableHead>
                  <TableHead className="text-center">Views</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSellers.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={9}
                      className="text-center py-8 text-muted-foreground">
                      {sellers.length === 0
                        ? "No sellers yet. They will appear here once stores are created."
                        : "No sellers found"}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredSellers.map(seller => (
                    <TableRow key={seller.id}>
                      <TableCell className="font-medium">
                        {seller.store_name}
                      </TableCell>
                      <TableCell className="text-sm">{seller.email}</TableCell>
                      <TableCell className="font-mono text-sm">
                        {seller.contact_phone}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">{seller.products_count}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary">{seller.total_visits}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge className="bg-primary/10 text-primary">
                          {seller.total_product_views}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {seller.is_active ? (
                          <Badge
                            variant="secondary"
                            className="bg-green-500/20 text-green-500">
                            <CheckCircle className="mr-1 h-3 w-3" />
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="destructive">
                            <Ban className="mr-1 h-3 w-3" />
                            Inactive
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(seller.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleViewSellerDetails(seller)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEditStoreModal(seller)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Link
                            to={`/store/${storeSlug(seller)}`}
                            target="_blank">
                            <Button
                              size="sm"
                              variant="outline"
                              aria-label={`Open ${seller.store_name} storefront`}>
                              <ExternalLink className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </Link>

                          <Button
                            size="sm"
                            variant={
                              seller.is_active ? "destructive" : "secondary"
                            }
                            className={
                              seller.is_active
                                ? ""
                                : "bg-green-500 hover:bg-green-600"
                            }
                            onClick={() =>
                              handleToggleStoreStatus(
                                seller.store_id,
                                seller.store_name,
                                seller.is_active
                              )
                            }>
                            {seller.is_active ? (
                              <Ban className="h-4 w-4" />
                            ) : (
                              <CheckCircle className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </main>

      {/* Seller Details Modal */}
      <Dialog open={isSellerModalOpen} onOpenChange={handleCloseSellerModal}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl">Seller Details</DialogTitle>
            <DialogDescription>
              View seller information and manage their store
            </DialogDescription>
          </DialogHeader>

          {selectedSeller && (
            <div className="space-y-6">
              {/* Seller Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold flex items-center gap-2">
                      <Store className="h-4 w-4" />
                      Store Information
                    </h3>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEditStoreModal(selectedSeller)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {/* Edit */}
                    </Button>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Store Name:</span>
                      <p className="font-medium">{selectedSeller.store_name}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Email:</span>
                      <p className="font-medium">{selectedSeller.email}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Contact Phone:</span>
                      <p className="font-medium">{selectedSeller.contact_phone}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Status:</span>
                      <div className="mt-1">
                        {selectedSeller.is_active ? (
                          <Badge variant="secondary" className="bg-green-500/20 text-green-500">
                            <CheckCircle className="mr-1 h-3 w-3" />
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="destructive">
                            <Ban className="mr-1 h-3 w-3" />
                            Inactive
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>

                <Card className="p-4">
                  <h3 className="font-semibold mb-3 flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" />
                    Analytics
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Total Products:</span>
                      <p className="font-medium">{selectedSeller.products_count}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Store Visits:</span>
                      <p className="font-medium">{selectedSeller.total_visits}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Product Views:</span>
                      <p className="font-medium">{selectedSeller.total_product_views}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Joined:</span>
                      <p className="font-medium">
                        {new Date(selectedSeller.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </Card>
              </div>

              {/* Products Section */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-lg flex items-center gap-2">
                    <Package className="h-5 w-5" />
                    Products ({sellerProducts.length})
                  </h3>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={selectedSeller.is_active ? "destructive" : "default"}
                      className={
                        selectedSeller.is_active
                          ? ""
                          : "bg-green-500 hover:bg-green-600"
                      }
                      onClick={() => {
                        handleToggleStoreStatus(
                          selectedSeller.store_id,
                          selectedSeller.store_name,
                          selectedSeller.is_active
                        );
                        handleCloseSellerModal();
                      }}
                    >
                      {selectedSeller.is_active ? (
                        <>
                          <Ban className="h-4 w-4 mr-2" />
                          Block Store
                        </>
                      ) : (
                        <>
                          <CheckCircle className="h-4 w-4 mr-2" />
                          Unblock Store
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {loadingProducts ? (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                ) : sellerProducts.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No products found for this seller
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-96 overflow-y-auto">
                    {sellerProducts.map((product) => (
                      <Card key={product.id} className="p-4">
                        <div className="flex gap-3">
                          {product.images && product.images.length > 0 ? (
                            <img
                              src={product.images[0]}
                              alt={product.name}
                              className="w-20 h-20 object-cover rounded"
                            />
                          ) : (
                            <div className="w-20 h-20 bg-muted rounded flex items-center justify-center">
                              <Package className="h-8 w-8 text-muted-foreground" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium truncate">{product.name}</h4>
                            {product.description && (
                              <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                                {product.description}
                              </p>
                            )}
                            <div className="flex items-center justify-between mt-2">
                              <span className="text-lg font-bold text-primary">
                                {formatCurrency(product.price)}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {new Date(product.created_at).toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog for Block/Unblock */}
      <AlertDialog open={isConfirmDialogOpen} onOpenChange={setIsConfirmDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {sellerToToggle?.isActive ? "Block Store" : "Unblock Store"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {sellerToToggle?.isActive ? (
                <>
                  Are you sure you want to block <strong>{sellerToToggle?.storeName}</strong>?
                  This will prevent the store from being visible to customers and the seller from
                  managing their products.
                </>
              ) : (
                <>
                  Are you sure you want to unblock <strong>{sellerToToggle?.storeName}</strong>?
                  This will make the store visible to customers again.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelToggleStoreStatus}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmToggleStoreStatus}
              className={
                sellerToToggle?.isActive
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : "bg-green-500 hover:bg-green-600"
              }
            >
              {sellerToToggle?.isActive ? "Block Store" : "Unblock Store"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Store Modal */}
      <Dialog open={isEditStoreModalOpen} onOpenChange={setIsEditStoreModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Store Details</DialogTitle>
            <DialogDescription>
              Update store name and contact phone for {selectedSeller?.store_name}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="adminEditStoreName">Store Name</Label>
              <Input
                id="adminEditStoreName"
                value={editStoreName}
                onChange={e => {
                  const value = e.target.value.replace(/[^a-zA-Z0-9\s]/g, "");
                  setEditStoreName(value);
                }}
                placeholder="Store Name"
              />
              <p className="text-[10px] text-muted-foreground">
                Only letters, numbers, and spaces are allowed.
              </p>
              <p className="text-xs text-muted-foreground break-all">
                Store link:{" "}
                {storeUrl({ store_name: editStoreName.trim() || "store name" })}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="adminEditContactPhone">Contact Phone</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="adminEditContactPhone"
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
              onClick={() => setIsEditStoreModalOpen(false)}
              disabled={savingStore}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveStore}
              disabled={savingStore}>
              {savingStore ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminDashboard;

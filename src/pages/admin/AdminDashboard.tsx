import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
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
  MousePointerClick
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { RoleSwitcher } from "@/components/RoleSwitcher";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import CustomLineChart from "@/components/graphs/CustomLineChart";

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

const AdminDashboard = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState("7");
  const [platformTotalVisits, setPlatformTotalVisits] = useState(0);
  const [platformTotalProductViews, setPlatformTotalProductViews] = useState(0);
  const { signOut } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    loadSellers();
    loadPlatformStats();
  }, [dateRange]);

  const loadPlatformStats = async () => {
    const daysAgo = parseInt(dateRange);
    const startDate = startOfDay(subDays(new Date(), daysAgo));
    const endDate = endOfDay(new Date());

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
    const displayDays = Math.min(daysAgo, 14);
    const dailyMap = new Map<string, { visits: number; views: number }>();

    for (let i = displayDays; i >= 0; i--) {
      const day = format(subDays(new Date(), i), "yyyy-MM-dd");
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

    const daysAgo = parseInt(dateRange);
    const startDate = startOfDay(subDays(new Date(), daysAgo));
    const endDate = endOfDay(new Date());

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
        stores.map(async (store: any) => {
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

  const toggleStoreStatus = async (storeId: string, currentStatus: boolean) => {
    const { error } = await supabase
      .from("stores")
      .update({ is_active: !currentStatus })
      .eq("id", storeId);

    if (error) {
      toast({
        title: "Error",
        description: "Could not update store status",
        variant: "destructive"
      });
      return;
    }

    toast({
      title: currentStatus ? "Store Deactivated" : "Store Activated",
      description: `Store has been ${
        currentStatus ? "deactivated" : "activated"
      } successfully`
    });

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
              <RoleSwitcher />
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
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-[160px]">
              <Calendar className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="14">Last 14 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
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
              Store Visits ({dateRange}d)
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
              Product Views ({dateRange}d)
            </div>
          </Card>
        </div>

        {/* Platform Analytics Chart */}
        <Card className="p-6 shadow-card mb-8">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Platform Activity (Last {Math.min(parseInt(dateRange), 14)} days)
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
                          <Link
                            to={`/store/${seller.store_name
                              .toLowerCase()
                              .replace(/\s+/g, "-")}`}
                            target="_blank">
                            <Button size="sm" variant="outline">
                              <ExternalLink className="h-4 w-4" />
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
                              toggleStoreStatus(
                                seller.store_id,
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
    </div>
  );
};

export default AdminDashboard;

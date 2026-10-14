import { SellerNav } from "@/components/SellerNav";
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import {
  BarChart3,
  Eye,
  TrendingUp,
  Package,
  ArrowLeft,
  Calendar,
  MousePointerClick
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import CustomLineChart from "@/components/graphs/CustomLineChart";

interface ProductView {
  product_id: string;
  product_name: string;
  view_count: number;
}

const Analytics = () => {
  const [storeId, setStoreId] = useState<string | null>(null);
  const [storeName, setStoreName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadingAnalytics, setLoadingAnalytics] = useState(true);
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
  const [totalVisits, setTotalVisits] = useState(0);
  const [totalProductViews, setTotalProductViews] = useState(0);
  const [dailyStats, setDailyStats] = useState<
    Array<{
      label: string;
      date: string;
      visits: number;
      views: number;
    }>
  >([]);
  const [topProducts, setTopProducts] = useState<ProductView[]>([]);
  const { user } = useAuth();

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

  useEffect(() => {
    loadStore();
  }, [user]);

  useEffect(() => {
    if (storeId) {
      loadAnalytics();
    }
  }, [storeId, dateRange]);

  const loadStore = async () => {
    if (!user) return;

    const { data: storeData } = await supabase
      .from("stores")
      .select("id, store_name")
      .eq("seller_id", user.id)
      .maybeSingle();

    if (storeData) {
      setStoreId(storeData.id);
      setStoreName(storeData.store_name);
    }
    setLoading(false);
  };

  const loadAnalytics = async () => {
    setLoadingAnalytics(true);
    if (!storeId) return;

    const startDate = dateRange.from;
    const endDate = dateRange.to;
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const displayDays = Math.min(daysDiff, 14);

    // Get total store visits in range
    const { count: visitsCount } = await supabase
      .from("store_visitors")
      .select("*", { count: "exact", head: true })
      .eq("store_id", storeId)
      .gte("visited_at", startDate.toISOString())
      .lte("visited_at", endDate.toISOString());

    setTotalVisits(visitsCount || 0);

    // Get total product views in range
    const { count: productViewsCount } = await supabase
      .from("product_views")
      .select("*", { count: "exact", head: true })
      .eq("store_id", storeId)
      .gte("viewed_at", startDate.toISOString())
      .lte("viewed_at", endDate.toISOString());

    setTotalProductViews(productViewsCount || 0);

    // Get daily data for both visits and product views
    const { data: visitsData } = await supabase
      .from("store_visitors")
      .select("visited_at")
      .eq("store_id", storeId)
      .gte("visited_at", startDate.toISOString())
      .lte("visited_at", endDate.toISOString());

    const { data: productViewsData } = await supabase
      .from("product_views")
      .select("viewed_at")
      .eq("store_id", storeId)
      .gte("viewed_at", startDate.toISOString())
      .lte("viewed_at", endDate.toISOString());

    // Initialize daily map with all dates in range
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

    const chartData = Array.from(dailyMap.entries()).map(([date, stats]) => ({
      label: format(new Date(date), "MMM dd"),
      date: date,
      visits: stats.visits,
      views: stats.views
    }));

    setDailyStats(chartData);

    // Get top viewed products
    const { data: products } = await supabase
      .from("products")
      .select("id, name")
      .eq("store_id", storeId);

    if (products) {
      const productViews = await Promise.all(
        products.map(async product => {
          const { count } = await supabase
            .from("product_views")
            .select("*", { count: "exact", head: true })
            .eq("product_id", product.id)
            .gte("viewed_at", startDate.toISOString())
            .lte("viewed_at", endDate.toISOString());

          return {
            product_id: product.id,
            product_name: product.name,
            view_count: count || 0
          };
        })
      );

      setTopProducts(
        productViews.sort((a, b) => b.view_count - a.view_count).slice(0, 5)
      );
    }
    setLoadingAnalytics(false);
  };

  if (loading || loadingAnalytics) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!storeId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="p-8 text-center">
          <BarChart3 className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-2xl font-bold mb-2">No Store Found</h2>
          <p className="text-muted-foreground mb-4">
            Set up your store first to view analytics
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
              <Link to="/seller/dashboard">
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-xl font-bold">Store Analytics</h1>
                <p className="text-sm text-muted-foreground">{storeName}</p>
              </div>
            </div>

            <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="w-fit sm:w-[280px] justify-start text-left font-normal"
                  onClick={handleDatePickerOpen}
                >
                  <Calendar className="mr-2 h-4 w-4" />
                  <span className="hidden sm:inline">
                    {format(dateRange.from, "MMM dd, yyyy")} - {format(dateRange.to, "MMM dd, yyyy")}
                  </span>
                  <span className="sm:hidden">
                    {format(dateRange.from, "MMM dd")} - {format(dateRange.to, "MMM dd")}
                  </span>
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
        </div>
      </header>
      <SellerNav />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          <Card className="p-6 shadow-card">
            <div className="flex items-center gap-3 mb-2">
              <div className="bg-primary/10 p-2 rounded-lg">
                <Eye className="h-6 w-6 text-primary" />
              </div>
              <span className="text-sm text-muted-foreground">
                Store Visits
              </span>
            </div>
            <div className="text-3xl font-bold">{totalVisits}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {format(dateRange.from, "MMM dd")} - {format(dateRange.to, "MMM dd, yyyy")}
            </p>
          </Card>

          <Card className="p-6 shadow-card">
            <div className="flex items-center gap-3 mb-2">
              <div className="bg-secondary/10 p-2 rounded-lg">
                <MousePointerClick className="h-6 w-6 text-secondary" />
              </div>
              <span className="text-sm text-muted-foreground">
                Product Views
              </span>
            </div>
            <div className="text-3xl font-bold">{totalProductViews}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {format(dateRange.from, "MMM dd")} - {format(dateRange.to, "MMM dd, yyyy")}
            </p>
          </Card>

          <Card className="p-6 shadow-card bg-gradient-primary text-white">
            <div className="flex items-center gap-3 mb-2">
              <div className="bg-white/10 p-2 rounded-lg">
                <TrendingUp className="h-6 w-6" />
              </div>
              <span className="text-sm text-white/80">Conversion Rate</span>
            </div>
            <div className="text-3xl font-bold">
              {totalVisits > 0
                ? ((totalProductViews / totalVisits) * 100).toFixed(1)
                : 0}
              %
            </div>
            <p className="text-xs text-white/70 mt-1">
              Product views per visit
            </p>
          </Card>
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Daily Visits Chart */}
          <Card className="p-6 shadow-card">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              Store Activity (Last {getDisplayDays()} days)
            </h3>
            <CustomLineChart
              chartData={dailyStats}
              colorList={["#c7910a", "#050317"]}
              dataKeys={["visits", "views"]}
              lineNames={["Store Visits", "Product Views"]}
              isMoney={false}
              showHeading={true}
              customClass="h-[300px]"
            />
          </Card>

          {/* Top Products */}
          <Card className="p-6 shadow-card">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Package className="h-5 w-5 text-secondary" />
              Most Viewed Products
            </h3>
            {topProducts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No product views yet</p>
              </div>
            ) : (
              <div className="space-y-4">
                {topProducts.map((product, index) => (
                  <div
                    key={product.product_id}
                    className="flex items-center gap-3">
                    <span
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        index === 0
                          ? "bg-primary text-primary-foreground"
                          : index === 1
                          ? "bg-secondary text-secondary-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}>
                      {index + 1}
                    </span>
                    <span className="flex-1 truncate">
                      {product.product_name}
                    </span>
                    <span className="text-sm font-medium text-muted-foreground">
                      {product.view_count} views
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </main>
    </div>
  );
};

export default Analytics;

import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
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

interface DailyVisits {
  date: string;
  count: number;
}

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
  const [dateRange, setDateRange] = useState("7"); // days
  const [totalVisits, setTotalVisits] = useState(0);
  const [totalProductViews, setTotalProductViews] = useState(0);
  // In your component state, add:
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

    const daysAgo = parseInt(dateRange);
    const startDate = startOfDay(subDays(new Date(), daysAgo));
    const endDate = endOfDay(new Date());

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

    // / Initialize daily map with all dates in range
    const dailyMap = new Map<string, { visits: number; views: number }>();
    for (let i = daysAgo; i >= 0; i--) {
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

  const maxVisits = Math.max(...dailyStats.map(day => day.visits), 1);

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

            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="w-[140px]">
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
        </div>
      </header>

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
              Last {dateRange} days
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
              Last {dateRange} days
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
              Store Visits
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

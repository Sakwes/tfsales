import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
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
  ExternalLink
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface Seller {
  id: string;
  store_id: string;
  phone: string;
  store_name: string;
  is_active: boolean;
  products_count: number;
  created_at: string;
}

const AdminDashboard = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [loading, setLoading] = useState(true);
  const { signOut } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    loadSellers();
  }, []);

  const loadSellers = async () => {
    setLoading(true);
    
    // Get all stores with seller info
    const { data: stores } = await supabase
      .from('stores')
      .select(`
        id,
        seller_id,
        store_name,
        is_active,
        created_at,
        profiles!inner(phone)
      `)
      .order('created_at', { ascending: false });
    
    if (!stores) {
      setLoading(false);
      return;
    }
    
    // Get product counts for each store
    const sellersData = await Promise.all(
      stores.map(async (store: any) => {
        const { count } = await supabase
          .from('products')
          .select('*', { count: 'exact', head: true })
          .eq('store_id', store.id);
        
        return {
          id: store.seller_id,
          store_id: store.id,
          phone: store.profiles.phone,
          store_name: store.store_name,
          is_active: store.is_active,
          products_count: count || 0,
          created_at: store.created_at,
        };
      })
    );
    
    setSellers(sellersData);
    setLoading(false);
  };

  const toggleStoreStatus = async (storeId: string, currentStatus: boolean) => {
    const { error } = await supabase
      .from('stores')
      .update({ is_active: !currentStatus })
      .eq('id', storeId);
    
    if (error) {
      toast({
        title: "Error",
        description: "Could not update store status",
        variant: "destructive",
      });
      return;
    }
    
    toast({
      title: currentStatus ? "Store Deactivated" : "Store Activated",
      description: `Store has been ${currentStatus ? 'deactivated' : 'activated'} successfully`,
    });
    
    await loadSellers();
  };

  const filteredSellers = sellers.filter(
    seller => 
      seller.store_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      seller.phone.includes(searchQuery)
  );

  const totalSellers = sellers.length;
  const activeSellers = sellers.filter(s => s.is_active).length;
  const totalProducts = sellers.reduce((sum, s) => sum + s.products_count, 0);

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
              <p className="text-white/80">Manage sellers and monitor platform activity</p>
            </div>
            <Button variant="outline" className="bg-white/10 border-white/20 text-white hover:bg-white/20" onClick={signOut}>
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card className="p-6 shadow-card">
            <div className="flex items-center justify-between mb-2">
              <Users className="h-8 w-8 text-primary" />
              <Badge variant="secondary">{activeSellers} Active</Badge>
            </div>
            <div className="text-3xl font-bold mb-1">{totalSellers}</div>
            <div className="text-sm text-muted-foreground">Total Sellers</div>
          </Card>

          <Card className="p-6 shadow-card">
            <div className="flex items-center justify-between mb-2">
              <Store className="h-8 w-8 text-secondary" />
            </div>
            <div className="text-3xl font-bold mb-1">{totalProducts}</div>
            <div className="text-sm text-muted-foreground">Total Products</div>
          </Card>

          <Card className="p-6 shadow-card">
            <div className="flex items-center justify-between mb-2">
              <TrendingUp className="h-8 w-8 text-accent" />
            </div>
            <div className="text-3xl font-bold mb-1">{activeSellers}</div>
            <div className="text-sm text-muted-foreground">Active Stores</div>
          </Card>

          <Card className="p-6 shadow-card bg-gradient-primary text-white">
            <div className="flex items-center justify-between mb-2">
              <Eye className="h-8 w-8" />
            </div>
            <div className="text-3xl font-bold mb-1">
              {totalSellers > 0 ? Math.round(totalProducts / totalSellers) : 0}
            </div>
            <div className="text-sm text-white/80">Avg Products/Store</div>
          </Card>
        </div>

        {/* Sellers Table */}
        <Card className="shadow-card">
          <div className="p-6 border-b">
            <div className="flex flex-col sm:flex-row justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold mb-1">All Sellers</h2>
                <p className="text-sm text-muted-foreground">
                  Manage and monitor seller accounts
                </p>
              </div>
              
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or phone..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
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
                  <TableHead>Phone</TableHead>
                  <TableHead>Products</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSellers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      No sellers found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredSellers.map((seller) => (
                    <TableRow key={seller.id}>
                      <TableCell className="font-medium">{seller.store_name}</TableCell>
                      <TableCell className="font-mono text-sm">{seller.phone}</TableCell>
                      <TableCell>{seller.products_count}</TableCell>
                      <TableCell>
                        {seller.is_active ? (
                          <Badge variant="secondary" className="bg-secondary/20 text-secondary">
                            <CheckCircle className="mr-1 h-3 w-3" />
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="destructive">
                            <Ban className="mr-1 h-3 w-3" />
                            Deactivated
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(seller.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Link to={`/store/${seller.store_name.toLowerCase().replace(/\s+/g, '-')}`} target="_blank">
                            <Button size="sm" variant="outline">
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          </Link>
                          <Button 
                            size="sm" 
                            variant={seller.is_active ? "destructive" : "secondary"}
                            onClick={() => toggleStoreStatus(seller.store_id, seller.is_active)}
                          >
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

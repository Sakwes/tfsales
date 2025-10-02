import { useState } from "react";
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

interface Seller {
  id: string;
  phone: string;
  storeName: string;
  status: "active" | "deactivated";
  productsCount: number;
  monthlyVisits: number;
  weeklyVisits: number;
  joinedDate: string;
}

const AdminDashboard = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [sellers] = useState<Seller[]>([
    {
      id: "1",
      phone: "+1 (555) 123-4567",
      storeName: "Fashion Hub",
      status: "active",
      productsCount: 12,
      monthlyVisits: 450,
      weeklyVisits: 120,
      joinedDate: "2024-01-15",
    },
    {
      id: "2",
      phone: "+1 (555) 234-5678",
      storeName: "Tech Store",
      status: "active",
      productsCount: 8,
      monthlyVisits: 380,
      weeklyVisits: 95,
      joinedDate: "2024-02-20",
    },
    {
      id: "3",
      phone: "+1 (555) 345-6789",
      storeName: "Home Goods",
      status: "deactivated",
      productsCount: 5,
      monthlyVisits: 150,
      weeklyVisits: 30,
      joinedDate: "2024-03-10",
    },
  ]);

  const filteredSellers = sellers.filter(
    seller => 
      seller.storeName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      seller.phone.includes(searchQuery)
  );

  const totalSellers = sellers.length;
  const activeSellers = sellers.filter(s => s.status === "active").length;
  const totalProducts = sellers.reduce((sum, s) => sum + s.productsCount, 0);
  const totalVisits = sellers.reduce((sum, s) => sum + s.monthlyVisits, 0);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-gradient-primary text-white py-6 px-4 sm:px-6 lg:px-8 shadow-glow">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-white/10 backdrop-blur-sm p-2 rounded-lg">
              <Shield className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-bold">Admin Dashboard</h1>
          </div>
          <p className="text-white/80">Manage sellers and monitor platform activity</p>
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
            <div className="text-3xl font-bold mb-1">{totalVisits.toLocaleString()}</div>
            <div className="text-sm text-muted-foreground">Monthly Visits</div>
          </Card>

          <Card className="p-6 shadow-card bg-gradient-primary text-white">
            <div className="flex items-center justify-between mb-2">
              <Eye className="h-8 w-8" />
            </div>
            <div className="text-3xl font-bold mb-1">
              {Math.round(totalVisits / totalSellers)}
            </div>
            <div className="text-sm text-white/80">Avg Visits/Store</div>
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
                  <TableHead>Weekly Visits</TableHead>
                  <TableHead>Monthly Visits</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSellers.map((seller) => (
                  <TableRow key={seller.id}>
                    <TableCell className="font-medium">{seller.storeName}</TableCell>
                    <TableCell className="font-mono text-sm">{seller.phone}</TableCell>
                    <TableCell>{seller.productsCount}</TableCell>
                    <TableCell>{seller.weeklyVisits}</TableCell>
                    <TableCell>{seller.monthlyVisits}</TableCell>
                    <TableCell>
                      {seller.status === "active" ? (
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
                      {new Date(seller.joinedDate).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline">
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                        {seller.status === "active" ? (
                          <Button size="sm" variant="destructive">
                            <Ban className="h-4 w-4" />
                          </Button>
                        ) : (
                          <Button size="sm" variant="secondary">
                            <CheckCircle className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      </main>
    </div>
  );
};

export default AdminDashboard;

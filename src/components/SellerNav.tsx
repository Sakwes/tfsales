import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { LayoutDashboard, BarChart3, CreditCard } from "lucide-react";

const links = [
  { to: "/seller/dashboard", label: "Products", icon: LayoutDashboard },
  { to: "/seller/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/seller/subscription", label: "Plan", icon: CreditCard }
];

export function SellerNav() {
  const { pathname } = useLocation();

  return (
    <nav aria-label="Seller sections" className="border-b bg-card">
      <ul className="max-w-7xl mx-auto px-2 sm:px-6 lg:px-8 flex gap-1 overflow-x-auto">
        {links.map(({ to, label, icon: Icon }) => {
          const active = pathname === to;
          return (
            <li key={to}>
              <Link
                to={to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap px-3 py-3 text-sm font-medium border-b-2 transition-colors",
                  active
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}>
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

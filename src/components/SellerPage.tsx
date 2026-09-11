import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { SellerNav } from "@/components/SellerNav";
import { RoleSwitcher } from "@/components/RoleSwitcher";
import logo from "@/assets/logo.png";

interface Props {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

/** Shared shell for the seller area: brand bar, section nav and page heading. */
export function SellerPage({ title, description, actions, children }: Props) {
  return (
    <div className="min-h-screen bg-background">
      <header className="bg-secondary text-secondary-foreground">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <Link to="/seller/dashboard" className="flex items-center gap-2">
            <img src={logo} alt="SellNova" className="h-8 w-auto" />
            <span className="font-bold hidden sm:inline">SellNova</span>
          </Link>
          <RoleSwitcher />
        </div>
      </header>

      <SellerNav />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">{title}</h1>
            {description && (
              <p className="text-muted-foreground mt-1">{description}</p>
            )}
          </div>
          {actions}
        </div>
        {children}
      </main>
    </div>
  );
}

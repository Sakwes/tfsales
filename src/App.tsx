import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AdminRoute } from "./components/AdminRoute";
import { AuthCallbackHandler } from "./components/AuthCallbackHandler";
import Landing from "./pages/Landing";
import Register from "./pages/auth/Register";
import Login from "./pages/auth/Login";
import ForgotPassword from "./pages/auth/ForgotPassword";
import ResetPassword from "./pages/auth/ResetPassword";
import ResendConfirmation from "./pages/auth/ResendConfirmation";
import Onboarding from "./pages/seller/Onboarding";
import Dashboard from "./pages/seller/Dashboard";
import Analytics from "./pages/seller/Analytics";
import SubscriptionPage from "./pages/seller/Subscription";
import BrandingPage from "./pages/seller/Branding";
import OrdersPage from "./pages/seller/Orders";
import ReviewsPage from "./pages/seller/Reviews";
import PromotionsPage from "./pages/seller/Promotions";
import ReviewPage from "./pages/store/ReviewPage";
import StoreFront from "./pages/store/StoreFront";
import AdminSubscriptions from "./pages/admin/Subscriptions";
import AdminDashboard from "./pages/admin/AdminDashboard";
import NotFound from "./pages/NotFound";
import TermsAndConditions from "./pages/legal/TermsAndConditions";
import PrivacyPolicy from "./pages/legal/PrivacyPolicy";
import Support from "./pages/legal/Support";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthCallbackHandler />
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/auth/register" element={<Register />} />
            <Route path="/auth/login" element={<Login />} />
            <Route path="/auth/forgot-password" element={<ForgotPassword />} />
            <Route path="/auth/reset-password" element={<ResetPassword />} />
            <Route path="/auth/resend-confirmation" element={<ResendConfirmation />} />
            <Route path="/seller/onboarding" element={
              <ProtectedRoute>
                <Onboarding />
              </ProtectedRoute>
            } />
            <Route path="/seller/dashboard" element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            } />
            <Route path="/seller/analytics" element={
              <ProtectedRoute>
                <Analytics />
              </ProtectedRoute>
            } />
            <Route path="/seller/subscription" element={
              <ProtectedRoute>
                <SubscriptionPage />
              </ProtectedRoute>
            } />
            <Route path="/seller/branding" element={<ProtectedRoute><BrandingPage /></ProtectedRoute>} />
            <Route path="/seller/orders" element={<ProtectedRoute><OrdersPage /></ProtectedRoute>} />
            <Route path="/seller/reviews" element={<ProtectedRoute><ReviewsPage /></ProtectedRoute>} />
            <Route path="/seller/promotions" element={<ProtectedRoute><PromotionsPage /></ProtectedRoute>} />
            <Route path="/review/:token" element={<ReviewPage />} />
            <Route path="/terms" element={<TermsAndConditions />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/support" element={<Support />} />
            <Route path="/admin" element={
              <AdminRoute>
                <AdminDashboard />
              </AdminRoute>
            } />
            <Route path="/admin/subscriptions" element={<AdminRoute><AdminSubscriptions /></AdminRoute>} />
            <Route path="/404" element={<NotFound />} />
            <Route path="/store/:storeName" element={<StoreFront />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;

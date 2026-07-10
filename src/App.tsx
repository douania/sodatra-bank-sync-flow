import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import FileUpload from "./pages/FileUpload";
import Reconciliation from "./pages/Reconciliation";
import DocumentUnderstanding from "./pages/DocumentUnderstanding";
import DailyStatementV2 from "./pages/DailyStatementV2";
import QualityControl from "./pages/QualityControl";
import NotFound from "./pages/NotFound";
import { useDailyV2Access } from "./features/daily-v2/dailyV2Access";

const queryClient = new QueryClient();

const DailyV2Route = () => {
  const { rolesQuery, canAccessPage } = useDailyV2Access();

  if (rolesQuery.isLoading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-sm text-muted-foreground">
        Vérification des accès Daily v2…
      </div>
    );
  }

  if (rolesQuery.isError || !canAccessPage) {
    return <Navigate to="/dashboard" replace />;
  }

  return <DailyStatementV2 />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Layout>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/upload" element={<ProtectedRoute><FileUpload /></ProtectedRoute>} />
              <Route path="/upload-bulk" element={<ProtectedRoute><Navigate to="/upload" replace /></ProtectedRoute>} />
              <Route path="/reconciliation" element={<ProtectedRoute><Reconciliation /></ProtectedRoute>} />
              <Route path="/document-understanding" element={<ProtectedRoute><DocumentUnderstanding /></ProtectedRoute>} />
              <Route path="/daily-statements" element={<ProtectedRoute><DailyV2Route /></ProtectedRoute>} />
              <Route path="/quality-control" element={<ProtectedRoute><QualityControl /></ProtectedRoute>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Layout>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

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
import CollectionsCore from "./pages/CollectionsCore";
import NotFound from "./pages/NotFound";
import { useDailyV2Access } from "./features/daily-v2/dailyV2Access";
import { DailyV2AccessFeedback } from "./features/daily-v2/session/DailyV2AccessFeedback";
import {
  CollectionsCorePilotGateProvider,
  useCollectionsCorePilotGate,
} from "./features/collections-core/CollectionsCorePilotGate";

const queryClient = new QueryClient();

const DailyV2Route = () => {
  const { accessState } = useDailyV2Access();

  if (accessState.status === "checking") {
    return <DailyV2AccessFeedback state={accessState} />;
  }

  if (accessState.status === "blocked") {
    return <DailyV2AccessFeedback state={accessState} />;
  }

  return <DailyStatementV2 />;
};

const CollectionsCoreRoute = () => {
  const { gate } = useCollectionsCorePilotGate();
  if (gate.status === 'checking') {
    return <div className="py-12 text-center text-sm text-muted-foreground">Vérification du pilote Collections…</div>;
  }
  if (gate.status === 'blocked') {
    return (
      <div role="alert" className="mx-auto max-w-xl rounded-lg border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Collections Core non disponible</h1>
        <p className="mt-2 text-sm text-muted-foreground">{gate.reason}</p>
      </div>
    );
  }
  return <CollectionsCore />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <CollectionsCorePilotGateProvider>
            <Layout>
              <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/upload" element={<ProtectedRoute><FileUpload /></ProtectedRoute>} />
              <Route path="/upload-bulk" element={<ProtectedRoute><Navigate to="/upload" replace /></ProtectedRoute>} />
              <Route path="/reconciliation" element={<ProtectedRoute><Reconciliation /></ProtectedRoute>} />
              <Route path="/collections-remittances" element={<ProtectedRoute><CollectionsCoreRoute /></ProtectedRoute>} />
              <Route path="/document-understanding" element={<ProtectedRoute><DocumentUnderstanding /></ProtectedRoute>} />
              <Route path="/daily-statements" element={<ProtectedRoute><DailyV2Route /></ProtectedRoute>} />
              <Route path="/quality-control" element={<ProtectedRoute><QualityControl /></ProtectedRoute>} />
              <Route path="*" element={<NotFound />} />
              </Routes>
            </Layout>
          </CollectionsCorePilotGateProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

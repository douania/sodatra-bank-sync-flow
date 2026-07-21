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
import type { DailyV2AccessState } from "./features/daily-v2/dailyV2AccessState";

const queryClient = new QueryClient();

const DailyV2AccessBlocked = ({ state }: { state: Extract<DailyV2AccessState, { status: "blocked" }> }) => {
  const content = {
    runtime_target_rejected: {
      title: "Configuration Daily v2 non autorisée",
      description: state.safeDetail ?? "La cible d’exécution Daily v2 n’est pas autorisée.",
    },
    role_lookup_failed: {
      title: "Vérification des accès impossible",
      description: "L’application n’a pas pu vérifier vos autorisations Daily v2. Réessayez plus tard.",
    },
    insufficient_role: {
      title: "Accès Daily v2 non autorisé",
      description: "Votre compte ne dispose pas d’un rôle autorisé pour Daily v2.",
    },
  }[state.reason];

  return (
    <div className="min-h-[40vh] flex items-center justify-center px-4">
      <div role="alert" className="w-full max-w-xl rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
        <h1 className="text-lg font-semibold">{content.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{content.description}</p>
        <p className="mt-4 text-xs text-muted-foreground">
          Aucun accès Daily v2 n’a été accordé.
        </p>
      </div>
    </div>
  );
};

const DailyV2Route = () => {
  const { accessState } = useDailyV2Access();

  if (accessState.status === "checking") {
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-sm text-muted-foreground">
        Vérification des accès Daily v2…
      </div>
    );
  }

  if (accessState.status === "blocked") {
    return <DailyV2AccessBlocked state={accessState} />;
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

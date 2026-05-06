
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import FileUpload from "./pages/FileUpload";
import FileUploadBulk from "./pages/FileUploadBulk";
import Reconciliation from "./pages/Reconciliation";
import DocumentUnderstanding from "./pages/DocumentUnderstanding";
import QualityControl from "./pages/QualityControl";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

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
              <Route path="/upload-bulk" element={<ProtectedRoute><FileUploadBulk /></ProtectedRoute>} />
              <Route path="/reconciliation" element={<ProtectedRoute><Reconciliation /></ProtectedRoute>} />
              <Route path="/document-understanding" element={<ProtectedRoute><DocumentUnderstanding /></ProtectedRoute>} />
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

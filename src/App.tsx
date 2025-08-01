
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Index from "./pages/Index";
import Dashboard from "./pages/Dashboard";
import FileUpload from "./pages/FileUpload";
import FileUploadBulk from "./pages/FileUploadBulk";
import ConsolidatedDashboard from "./pages/ConsolidatedDashboard";
import Reconciliation from "./pages/Reconciliation";
import DocumentUnderstanding from "./pages/DocumentUnderstanding";
import Alerts from "./pages/Alerts";
import QualityControl from "./pages/QualityControl";
import BankingDashboard from "./pages/BankingDashboard";
import BankingReports from "./pages/BankingReports";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/upload" element={<FileUpload />} />
            <Route path="/upload-bulk" element={<FileUploadBulk />} />
            <Route path="/consolidated" element={<ConsolidatedDashboard />} />
            <Route path="/reconciliation" element={<Reconciliation />} />
            <Route path="/document-understanding" element={<DocumentUnderstanding />} />
        <Route path="/banking/dashboard" element={<BankingDashboard />} />
        <Route path="/banking/reports" element={<BankingReports />} />
        <Route path="/consolidated-dashboard" element={<ConsolidatedDashboard />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/quality-control" element={<QualityControl />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

import React from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle } from 'lucide-react';

const ConsolidatedDashboard = () => {
  return (
    <div className="space-y-6 p-6">
      <h1 className="text-3xl font-bold text-gray-900">Vue Consolidée Multi-Banques</h1>
      <Alert className="border-orange-300 bg-orange-50">
        <AlertTriangle className="h-5 w-5 text-orange-600" />
        <AlertDescription className="text-orange-800 font-medium">
          ⚠️ Module non connecté aux données réelles. Les données consolidées affichées sur cette page ne doivent pas être utilisées en production. Veuillez vérifier la connexion aux données avant tout usage.
        </AlertDescription>
      </Alert>
    </div>
  );
};

export default ConsolidatedDashboard;

import React from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle } from 'lucide-react';

const Alerts = () => {
  return (
    <div className="space-y-6 p-6">
      <h1 className="text-3xl font-bold text-gray-900">Alertes</h1>
      <Alert className="border-orange-300 bg-orange-50">
        <AlertTriangle className="h-5 w-5 text-orange-600" />
        <AlertDescription className="text-orange-800 font-medium">
          ⚠️ Module non connecté aux données réelles. Les alertes affichées sur cette page sont des données de démonstration fictives et ne doivent pas être utilisées en production.
        </AlertDescription>
      </Alert>
    </div>
  );
};

export default Alerts;

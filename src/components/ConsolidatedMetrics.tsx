
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DollarSign, Building2, AlertTriangle, Clock, TrendingUp, TrendingDown } from 'lucide-react';
import { DashboardMetrics } from '@/services/dashboardMetricsService';

interface ConsolidatedMetricsProps {
  metrics: DashboardMetrics | null;
}

const ConsolidatedMetrics: React.FC<ConsolidatedMetricsProps> = ({ metrics }) => {
  if (!metrics) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="h-4 bg-gray-200 rounded w-24"></div>
              <div className="h-4 w-4 bg-gray-200 rounded"></div>
            </CardHeader>
            <CardContent>
              <div className="h-8 bg-gray-200 rounded w-16 mb-2"></div>
              <div className="h-3 bg-gray-200 rounded w-20"></div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Position Consolidée</CardTitle>
          <DollarSign className="h-4 w-4 text-blue-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {(metrics.totalBalance / 1000000).toFixed(1)}M
          </div>
          <div className="flex items-center text-xs text-gray-600">
            {metrics.totalMovement >= 0 ? (
              <TrendingUp className="h-3 w-3 text-green-500 mr-1" />
            ) : (
              <TrendingDown className="h-3 w-3 text-red-500 mr-1" />
            )}
            {metrics.totalMovement >= 0 ? '+' : ''}
            {(metrics.totalMovement / 1000000).toFixed(1)}M FCFA
          </div>
          <div className="text-xs text-gray-500">
            Variation: {metrics.movementPercentage.toFixed(1)}%
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Facilités Consolidées</CardTitle>
          <Building2 className="h-4 w-4 text-green-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {(metrics.totalFacilities / 1000000000).toFixed(1)}Md
          </div>
          <div className="text-xs text-muted-foreground">
            Utilisé: {metrics.utilizationRate.toFixed(1)}%
          </div>
          <div className="text-xs text-green-600">
            Disponible: {(metrics.facilitiesAvailable / 1000000000).toFixed(1)}Md
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Impayés Cross-Bank</CardTitle>
          <AlertTriangle className="h-4 w-4 text-red-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-red-600">
            {(metrics.totalImpayes / 1000000).toFixed(1)}M
          </div>
          <div className="text-xs text-muted-foreground">
            {metrics.impayesCount} transactions
          </div>
          <div className="text-xs text-red-500">
            {metrics.topRiskyClients.length} clients multi-banques
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Alertes Critiques</CardTitle>
          <Clock className="h-4 w-4 text-orange-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-orange-600">
            {metrics.criticalMovements.length}
          </div>
          <p className="text-xs text-muted-foreground">
            Mouvements critiques détectés
          </p>
          <div className="text-xs text-gray-500">
            {metrics.totalBanks} banques surveillées
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ConsolidatedMetrics;

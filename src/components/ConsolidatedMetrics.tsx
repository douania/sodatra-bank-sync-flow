
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DollarSign, Building2, AlertTriangle, Clock, TrendingUp, TrendingDown } from 'lucide-react';

interface ConsolidatedMetricsProps {
  consolidatedAnalysis: any;
}

const ConsolidatedMetrics: React.FC<ConsolidatedMetricsProps> = ({ consolidatedAnalysis }) => {
  if (!consolidatedAnalysis) return null;

  const { consolidatedPosition, consolidatedFacilities, totalImpayes, criticalAlerts } = consolidatedAnalysis;

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Position Consolidée</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {(consolidatedPosition.totalClosingBalance / 1000000).toFixed(1)}M
          </div>
          <div className="flex items-center text-xs text-muted-foreground">
            {consolidatedPosition.netMovement >= 0 ? (
              <TrendingUp className="h-3 w-3 text-green-500 mr-1" />
            ) : (
              <TrendingDown className="h-3 w-3 text-red-500 mr-1" />
            )}
            {consolidatedPosition.netMovement >= 0 ? '+' : ''}
            {(consolidatedPosition.netMovement / 1000000).toFixed(1)}M FCFA
          </div>
          <div className="text-xs text-gray-500">
            Variation: {consolidatedPosition.movementPercentage.toFixed(1)}%
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Facilités Consolidées</CardTitle>
          <Building2 className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {(consolidatedFacilities.totalLimits / 1000000000).toFixed(1)}Md
          </div>
          <div className="text-xs text-muted-foreground">
            Utilisé: {consolidatedFacilities.utilizationRate.toFixed(1)}%
          </div>
          <div className="text-xs text-green-600">
            Disponible: {(consolidatedFacilities.totalAvailable / 1000000000).toFixed(1)}Md
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Impayés Cross-Bank</CardTitle>
          <AlertTriangle className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-red-600">
            {totalImpayes ? (totalImpayes.totalAmount / 1000000).toFixed(1) : '0'}M
          </div>
          <div className="text-xs text-muted-foreground">
            {totalImpayes ? totalImpayes.totalCount : 0} transactions
          </div>
          <div className="text-xs text-red-500">
            {consolidatedAnalysis.crossBankClients.riskyClients.length} clients multi-banques
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Alertes Critiques</CardTitle>
          <Clock className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-orange-600">
            {criticalAlerts ? criticalAlerts.length : 0}
          </div>
          <p className="text-xs text-muted-foreground">
            Surveillance active
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default ConsolidatedMetrics;

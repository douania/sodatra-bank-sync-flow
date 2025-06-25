
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, TrendingUp, TrendingDown, Building2, Users } from 'lucide-react';
import { BankReport } from '@/types/banking';

interface ConsolidatedBankViewProps {
  bankReports: BankReport[];
  consolidatedAnalysis: any;
}

const ConsolidatedBankView: React.FC<ConsolidatedBankViewProps> = ({ 
  bankReports, 
  consolidatedAnalysis 
}) => {
  if (!consolidatedAnalysis) return null;

  const { crossBankClients, criticalAlerts } = consolidatedAnalysis;

  return (
    <div className="space-y-6">
      {/* Vue Exécutive Consolidée */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Users className="h-5 w-5 text-red-600" />
            <span>Vue Exécutive Multi-Banques</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-center p-4 bg-blue-50 rounded-lg">
              <div className="text-2xl font-bold text-blue-600">
                {bankReports.length}
                <span className="text-sm font-normal ml-1">/ {consolidatedAnalysis.consolidatedPosition.bankCount || bankReports.length}</span>
              </div>
              <div className="text-sm text-gray-600">Banques Surveillées</div>
            </div>
            <div className="text-center p-4 bg-green-50 rounded-lg">
              <div className="text-2xl font-bold text-green-600">
                {(consolidatedAnalysis.consolidatedFacilities.totalAvailable / 1000000000).toFixed(1)}Md
              </div>
              <div className="text-sm text-gray-600">Crédit Disponible</div>
            </div>
            <div className="text-center p-4 bg-red-50 rounded-lg">
              <div className="text-2xl font-bold text-red-600">
                {crossBankClients.riskyClients.length}
              </div>
              <div className="text-sm text-gray-600">Clients Multi-Banques</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Top Risques Cross-Bank */}
      {crossBankClients.riskyClients.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2 text-red-600">
              <Users className="h-5 w-5" />
              <span>Top Risques Cross-Bank</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {crossBankClients.riskyClients.slice(0, 5).map((client: any, index: number) => (
                <div key={index} className="flex items-center justify-between p-3 border-l-4 border-red-400 bg-red-50">
                  <div>
                    <div className="font-semibold">{client.clientCode}</div>
                    <div className="text-sm text-gray-600">
                      🏦 {client.banks.join(' • ')} ({client.bankCount} banques)
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-red-600">
                      {(client.totalRisk / 1000000).toFixed(1)}M
                    </div>
                    <div className="text-xs text-gray-500">Exposition totale</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Mouvements Critiques */}
      <Card>
        <CardHeader>
          <CardTitle>⚡ Mouvements Critiques Détectés</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {bankReports.map((report, index) => {
              const variation = report.closingBalance - report.openingBalance;
              const isCritical = Math.abs(variation) > 50000000; // >50M
              
              if (!isCritical) return null;
              
              return (
                <Alert key={index} className="border-orange-200 bg-orange-50">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="flex justify-between items-center">
                    <div>
                      <span className="font-semibold">{report.bank}</span>
                      <div className="text-sm text-gray-600">
                        Mouvement critique détecté
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center">
                        {variation >= 0 ? (
                          <TrendingUp className="h-4 w-4 text-green-500 mr-1" />
                        ) : (
                          <TrendingDown className="h-4 w-4 text-red-500 mr-1" />
                        )}
                        <span className="font-medium">
                          {variation >= 0 ? '+' : ''}{(variation / 1000000).toFixed(1)}M
                        </span>
                      </div>
                    </div>
                  </AlertDescription>
                </Alert>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Facilités Sous-Utilisées */}
      <Card>
        <CardHeader>
          <CardTitle>💡 Opportunités de Financement</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {bankReports.map((report, index) => {
              const totalLimit = report.bankFacilities.reduce((sum, f) => sum + f.limitAmount, 0);
              const totalUsed = report.bankFacilities.reduce((sum, f) => sum + f.usedAmount, 0);
              const utilizationRate = totalLimit > 0 ? (totalUsed / totalLimit) * 100 : 0;
              
              if (utilizationRate > 20 || totalLimit === 0) return null; // Seulement les sous-utilisées
              
              return (
                <div key={index} className="flex items-center justify-between p-3 border-l-4 border-green-400 bg-green-50">
                  <div>
                    <div className="font-semibold">{report.bank}</div>
                    <div className="text-sm text-gray-600">
                      Sous-utilisation significative ({utilizationRate.toFixed(1)}%)
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-green-600">
                      {((totalLimit - totalUsed) / 1000000000).toFixed(1)}Md
                    </div>
                    <div className="text-xs text-gray-500">Disponible</div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ConsolidatedBankView;


import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertTriangle, TrendingUp, TrendingDown, Clock, Users, Eye } from 'lucide-react';
import ClientRiskAnalysisModal from './ClientRiskAnalysisModal';

interface CriticalAlertsPanelProps {
  criticalAlerts: any[];
  crossBankClients: any;
}

const CriticalAlertsPanel: React.FC<CriticalAlertsPanelProps> = ({ 
  criticalAlerts, 
  crossBankClients 
}) => {
  const [selectedClient, setSelectedClient] = useState<{
    clientCode: string;
    clientData: {
      totalRisk: number;
      bankCount: number;
      banks: string[];
    };
  } | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleViewDetails = (client: any) => {
    setSelectedClient({
      clientCode: client.clientCode,
      clientData: {
        totalRisk: client.totalRisk,
        bankCount: client.bankCount,
        banks: client.banks
      }
    });
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedClient(null);
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'CRITICAL': return 'border-red-500 bg-red-50';
      case 'HIGH': return 'border-orange-500 bg-orange-50';
      case 'MEDIUM': return 'border-yellow-500 bg-yellow-50';
      default: return 'border-blue-500 bg-blue-50';
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'CRITICAL': return <AlertTriangle className="h-4 w-4 text-red-500" />;
      case 'HIGH': return <AlertTriangle className="h-4 w-4 text-orange-500" />;
      case 'MEDIUM': return <Clock className="h-4 w-4 text-yellow-500" />;
      default: return <AlertTriangle className="h-4 w-4 text-blue-500" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Alertes Cross-Bank Critiques */}
      {criticalAlerts && criticalAlerts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-red-600 flex items-center">
              <AlertTriangle className="h-5 w-5 mr-2" />
              🚨 Alertes Cross-Bank Critiques
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {criticalAlerts.slice(0, 5).map((alert: any, index: number) => (
                <Alert key={index} className={getSeverityColor(alert.severity)}>
                  {getSeverityIcon(alert.severity)}
                  <AlertDescription className="flex justify-between items-center">
                    <div className="flex-1">
                      <span className="font-semibold">{alert.title}</span>
                      <div className="text-sm text-gray-600 mt-1">{alert.description}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        <strong>Action:</strong> {alert.action}
                      </div>
                    </div>
                    <div className="text-sm font-medium">
                      {alert.amount && (
                        <div className="text-right">
                          <div className={`font-bold ${
                            alert.severity === 'CRITICAL' ? 'text-red-600' : 
                            alert.severity === 'HIGH' ? 'text-orange-600' : 'text-yellow-600'
                          }`}>
                            {(alert.amount / 1000000).toFixed(1)}M FCFA
                          </div>
                          {alert.bankName && (
                            <div className="text-xs text-gray-500">{alert.bankName}</div>
                          )}
                        </div>
                      )}
                    </div>
                  </AlertDescription>
                </Alert>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Clients Cross-Bank à Risque */}
      {crossBankClients && crossBankClients.riskyClients && crossBankClients.riskyClients.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2 text-red-600">
              <Users className="h-5 w-5" />
              <span>⚠️ Clients Multi-Banques à Risque</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {crossBankClients.riskyClients.slice(0, 5).map((client: any, index: number) => (
                <div key={index} className="flex items-center justify-between p-4 border rounded-lg bg-red-50 border-l-4 border-red-400">
                  <div className="flex items-center space-x-3">
                    <div className="w-3 h-3 rounded-full bg-red-500" />
                    <div>
                      <span className="font-medium text-lg">{client.clientCode}</span>
                      <div className="text-sm text-gray-600">
                        🏦 Présent sur <strong>{client.bankCount} banques</strong>: {client.banks.join(', ')}
                      </div>
                      <div className="text-xs text-red-600 mt-1">
                        ⚠️ Client nécessitant une surveillance renforcée
                      </div>
                    </div>
                  </div>
                  <div className="text-right flex items-center space-x-3">
                    <div>
                      <div className="text-xl font-bold text-red-600">
                        {(client.totalRisk / 1000000).toFixed(1)}M
                      </div>
                      <div className="text-xs text-gray-500">
                        Exposition totale FCFA
                      </div>
                      <div className="text-xs text-red-500 mt-1">
                        Risque élevé
                      </div>
                    </div>
                    <Button
                      onClick={() => handleViewDetails(client)}
                      variant="outline"
                      size="sm"
                      className="border-blue-500 text-blue-600 hover:bg-blue-50"
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      Détails
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Modal de détails */}
      {selectedClient && (
        <ClientRiskAnalysisModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          clientCode={selectedClient.clientCode}
          clientData={selectedClient.clientData}
        />
      )}
    </div>
  );
};

export default CriticalAlertsPanel;

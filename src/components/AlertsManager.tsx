import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, TrendingUp, TrendingDown, Clock } from 'lucide-react';
import { BankReport, FundPosition, Alert as AlertType } from '@/types/banking';

interface AlertsManagerProps {
  bankReports: BankReport[];
  fundPosition: FundPosition | null;
}

export const AlertsManager: React.FC<AlertsManagerProps> = ({ bankReports, fundPosition }) => {
  
  const generateAlerts = (): AlertType[] => {
    const alerts: AlertType[] = [];
    
    // Alerte 1: Variation significative des soldes (seuil 15%)
    bankReports.forEach(report => {
      const variation = report.closingBalance - report.openingBalance;
      const variationPercent = report.openingBalance > 0 ? Math.abs(variation / report.openingBalance) * 100 : 0;
      
      if (variationPercent > 15) {
        alerts.push({
          type: 'WARNING',
          title: `Variation importante - ${report.bank}`,
          description: `Variation de ${variationPercent.toFixed(1)}% détectée`,
          action: 'Vérifier les transactions et dépôts',
          trigger: 'Seuil de variation > 15%',
          value: variationPercent,
          threshold: 15,
          createdAt: new Date().toISOString()
        });
      }
    });

    // Alerte 2: Facilités bancaires critiques (seuil 80%)
    bankReports.forEach(report => {
      report.bankFacilities.forEach(facility => {
        const utilizationRate = facility.limitAmount > 0 ? (facility.usedAmount / facility.limitAmount) * 100 : 0;
        
        if (utilizationRate > 80) {
          alerts.push({
            type: utilizationRate > 95 ? 'CRITICAL' : 'WARNING',
            title: `Facilité critique - ${report.bank}`,
            description: `${facility.facilityType}: ${utilizationRate.toFixed(1)}% utilisé`,
            action: 'Négocier augmentation ou réduire exposition',
            trigger: `Utilisation > ${utilizationRate > 95 ? '95' : '80'}%`,
            value: utilizationRate,
            threshold: utilizationRate > 95 ? 95 : 80,
            createdAt: new Date().toISOString()
          });
        }
      });
    });

    // Alerte 3: Impayés détectés avec informations précises
    bankReports.forEach(report => {
      if (report.impayes.length > 0) {
        // Grouper les impayés par client pour éviter les doublons
        const impayesByClient = new Map();
        
        report.impayes.forEach(impaye => {
          const clientKey = `${impaye.clientCode}-${report.bank}`;
          if (!impayesByClient.has(clientKey)) {
            impayesByClient.set(clientKey, []);
          }
          impayesByClient.get(clientKey).push(impaye);
        });
        
        impayesByClient.forEach((clientImpayes, clientKey) => {
          const totalAmount = clientImpayes.reduce((sum, impaye) => sum + impaye.montant, 0);
          const [clientCode, bankName] = clientKey.split('-');
          
          // Créer des descriptions détaillées pour chaque impayé
          const impayeDetails = clientImpayes.map(impaye => {
            const details = [];
            details.push(`Montant: ${(impaye.montant / 1000000).toFixed(1)}M CFA`);
            details.push(`Échéance: ${impaye.dateEcheance}`);
            if (impaye.description) {
              details.push(`Réf: ${impaye.description}`);
            }
            return details.join(' | ');
          }).join('\n');
          
          alerts.push({
            type: totalAmount > 50000000 ? 'CRITICAL' : 'WARNING',
            title: `Impayé ${clientCode} - ${bankName}`,
            description: `${clientImpayes.length} impayé(s) pour ${(totalAmount / 1000000).toFixed(1)}M CFA\n${impayeDetails}`,
            action: 'Identifier le chèque/effet et relancer le client',
            trigger: 'Présence d\'impayés avec références précises',
            value: totalAmount / 1000000,
            createdAt: new Date().toISOString()
          });
        });
      }
    });

    // Alerte 4: Fund Position - Collections importantes non déposées
    if (fundPosition && fundPosition.collectionsNotDeposited > 200000000) {
      alerts.push({
        type: 'WARNING',
        title: 'Collections importantes non déposées',
        description: `${(fundPosition.collectionsNotDeposited / 1000000).toFixed(1)}M CFA en attente`,
        action: 'Accélérer les dépôts bancaires',
        trigger: 'Collections > 200M CFA',
        value: fundPosition.collectionsNotDeposited / 1000000,
        threshold: 200,
        createdAt: new Date().toISOString()
      });
    }

    // Alerte 5: Écart entre Fund Position et soldes bancaires
    if (fundPosition) {
      const totalBankBalances = bankReports.reduce((sum, report) => sum + report.closingBalance, 0);
      const ecart = Math.abs(fundPosition.totalFundAvailable - totalBankBalances);
      const ecartPercent = totalBankBalances > 0 ? (ecart / totalBankBalances) * 100 : 0;
      
      if (ecartPercent > 5) {
        alerts.push({
          type: 'WARNING',
          title: 'Écart Fund Position vs Soldes Bancaires',
          description: `Écart de ${(ecart / 1000000).toFixed(1)}M CFA (${ecartPercent.toFixed(1)}%)`,
          action: 'Vérifier la cohérence des données',
          trigger: 'Écart > 5%',
          value: ecartPercent,
          threshold: 5,
          createdAt: new Date().toISOString()
        });
      }
    }

    return alerts.sort((a, b) => {
      const priority = { 'CRITICAL': 3, 'WARNING': 2, 'INFO': 1 };
      return priority[b.type] - priority[a.type];
    });
  };

  const alerts = generateAlerts();
  const criticalAlerts = alerts.filter(alert => alert.type === 'CRITICAL');
  const warningAlerts = alerts.filter(alert => alert.type === 'WARNING');

  const getSeverityColor = (type: string) => {
    switch (type) {
      case 'CRITICAL': return 'border-red-500 bg-red-50';
      case 'WARNING': return 'border-yellow-500 bg-yellow-50';
      default: return 'border-blue-500 bg-blue-50';
    }
  };

  const getSeverityIcon = (type: string) => {
    switch (type) {
      case 'CRITICAL': return <AlertTriangle className="h-4 w-4 text-red-600" />;
      case 'WARNING': return <Clock className="h-4 w-4 text-yellow-600" />;
      default: return <TrendingUp className="h-4 w-4 text-blue-600" />;
    }
  };

  const getSeverityBadge = (type: string) => {
    switch (type) {
      case 'CRITICAL': return <Badge variant="destructive">Critique</Badge>;
      case 'WARNING': return <Badge className="bg-yellow-100 text-yellow-800">Attention</Badge>;
      default: return <Badge className="bg-blue-100 text-blue-800">Info</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Alertes Critiques</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{criticalAlerts.length}</div>
            <p className="text-xs text-muted-foreground">Action immédiate requise</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Alertes d'Attention</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{warningAlerts.length}</div>
            <p className="text-xs text-muted-foreground">Surveillance nécessaire</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Alertes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{alerts.length}</div>
            <p className="text-xs text-muted-foreground">Système de contrôle actif</p>
          </CardContent>
        </Card>
      </div>

      {alerts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Alertes Actives du Système SODATRA</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {alerts.map((alert, index) => (
                <Alert key={index} className={getSeverityColor(alert.type)}>
                  <div className="flex items-start space-x-3">
                    {getSeverityIcon(alert.type)}
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-semibold text-sm">{alert.title}</h4>
                        {getSeverityBadge(alert.type)}
                      </div>
                      <AlertDescription>
                        <div className="space-y-1">
                          <div className="whitespace-pre-line">{alert.description}</div>
                          <p className="text-xs font-medium text-gray-700">
                            🎯 Action recommandée: {alert.action}
                          </p>
                          <p className="text-xs text-gray-500">
                            📏 Déclencheur: {alert.trigger}
                            {alert.value && alert.threshold && (
                              <span> | Valeur: {alert.value.toFixed(1)} / Seuil: {alert.threshold}</span>
                            )}
                          </p>
                        </div>
                      </AlertDescription>
                    </div>
                  </div>
                </Alert>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {alerts.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center">
            <div className="flex flex-col items-center space-y-2">
              <TrendingUp className="h-12 w-12 text-green-500" />
              <h3 className="text-lg font-semibold text-green-700">Système SODATRA Opérationnel</h3>
              <p className="text-gray-600">Aucune alerte détectée - Tous les indicateurs sont dans les seuils normaux</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default AlertsManager;

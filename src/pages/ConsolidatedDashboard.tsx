
import React, { useState, useEffect } from 'react';
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

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const reports = await databaseService.getLatestBankReports();
      const collections = await databaseService.getCollectionReports();
      const fundPosition = await databaseService.getLatestFundPosition();
      
      setBankReports(reports);
      
      if (reports.length > 0) {
        // Calcul des métriques du dashboard
        const metrics = dashboardMetricsService.calculateDashboardMetrics(
          reports,
          collections,
          fundPosition
        );
        setDashboardMetrics(metrics);

        // Analyse consolidée cross-bank
        const analysis = crossBankAnalysisService.analyzeConsolidatedPosition(reports);
        const alerts = crossBankAnalysisService.generateCriticalAlerts(analysis);
        
        setConsolidatedAnalysis({
          consolidatedPosition: analysis,
          consolidatedFacilities: {
            totalLimits: analysis.totalFacilityLimits,
            totalUsed: analysis.totalFacilityUsed,
            totalAvailable: analysis.totalFacilityAvailable,
            utilizationRate: analysis.utilizationRate
          },
          crossBankClients: {
            riskyClients: analysis.crossBankImpayes.map(impaye => ({
              clientCode: impaye.clientCode,
              bankCount: impaye.bankCount,
              banks: impaye.banks.map(b => b.bankName),
              totalRisk: impaye.totalAmount
            }))
          },
          criticalAlerts: alerts
        });
        
        console.log('🏦 Vue consolidée chargée:', analysis);
      }
    } catch (error) {
      console.error('Erreur chargement vue consolidée:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-lg">Chargement de la vue consolidée...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">
          Vue Consolidée Multi-Banques SODATRA
        </h1>
        <div className="text-sm text-gray-500">
          Analyse en temps réel de {bankReports.length} banques • {new Date().toLocaleDateString('fr-FR')}
        </div>
      </div>

      {/* Métriques Consolidées */}
      <ConsolidatedMetrics metrics={dashboardMetrics} />

      {/* Alertes Critiques */}
      {consolidatedAnalysis && (
        <CriticalAlertsPanel 
          criticalAlerts={consolidatedAnalysis.criticalAlerts} 
          crossBankClients={consolidatedAnalysis.crossBankClients}
        />
      )}

      {/* Vue Consolidée Spécialisée */}
      <ConsolidatedBankView 
        bankReports={bankReports} 
        consolidatedAnalysis={consolidatedAnalysis} 
      />

      {/* Graphiques Avancés */}
      <ConsolidatedCharts bankReports={bankReports} />
    </div>
  );
};

export default ConsolidatedDashboard;

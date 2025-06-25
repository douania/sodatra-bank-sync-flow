
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle, AlertTriangle, Clock, FileX, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { databaseService } from '@/services/databaseService';
import { dashboardMetricsService, DashboardMetrics } from '@/services/dashboardMetricsService';
import { crossBankAnalysisService } from '@/services/crossBankAnalysisService';
import { BankReport, FundPosition, CollectionReport } from '@/types/banking';
import ConsolidatedMetrics from '@/components/ConsolidatedMetrics';
import ConsolidatedCharts from '@/components/ConsolidatedCharts';
import CriticalAlertsPanel from '@/components/CriticalAlertsPanel';

const Dashboard = () => {
  const [bankReports, setBankReports] = useState<BankReport[]>([]);
  const [collectionReports, setCollectionReports] = useState<CollectionReport[]>([]);
  const [fundPosition, setFundPosition] = useState<FundPosition | null>(null);
  const [dashboardMetrics, setDashboardMetrics] = useState<DashboardMetrics | null>(null);
  const [consolidatedAnalysis, setConsolidatedAnalysis] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);
      console.log('🔄 Chargement du dashboard consolidé avec données réelles...');
      
      // Test de connexion d'abord
      const isConnected = await databaseService.testConnection();
      if (!isConnected) {
        throw new Error('Impossible de se connecter à la base de données');
      }

      // Récupérer toutes les données en parallèle
      const [reports, collections, position] = await Promise.all([
        databaseService.getLatestBankReports(),
        databaseService.getCollectionReports(),
        databaseService.getLatestFundPosition()
      ]);
      
      console.log(`📊 Données récupérées: ${reports.length} rapports bancaires, ${collections.length} collections, Fund Position: ${position ? 'Oui' : 'Non'}`);
      
      setBankReports(reports);
      setCollectionReports(collections);
      setFundPosition(position);
      
      // Calculer les métriques du dashboard
      const metrics = dashboardMetricsService.calculateDashboardMetrics(reports, collections, position);
      setDashboardMetrics(metrics);
      
      if (reports.length > 0) {
        // Analyse consolidée pour les alertes
        const analysis = crossBankAnalysisService.analyzeConsolidatedPosition(reports);
        const alerts = crossBankAnalysisService.generateCriticalAlerts(analysis);
        
        setConsolidatedAnalysis({
          consolidatedPosition: analysis,
          consolidatedFacilities: {
            totalLimits: metrics.totalFacilities,
            totalUsed: metrics.facilitiesUsed,
            totalAvailable: metrics.facilitiesAvailable,
            utilizationRate: metrics.utilizationRate
          },
          totalImpayes: {
            totalAmount: metrics.totalImpayes,
            totalCount: metrics.impayesCount
          },
          crossBankClients: {
            riskyClients: metrics.topRiskyClients
          },
          criticalAlerts: alerts
        });
        
        console.log('🏦 Analyse consolidée terminée avec données réelles');
      } else {
        console.log('⚠️ Aucune donnée bancaire à analyser');
      }
    } catch (error) {
      console.error('❌ Erreur chargement dashboard:', error);
      setError(error instanceof Error ? error.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  };

  // Fonction pour formater et filtrer les collections récentes
  const getRecentCollections = () => {
    if (!collectionReports || collectionReports.length === 0) return [];
    
    // Trier par date et prendre les plus récentes
    const sortedCollections = [...collectionReports]
      .sort((a, b) => new Date(b.reportDate).getTime() - new Date(a.reportDate).getTime())
      .slice(0, 10); // Prendre plus pour pouvoir filtrer
    
    // Créer un Map pour éviter les doublons basés sur client + montant + date
    const uniqueCollections = new Map();
    
    sortedCollections.forEach(collection => {
      const key = `${collection.clientCode}-${collection.collectionAmount}-${collection.reportDate}`;
      
      // Si on n'a pas encore cette combinaison, ou si cette collection a plus d'infos
      if (!uniqueCollections.has(key) || 
          (!uniqueCollections.get(key).factureNo && collection.factureNo)) {
        uniqueCollections.set(key, collection);
      }
    });
    
    return Array.from(uniqueCollections.values()).slice(0, 5);
  };

  const recentCollections = getRecentCollections();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4" />
          <div className="text-lg">Chargement des données réelles...</div>
          <div className="text-sm text-gray-500 mt-2">Récupération des rapports bancaires et collections</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <Card className="w-96">
          <CardHeader>
            <CardTitle className="text-red-600 flex items-center">
              <AlertTriangle className="h-5 w-5 mr-2" />
              Erreur de chargement
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600 mb-4">{error}</p>
            <Button onClick={loadDashboardData} className="w-full">
              <RefreshCw className="h-4 w-4 mr-2" />
              Réessayer
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (bankReports.length === 0 && collectionReports.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <Card className="w-96">
          <CardHeader>
            <CardTitle className="flex items-center">
              <FileX className="h-5 w-5 mr-2" />
              Aucune donnée disponible
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600 mb-4">
              Aucun rapport bancaire ou collection n'a été trouvé. Veuillez d'abord importer vos fichiers.
            </p>
            <Button onClick={() => window.location.href = '/upload'} className="w-full">
              Importer des fichiers
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Dashboard Consolidé Multi-Banques SODATRA</h1>
        <div className="flex items-center space-x-4">
          <Button variant="outline" onClick={loadDashboardData}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Actualiser
          </Button>
          <div className="text-sm text-gray-500">
            Position consolidée au {new Date().toLocaleDateString('fr-FR')} • 
            {bankReports.length} banques • {collectionReports.length} collections
          </div>
        </div>
      </div>

      {/* KPIs Consolidés avec données réelles */}
      <ConsolidatedMetrics metrics={dashboardMetrics} />

      {/* Alertes Cross-Bank Critiques */}
      {consolidatedAnalysis && (
        <CriticalAlertsPanel 
          criticalAlerts={consolidatedAnalysis.criticalAlerts} 
          crossBankClients={consolidatedAnalysis.crossBankClients}
        />
      )}

      {/* Graphiques Consolidés */}
      <ConsolidatedCharts bankReports={bankReports} />

      {/* Collections récentes améliorées */}
      {recentCollections.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>📋 Collections Récentes (Uniques)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentCollections.map((collection, index) => {
                // Obtenir le nom de banque réel
                const validBankNames = ['BDK', 'BICIS', 'ATB', 'BIS', 'ORA', 'SGS', 'SGBS', 'CBAO', 'ECOBANK', 'UBA'];
                let displayBankName = collection.bankNameDisplay || collection.bankName || 'N/A';
                
                // Si c'est un code numérique, chercher une vraie banque dans les données
                if (/^\d+$/.test(displayBankName) && collection.bankName) {
                  const foundBank = validBankNames.find(bank => 
                    collection.bankName?.toUpperCase().includes(bank)
                  );
                  if (foundBank) displayBankName = foundBank;
                }
                
                return (
                  <div key={`${collection.id}-${index}`} className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-blue-600">{collection.clientCode}</span>
                        <span className="text-gray-400">•</span>
                        <span className="text-sm text-gray-600">{displayBankName}</span>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {collection.factureNo ? `Facture: ${collection.factureNo}` : 'Facture non spécifiée'}
                        {collection.noChqBd && ` • Chèque/BD: ${collection.noChqBd}`}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-green-600">
                        {(collection.collectionAmount / 1000000).toFixed(2)}M FCFA
                      </div>
                      <div className="text-xs text-gray-500">
                        {new Date(collection.reportDate).toLocaleDateString('fr-FR')}
                      </div>
                      {collection.dateOfValidity && (
                        <div className="text-xs text-blue-500">
                          Validité: {new Date(collection.dateOfValidity).toLocaleDateString('fr-FR')}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Statut Détaillé par Banque avec données réelles */}
      <Card>
        <CardHeader>
          <CardTitle>🏦 Position Détaillée par Banque (Données Réelles)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {bankReports.map((report, index) => {
              const variation = report.closingBalance - report.openingBalance;
              const variationPercent = report.openingBalance > 0 ? (variation / report.openingBalance) * 100 : 0;
              const hasImpayes = report.impayes.length > 0;
              const hasCriticalMovement = Math.abs(variation) > 50000000; // >50M
              const status = hasImpayes || hasCriticalMovement ? 'error' : Math.abs(variationPercent) > 10 ? 'warning' : 'success';
              
              const totalFacilityLimit = report.bankFacilities.reduce((sum, f) => sum + f.limitAmount, 0);
              const totalFacilityUsed = report.bankFacilities.reduce((sum, f) => sum + f.usedAmount, 0);
              const facilityRate = totalFacilityLimit > 0 ? (totalFacilityUsed / totalFacilityLimit) * 100 : 0;
              
              return (
                <div key={index} className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                  <div className="flex items-center space-x-3">
                    <div className={`w-3 h-3 rounded-full ${
                      status === 'success' ? 'bg-green-500' :
                      status === 'warning' ? 'bg-yellow-500' : 'bg-red-500'
                    }`} />
                    <div>
                      <span className="font-medium text-lg">{report.bank}</span>
                      <div className="text-xs text-gray-500">
                        💳 Facilités: {facilityRate.toFixed(1)}% utilisé 
                        ({(totalFacilityUsed / 1000000).toFixed(0)}M / {(totalFacilityLimit / 1000000).toFixed(0)}M)
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-medium">
                      {(report.closingBalance / 1000000).toFixed(1)}M FCFA
                    </div>
                    <div className="text-xs text-gray-500">
                      {variation >= 0 ? '+' : ''}{(variation / 1000000).toFixed(1)}M ({variationPercent.toFixed(1)}%)
                    </div>
                    {hasImpayes && (
                      <div className="text-xs text-red-600">
                        ❌ {report.impayes.length} impayé(s) - {(report.impayes.reduce((sum, i) => sum + i.montant, 0) / 1000000).toFixed(1)}M
                      </div>
                    )}
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

export default Dashboard;

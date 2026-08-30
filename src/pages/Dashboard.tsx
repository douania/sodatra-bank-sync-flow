
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle, AlertTriangle, Clock, FileX, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { databaseService } from '@/services/databaseService';
import { dashboardMetricsService, DashboardMetrics } from '@/services/dashboardMetricsService';
import { crossBankAnalysisService } from '@/services/crossBankAnalysisService';
import { BankReport, FundPosition, CollectionReport } from '@/types/banking';
import ConsolidatedMetrics from '@/components/ConsolidatedMetrics';
import ConsolidatedCharts from '@/components/ConsolidatedCharts';
import CriticalAlertsPanel from '@/components/CriticalAlertsPanel';
import DailyV2OperationalDashboard from '@/features/daily-v2/dashboard/DailyV2OperationalDashboard';

const LegacyDashboard = () => {
  const [bankReports, setBankReports] = useState<BankReport[]>([]);
  const [collectionReports, setCollectionReports] = useState<CollectionReport[]>([]);
  const [fundPosition, setFundPosition] = useState<FundPosition | null>(null);
  const [dashboardMetrics, setDashboardMetrics] = useState<DashboardMetrics | null>(null);
  const [consolidatedAnalysis, setConsolidatedAnalysis] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showZeroPositions, setShowZeroPositions] = useState(() => {
    return localStorage.getItem('dashboard-show-zero-positions') === 'true';
  });

  useEffect(() => {
    loadDashboardData();
  }, []);

  useEffect(() => {
    localStorage.setItem('dashboard-show-zero-positions', showZeroPositions.toString());
  }, [showZeroPositions]);

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
      
      // ⭐ AMÉLIORATION: Ne plus filtrer complètement les rapports à zéro
      const processedBankReports = reports.filter((report, index, self) => {
        // Garder seulement le premier rapport par banque (le plus récent)
        return index === self.findIndex(r => r.bank === report.bank);
      });
      
      console.log(`🔧 Rapports dédoublonnés: ${reports.length} → ${processedBankReports.length}`);
      
      setBankReports(processedBankReports);
      setCollectionReports(collections);
      setFundPosition(position);
      
      // Calculer les métriques du dashboard avec tous les rapports
      const metrics = dashboardMetricsService.calculateDashboardMetrics(processedBankReports, collections, position);
      setDashboardMetrics(metrics);
      
      if (processedBankReports.length > 0) {
        // Analyse consolidée pour les alertes
        const analysis = crossBankAnalysisService.analyzeConsolidatedPosition(processedBankReports);
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

  // ⭐ NOUVELLE FONCTION: Filtrer les rapports bancaires selon les préférences utilisateur
  const getFilteredBankReports = () => {
    if (showZeroPositions) {
      return bankReports;
    }
    
    // Filtrer seulement les rapports avec activité significative
    return bankReports.filter(report => {
      return report.openingBalance !== 0 || 
             report.closingBalance !== 0 || 
             report.bankFacilities.length > 0 || 
             report.impayes.length > 0;
    });
  };

  // ⭐ NOUVELLE FONCTION: Déterminer le type de position bancaire
  const getBankPositionType = (report: BankReport) => {
    const hasActivity = report.openingBalance !== 0 || 
                       report.closingBalance !== 0 || 
                       report.bankFacilities.length > 0 || 
                       report.impayes.length > 0;
    
    if (!hasActivity) return 'zero';
    if (report.closingBalance === 0 && report.openingBalance === 0) return 'balanced';
    return 'active';
  };

  const recentCollections = getRecentCollections();
  const filteredBankReports = getFilteredBankReports();

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
        <h2 className="text-2xl font-bold text-gray-900">Indicateurs historiques SODATRA</h2>
        <div className="flex items-center space-x-4">
          <Button variant="outline" onClick={loadDashboardData} className="bg-blue-50 hover:bg-blue-100 border-blue-200">
            <RefreshCw className="h-4 w-4 mr-2" />
            Actualiser
          </Button>
          <div className="text-sm text-gray-500">
            Consultation du {new Date().toLocaleDateString('fr-FR')} (pas la date des relevés) •
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

      {/* ⭐ STATUT DÉTAILLÉ PAR BANQUE AMÉLIORÉ */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>🏦 Position Détaillée par Banque (Données Réelles)</CardTitle>
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-2">
                <Switch
                  id="show-zero-positions"
                  checked={showZeroPositions}
                  onCheckedChange={setShowZeroPositions}
                />
                <label 
                  htmlFor="show-zero-positions" 
                  className="text-sm text-gray-600 cursor-pointer flex items-center gap-1"
                >
                  {showZeroPositions ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  Afficher positions à zéro
                </label>
              </div>
              <div className="text-xs text-gray-500">
                {filteredBankReports.length} / {bankReports.length} banques affichées
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {filteredBankReports.length === 0 ? (
              <div className="text-center text-gray-500 py-8">
                <div className="mb-2">
                  {bankReports.length === 0 
                    ? "Aucune donnée bancaire trouvée" 
                    : "Toutes les positions sont à zéro"
                  }
                </div>
                {bankReports.length > 0 && (
                  <div className="text-sm">
                    Activez l'option "Afficher positions à zéro" pour voir toutes les banques
                  </div>
                )}
              </div>
            ) : (
              filteredBankReports.map((report, index) => {
                const variation = report.closingBalance - report.openingBalance;
                const variationPercent = report.openingBalance > 0 ? (variation / report.openingBalance) * 100 : 0;
                const hasImpayes = report.impayes.length > 0;
                const hasCriticalMovement = Math.abs(variation) > 50000000; // >50M
                const positionType = getBankPositionType(report);
                
                // ⭐ LOGIQUE DE STATUT AMÉLIORÉE
                let status: 'success' | 'warning' | 'error' = 'success';
                let statusLabel = '';
                
                if (hasImpayes) {
                  status = 'error';
                  statusLabel = 'Impayés détectés';
                } else if (hasCriticalMovement) {
                  status = 'warning';
                  statusLabel = 'Mouvement important';
                } else if (positionType === 'zero') {
                  status = 'success';
                  statusLabel = 'Position nulle';
                } else if (positionType === 'balanced') {
                  status = 'success';
                  statusLabel = 'Position équilibrée';
                } else if (Math.abs(variationPercent) > 10) {
                  status = 'warning';
                  statusLabel = 'Variation significative';
                } else {
                  status = 'success';
                  statusLabel = 'Position normale';
                }
                
                const totalFacilityLimit = report.bankFacilities.reduce((sum, f) => sum + f.limitAmount, 0);
                const totalFacilityUsed = report.bankFacilities.reduce((sum, f) => sum + f.usedAmount, 0);
                const facilityRate = totalFacilityLimit > 0 ? (totalFacilityUsed / totalFacilityLimit) * 100 : 0;
                
                return (
                  <div key={`${report.bank}-${index}`} className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                    <div className="flex items-center space-x-3">
                      <div className={`w-3 h-3 rounded-full ${
                        status === 'success' ? 'bg-green-500' :
                        status === 'warning' ? 'bg-yellow-500' : 'bg-red-500'
                      }`} />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-lg">{report.bank}</span>
                          <span className={`text-xs px-2 py-1 rounded-full ${
                            positionType === 'zero' ? 'bg-gray-100 text-gray-600' :
                            positionType === 'balanced' ? 'bg-blue-100 text-blue-600' :
                            'bg-green-100 text-green-600'
                          }`}>
                            {statusLabel}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500">
                          {totalFacilityLimit > 0 ? (
                            <>💳 Facilités: {facilityRate.toFixed(1)}% utilisé 
                            ({(totalFacilityUsed / 1000000).toFixed(0)}M / {(totalFacilityLimit / 1000000).toFixed(0)}M)</>
                          ) : (
                            <>💳 Aucune facilité configurée</>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-lg font-medium ${
                        positionType === 'zero' ? 'text-gray-500' :
                        report.closingBalance >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {(report.closingBalance / 1000000).toFixed(1)}M FCFA
                      </div>
                      {positionType !== 'zero' && (
                        <div className="text-xs text-gray-500">
                          {variation >= 0 ? '+' : ''}{(variation / 1000000).toFixed(1)}M ({variationPercent.toFixed(1)}%)
                        </div>
                      )}
                      {hasImpayes && (
                        <div className="text-xs text-red-600">
                          ❌ {report.impayes.length} impayé(s) - {(report.impayes.reduce((sum, i) => sum + i.montant, 0) / 1000000).toFixed(1)}M
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

const Dashboard = () => {
  const [source, setSource] = useState<'canonical' | 'legacy'>('canonical');
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Dashboard SODATRA</h1>
      <div className="flex flex-wrap gap-3" aria-label="Source des indicateurs">
        <Button variant={source === 'canonical' ? 'default' : 'outline'} aria-pressed={source === 'canonical'} onClick={() => setSource('canonical')}>Daily v2 — relevés validés</Button>
        <Button variant={source === 'legacy' ? 'default' : 'outline'} aria-pressed={source === 'legacy'} onClick={() => setSource('legacy')}>Sources historiques — vue séparée</Button>
      </div>
      {source === 'canonical' ? <DailyV2OperationalDashboard /> : (
        <section aria-label="Indicateurs historiques" className="space-y-4">
          <p className="rounded border border-amber-200 bg-amber-50 p-4 text-sm">Sources historiques : rapports bancaires, Collection Report et Fund Position. Ces indicateurs ne sont ni complétés ni additionnés aux données Daily v2. Leur couverture et leurs règles de calcul restent distinctes.</p>
          <LegacyDashboard />
        </section>
      )}
    </div>
  );
};

export default Dashboard;


import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle, AlertTriangle, Clock, FileX } from 'lucide-react';
import { databaseService } from '@/services/databaseService';
import { crossBankAnalysisService } from '@/services/crossBankAnalysisService';
import { BankReport, FundPosition } from '@/types/banking';
import ConsolidatedMetrics from '@/components/ConsolidatedMetrics';
import ConsolidatedCharts from '@/components/ConsolidatedCharts';
import CriticalAlertsPanel from '@/components/CriticalAlertsPanel';

const Dashboard = () => {
  const [bankReports, setBankReports] = useState<BankReport[]>([]);
  const [fundPosition, setFundPosition] = useState<FundPosition | null>(null);
  const [consolidatedAnalysis, setConsolidatedAnalysis] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      const [reports, position] = await Promise.all([
        databaseService.getLatestBankReports(),
        databaseService.getLatestFundPosition()
      ]);
      
      setBankReports(reports);
      setFundPosition(position);
      
      if (reports.length > 0) {
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
          totalImpayes: {
            totalAmount: analysis.totalImpayes,
            totalCount: analysis.impayeCount
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
        
        console.log('🏦 Analyse consolidée:', analysis);
      }
    } catch (error) {
      console.error('Erreur chargement dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-lg">Chargement du dashboard consolidé...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Dashboard Consolidé Multi-Banques SODATRA</h1>
        <div className="text-sm text-gray-500">
          Position consolidée au {new Date().toLocaleDateString('fr-FR')} • {bankReports.length} banques surveillées
        </div>
      </div>

      {/* KPIs Consolidés Critiques */}
      <ConsolidatedMetrics consolidatedAnalysis={consolidatedAnalysis} />

      {/* Alertes Cross-Bank Critiques */}
      {consolidatedAnalysis && (
        <CriticalAlertsPanel 
          criticalAlerts={consolidatedAnalysis.criticalAlerts} 
          crossBankClients={consolidatedAnalysis.crossBankClients}
        />
      )}

      {/* Graphiques Consolidés */}
      <ConsolidatedCharts bankReports={bankReports} />

      {/* Statut Détaillé par Banque */}
      <Card>
        <CardHeader>
          <CardTitle>🏦 Position Détaillée par Banque</CardTitle>
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
                    {report.checksNotCleared && report.checksNotCleared.length > 0 && (
                      <div className="text-xs text-orange-600">
                        📝 {report.checksNotCleared.length} chèque(s) non débité(s)
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

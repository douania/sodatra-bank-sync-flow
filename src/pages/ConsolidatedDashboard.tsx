
import React, { useState, useEffect } from 'react';
import { databaseService } from '@/services/databaseService';
import { crossBankAnalysisService } from '@/services/crossBankAnalysisService';
import { BankReport } from '@/types/banking';
import ConsolidatedBankView from '@/components/ConsolidatedBankView';

const ConsolidatedDashboard = () => {
  const [bankReports, setBankReports] = useState<BankReport[]>([]);
  const [consolidatedAnalysis, setConsolidatedAnalysis] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const reports = await databaseService.getLatestBankReports();
      setBankReports(reports);
      
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
          Analyse en temps réel de {bankReports.length} banques
        </div>
      </div>

      <ConsolidatedBankView 
        bankReports={bankReports} 
        consolidatedAnalysis={consolidatedAnalysis} 
      />
    </div>
  );
};

export default ConsolidatedDashboard;

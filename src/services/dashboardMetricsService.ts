
import { BankReport, CollectionReport, FundPosition } from '@/types/banking';
import { crossBankAnalysisService } from './crossBankAnalysisService';

export interface DashboardMetrics {
  totalBanks: number;
  totalBalance: number;
  totalMovement: number;
  movementPercentage: number;
  totalImpayes: number;
  impayesCount: number;
  totalFacilities: number;
  facilitiesUsed: number;
  facilitiesAvailable: number;
  utilizationRate: number;
  criticalMovements: Array<{
    bank: string;
    movement: number;
    percentage: number;
  }>;
  topRiskyClients: Array<{
    clientCode: string;
    totalRisk: number;
    bankCount: number;
    banks: string[];
  }>;
}

export class DashboardMetricsService {
  
  calculateDashboardMetrics(
    bankReports: BankReport[], 
    collectionReports: CollectionReport[],
    fundPosition: FundPosition | null
  ): DashboardMetrics {
    console.log('📊 Calcul des métriques du dashboard...');
    
    // Métriques bancaires de base
    const totalBanks = bankReports.length;
    const totalBalance = bankReports.reduce((sum, report) => sum + report.closingBalance, 0);
    const totalOpeningBalance = bankReports.reduce((sum, report) => sum + report.openingBalance, 0);
    const totalMovement = totalBalance - totalOpeningBalance;
    const movementPercentage = totalOpeningBalance > 0 ? (totalMovement / totalOpeningBalance) * 100 : 0;

    // Métriques des impayés
    const allImpayes = bankReports.flatMap(report => report.impayes);
    const totalImpayes = allImpayes.reduce((sum, impaye) => sum + impaye.montant, 0);
    const impayesCount = allImpayes.length;

    // Métriques des facilités
    const allFacilities = bankReports.flatMap(report => report.bankFacilities);
    const totalFacilities = allFacilities.reduce((sum, facility) => sum + facility.limitAmount, 0);
    const facilitiesUsed = allFacilities.reduce((sum, facility) => sum + facility.usedAmount, 0);
    const facilitiesAvailable = totalFacilities - facilitiesUsed;
    const utilizationRate = totalFacilities > 0 ? (facilitiesUsed / totalFacilities) * 100 : 0;

    // Mouvements critiques (variation > 10% ou > 50M)
    const criticalMovements = bankReports
      .map(report => {
        const movement = report.closingBalance - report.openingBalance;
        const percentage = report.openingBalance > 0 ? (movement / report.openingBalance) * 100 : 0;
        return {
          bank: report.bank,
          movement,
          percentage: Math.abs(percentage)
        };
      })
      .filter(item => Math.abs(item.percentage) > 10 || Math.abs(item.movement) > 50000000)
      .sort((a, b) => Math.abs(b.movement) - Math.abs(a.movement));

    // ⭐ UTILISER L'ANALYSE CROSS-BANK AMÉLIORÉE
    const topRiskyClients = crossBankAnalysisService.analyzeCollectionsForCrossBankRisk(collectionReports);

    const metrics: DashboardMetrics = {
      totalBanks,
      totalBalance,
      totalMovement,
      movementPercentage,
      totalImpayes,
      impayesCount,
      totalFacilities,
      facilitiesUsed,
      facilitiesAvailable,
      utilizationRate,
      criticalMovements,
      topRiskyClients
    };

    console.log('✅ Métriques calculées:', {
      totalBanks,
      totalBalance: (totalBalance / 1000000).toFixed(1) + 'M',
      totalImpayes: (totalImpayes / 1000000).toFixed(1) + 'M',
      criticalMovements: criticalMovements.length,
      topRiskyClients: topRiskyClients.length
    });

    return metrics;
  }

  formatCurrency(amount: number): string {
    if (amount >= 1000000000) {
      return `${(amount / 1000000000).toFixed(1)}Md`;
    } else if (amount >= 1000000) {
      return `${(amount / 1000000).toFixed(1)}M`;
    } else if (amount >= 1000) {
      return `${(amount / 1000).toFixed(1)}k`;
    }
    return amount.toString();
  }

  getStatusColor(value: number, thresholds: { warning: number; critical: number }): 'success' | 'warning' | 'error' {
    if (value >= thresholds.critical) return 'error';
    if (value >= thresholds.warning) return 'warning';
    return 'success';
  }
}

export const dashboardMetricsService = new DashboardMetricsService();

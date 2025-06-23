
import { BankReport, ClientReconciliation } from '@/types/banking';

export interface CrossBankImpaye {
  clientCode: string;
  clientName?: string;
  totalAmount: number;
  bankCount: number;
  banks: Array<{
    bankName: string;
    amount: number;
    dateEcheance: string;
    description?: string;
  }>;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface ConsolidatedPosition {
  date: string;
  totalOpeningBalance: number;
  totalClosingBalance: number;
  netMovement: number;
  movementPercentage: number;
  bankCount: number;
  
  // Facilités consolidées
  totalFacilityLimits: number;
  totalFacilityUsed: number;
  totalFacilityAvailable: number;
  utilizationRate: number;
  
  // Impayés consolidés
  totalImpayes: number;
  impayeCount: number;
  crossBankImpayes: CrossBankImpaye[];
  
  // Analyse par banque
  bankAnalysis: Array<{
    bank: string;
    openingBalance: number;
    closingBalance: number;
    movement: number;
    movementPercentage: number;
    facilityUtilization: number;
    impayesAmount: number;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  }>;
}

export interface CriticalAlert {
  id: string;
  type: 'CRITICAL_VARIANCE' | 'CROSS_BANK_RISK' | 'FACILITY_OVERUSE' | 'LARGE_MOVEMENT';
  title: string;
  description: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  bankName?: string;
  clientCode?: string;
  amount?: number;
  threshold?: number;
  action: string;
  createdAt: string;
}

export class CrossBankAnalysisService {
  
  // Analyse consolidée de tous les rapports bancaires
  analyzeConsolidatedPosition(bankReports: BankReport[]): ConsolidatedPosition {
    console.log(`🔍 Analyse consolidée de ${bankReports.length} banques`);
    
    const totalOpeningBalance = bankReports.reduce((sum, report) => sum + report.openingBalance, 0);
    const totalClosingBalance = bankReports.reduce((sum, report) => sum + report.closingBalance, 0);
    const netMovement = totalClosingBalance - totalOpeningBalance;
    const movementPercentage = totalOpeningBalance > 0 ? (netMovement / totalOpeningBalance) * 100 : 0;
    
    // Consolidation des facilités
    const facilityAnalysis = this.analyzeFacilities(bankReports);
    
    // Consolidation des impayés
    const impayeAnalysis = this.analyzeImpayes(bankReports);
    
    // Analyse par banque
    const bankAnalysis = bankReports.map(report => this.analyzeSingleBank(report));
    
    const consolidatedPosition: ConsolidatedPosition = {
      date: bankReports[0]?.date || new Date().toLocaleDateString('fr-FR'),
      totalOpeningBalance,
      totalClosingBalance,
      netMovement,
      movementPercentage,
      bankCount: bankReports.length,
      
      totalFacilityLimits: facilityAnalysis.totalLimits,
      totalFacilityUsed: facilityAnalysis.totalUsed,
      totalFacilityAvailable: facilityAnalysis.totalAvailable,
      utilizationRate: facilityAnalysis.utilizationRate,
      
      totalImpayes: impayeAnalysis.totalAmount,
      impayeCount: impayeAnalysis.totalCount,
      crossBankImpayes: impayeAnalysis.crossBankImpayes,
      
      bankAnalysis
    };
    
    console.log(`📊 Position consolidée: ${(totalClosingBalance / 1000000).toFixed(1)}M FCFA`);
    console.log(`💳 Facilités: ${facilityAnalysis.utilizationRate.toFixed(1)}% utilisées`);
    console.log(`❌ Impayés: ${impayeAnalysis.crossBankImpayes.length} clients cross-bank`);
    
    return consolidatedPosition;
  }
  
  // Détection des impayés cross-bank
  private analyzeImpayes(bankReports: BankReport[]) {
    const clientImpayes = new Map<string, CrossBankImpaye>();
    let totalAmount = 0;
    let totalCount = 0;
    
    // Collecter tous les impayés par client
    bankReports.forEach(report => {
      report.impayes.forEach(impaye => {
        totalAmount += impaye.montant;
        totalCount++;
        
        const key = impaye.clientCode.toUpperCase();
        
        if (!clientImpayes.has(key)) {
          clientImpayes.set(key, {
            clientCode: key,
            totalAmount: 0,
            bankCount: 0,
            banks: [],
            riskLevel: 'LOW'
          });
        }
        
        const client = clientImpayes.get(key)!;
        client.totalAmount += impaye.montant;
        client.banks.push({
          bankName: report.bank,
          amount: impaye.montant,
          dateEcheance: impaye.dateEcheance,
          description: impaye.description
        });
      });
    });
    
    // Identifier les clients cross-bank et calculer le risque
    const crossBankImpayes: CrossBankImpaye[] = [];
    
    clientImpayes.forEach(client => {
      const uniqueBanks = new Set(client.banks.map(b => b.bankName));
      client.bankCount = uniqueBanks.size;
      
      // Calcul du niveau de risque
      if (client.totalAmount > 50_000_000) {
        client.riskLevel = 'CRITICAL';
      } else if (client.totalAmount > 20_000_000 || client.bankCount > 2) {
        client.riskLevel = 'HIGH';
      } else if (client.totalAmount > 10_000_000 || client.bankCount > 1) {
        client.riskLevel = 'MEDIUM';
      }
      
      // Ajouter aux cross-bank si présent sur plusieurs banques
      if (client.bankCount > 1) {
        crossBankImpayes.push(client);
      }
    });
    
    // Trier par montant décroissant
    crossBankImpayes.sort((a, b) => b.totalAmount - a.totalAmount);
    
    return {
      totalAmount,
      totalCount,
      crossBankImpayes
    };
  }
  
  // Analyse des facilités consolidées
  private analyzeFacilities(bankReports: BankReport[]) {
    let totalLimits = 0;
    let totalUsed = 0;
    
    bankReports.forEach(report => {
      report.bankFacilities.forEach(facility => {
        totalLimits += facility.limitAmount;
        totalUsed += facility.usedAmount;
      });
    });
    
    const totalAvailable = totalLimits - totalUsed;
    const utilizationRate = totalLimits > 0 ? (totalUsed / totalLimits) * 100 : 0;
    
    return {
      totalLimits,
      totalUsed,
      totalAvailable,
      utilizationRate
    };
  }
  
  // Analyse d'une banque individuelle
  private analyzeSingleBank(report: BankReport) {
    const movement = report.closingBalance - report.openingBalance;
    const movementPercentage = report.openingBalance > 0 ? (movement / report.openingBalance) * 100 : 0;
    
    // Calcul de l'utilisation des facilités
    const totalFacilityLimits = report.bankFacilities.reduce((sum, f) => sum + f.limitAmount, 0);
    const totalFacilityUsed = report.bankFacilities.reduce((sum, f) => sum + f.usedAmount, 0);
    const facilityUtilization = totalFacilityLimits > 0 ? (totalFacilityUsed / totalFacilityLimits) * 100 : 0;
    
    // Calcul des impayés
    const impayesAmount = report.impayes.reduce((sum, i) => sum + i.montant, 0);
    
    // Calcul du niveau de risque
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
    
    if (Math.abs(movementPercentage) > 50 || facilityUtilization > 80 || impayesAmount > 30_000_000) {
      riskLevel = 'CRITICAL';
    } else if (Math.abs(movementPercentage) > 20 || facilityUtilization > 60 || impayesAmount > 15_000_000) {
      riskLevel = 'HIGH';
    } else if (Math.abs(movementPercentage) > 10 || facilityUtilization > 40 || impayesAmount > 5_000_000) {
      riskLevel = 'MEDIUM';
    }
    
    return {
      bank: report.bank,
      openingBalance: report.openingBalance,
      closingBalance: report.closingBalance,
      movement,
      movementPercentage,
      facilityUtilization,
      impayesAmount,
      riskLevel
    };
  }
  
  // Génération d'alertes critiques
  generateCriticalAlerts(consolidatedPosition: ConsolidatedPosition): CriticalAlert[] {
    const alerts: CriticalAlert[] = [];
    const now = new Date().toISOString();
    
    // Alerte variance critique globale
    if (Math.abs(consolidatedPosition.movementPercentage) > 10) {
      alerts.push({
        id: `variance-global-${Date.now()}`,
        type: 'CRITICAL_VARIANCE',
        title: 'Variance Critique Position Globale',
        description: `Mouvement de ${consolidatedPosition.movementPercentage.toFixed(1)}% sur la position totale (${(consolidatedPosition.netMovement / 1000000).toFixed(1)}M FCFA)`,
        severity: Math.abs(consolidatedPosition.movementPercentage) > 20 ? 'CRITICAL' : 'HIGH',
        amount: consolidatedPosition.netMovement,
        threshold: consolidatedPosition.totalOpeningBalance * 0.1,
        action: 'Vérification immédiate des mouvements bancaires',
        createdAt: now
      });
    }
    
    // Alertes clients cross-bank
    consolidatedPosition.crossBankImpayes.forEach(client => {
      if (client.riskLevel === 'CRITICAL' || client.riskLevel === 'HIGH') {
        alerts.push({
          id: `crossbank-${client.clientCode}-${Date.now()}`,
          type: 'CROSS_BANK_RISK',
          title: 'Client Multi-Banques à Risque',
          description: `Client ${client.clientCode} avec ${(client.totalAmount / 1000000).toFixed(1)}M FCFA d'impayés sur ${client.bankCount} banques`,
          severity: client.riskLevel === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
          clientCode: client.clientCode,
          amount: client.totalAmount,
          action: 'Révision urgente du dossier client et limitation exposition',
          createdAt: now
        });
      }
    });
    
    // Alertes par banque
    consolidatedPosition.bankAnalysis.forEach(bank => {
      if (Math.abs(bank.movementPercentage) > 30) {
        alerts.push({
          id: `bank-variance-${bank.bank}-${Date.now()}`,
          type: 'LARGE_MOVEMENT',
          title: `Mouvement Critique ${bank.bank}`,
          description: `Variation de ${bank.movementPercentage.toFixed(1)}% (${(bank.movement / 1000000).toFixed(1)}M FCFA)`,
          severity: Math.abs(bank.movementPercentage) > 50 ? 'CRITICAL' : 'HIGH',
          bankName: bank.bank,
          amount: bank.movement,
          action: 'Vérification immédiate avec la banque',
          createdAt: now
        });
      }
      
      if (bank.facilityUtilization > 80) {
        alerts.push({
          id: `facility-${bank.bank}-${Date.now()}`,
          type: 'FACILITY_OVERUSE',
          title: `Facilité Saturée ${bank.bank}`,
          description: `Utilisation à ${bank.facilityUtilization.toFixed(1)}%`,
          severity: bank.facilityUtilization > 90 ? 'CRITICAL' : 'HIGH',
          bankName: bank.bank,
          threshold: 80,
          action: 'Négocier augmentation ou réduire exposition',
          createdAt: now
        });
      }
    });
    
    return alerts.sort((a, b) => {
      const severityOrder = { 'CRITICAL': 4, 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1 };
      return severityOrder[b.severity] - severityOrder[a.severity];
    });
  }
}

export const crossBankAnalysisService = new CrossBankAnalysisService();

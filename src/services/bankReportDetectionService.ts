
import { BankReport, BankFacility, Impaye, DepositNotCleared } from '@/types/banking';

export interface BankReportDetectionResult {
  success: boolean;
  bankType?: string;
  data?: BankReport;
  errors?: string[];
  confidence?: number;
}

export interface BankFormatConfig {
  bankName: string;
  identifiers: string[]; // Mots-clés pour identifier le rapport
  headerMappings: { [key: string]: string };
  dateFormats: string[];
  amountColumns: string[];
  facilityIndicators: string[];
  impayeIndicators: string[];
}

class BankReportDetectionService {
  private bankConfigs: BankFormatConfig[] = [
    {
      bankName: 'BDK',
      identifiers: ['BDK', 'Banque de Dakar', 'RAPPORT BDK', 'POSITION BDK'],
      headerMappings: {
        'Solde Ouverture': 'openingBalance',
        'Solde Clôture': 'closingBalance',
        'Solde Initial': 'openingBalance',
        'Solde Final': 'closingBalance',
        'Date': 'date',
        'Facilité': 'facility',
        'Limite': 'limitAmount',
        'Utilisé': 'usedAmount',
        'Disponible': 'availableAmount'
      },
      dateFormats: ['DD/MM/YYYY', 'YYYY-MM-DD'],
      amountColumns: ['Montant', 'Amount', 'Solde', 'Balance'],
      facilityIndicators: ['Facilité', 'Crédit', 'Limite', 'Découvert'],
      impayeIndicators: ['Impayé', 'Rejeté', 'Retour', 'Incident']
    },
    {
      bankName: 'ATB',
      identifiers: ['ATB', 'Arab Tunisian Bank', 'RAPPORT ATB', 'POSITION ATB'],
      headerMappings: {
        'Opening Balance': 'openingBalance',
        'Closing Balance': 'closingBalance',
        'Solde Début': 'openingBalance',
        'Solde Fin': 'closingBalance',
        'Date': 'date'
      },
      dateFormats: ['DD/MM/YYYY', 'MM/DD/YYYY'],
      amountColumns: ['Amount', 'Montant', 'Balance', 'Solde'],
      facilityIndicators: ['Facility', 'Credit Line', 'Overdraft'],
      impayeIndicators: ['Unpaid', 'Returned', 'Rejected']
    },
    {
      bankName: 'BICIS',
      identifiers: ['BICIS', 'BIC', 'RAPPORT BICIS', 'POSITION BICIS'],
      headerMappings: {
        'Solde Initial': 'openingBalance',
        'Solde Final': 'closingBalance',
        'Date Rapport': 'date',
        'Type Facilité': 'facilityType',
        'Montant Limite': 'limitAmount'
      },
      dateFormats: ['DD/MM/YYYY'],
      amountColumns: ['Montant', 'Solde', 'Amount'],
      facilityIndicators: ['Facilité', 'Crédit', 'Ligne'],
      impayeIndicators: ['Impayé', 'Retour', 'Incident']
    },
    {
      bankName: 'ORA',
      identifiers: ['ORA', 'Orabank', 'RAPPORT ORA', 'POSITION ORA'],
      headerMappings: {
        'Balance Opening': 'openingBalance',
        'Balance Closing': 'closingBalance',
        'Report Date': 'date'
      },
      dateFormats: ['YYYY-MM-DD', 'DD-MM-YYYY'],
      amountColumns: ['Balance', 'Amount', 'Montant'],
      facilityIndicators: ['Credit', 'Facility', 'Line'],
      impayeIndicators: ['Unpaid', 'Bounced', 'Returned']
    },
    {
      bankName: 'SGBS',
      identifiers: ['SGBS', 'Société Générale', 'SG', 'RAPPORT SGBS'],
      headerMappings: {
        'Solde Ouverture': 'openingBalance',
        'Solde Fermeture': 'closingBalance',
        'Date Position': 'date'
      },
      dateFormats: ['DD/MM/YYYY'],
      amountColumns: ['Solde', 'Montant', 'Amount'],
      facilityIndicators: ['Facilité', 'Crédit', 'Découvert'],
      impayeIndicators: ['Impayé', 'Rejeté', 'Incident']
    },
    {
      bankName: 'BIS',
      identifiers: ['BIS', 'Banque Islamique', 'RAPPORT BIS', 'POSITION BIS'],
      headerMappings: {
        'Opening Balance': 'openingBalance',
        'Closing Balance': 'closingBalance',
        'Position Date': 'date'
      },
      dateFormats: ['DD/MM/YYYY', 'YYYY-MM-DD'],
      amountColumns: ['Balance', 'Montant', 'Amount'],
      facilityIndicators: ['Facility', 'Credit', 'Financing'],
      impayeIndicators: ['Unpaid', 'Defaulted', 'Overdue']
    }
  ];

  async detectBankReportType(rawData: any[], filename: string): Promise<BankReportDetectionResult> {
    console.log('🔍 Détection du type de rapport bancaire pour:', filename);
    
    if (!rawData || rawData.length < 2) {
      return {
        success: false,
        errors: ['Données insuffisantes pour la détection']
      };
    }

    // Convertir les données en texte pour l'analyse
    const dataText = rawData.flat().join(' ').toUpperCase();
    const filenameUpper = filename.toUpperCase();
    
    let bestMatch: { config: BankFormatConfig; confidence: number } | null = null;

    // Tester chaque configuration de banque
    for (const config of this.bankConfigs) {
      let confidence = 0;
      
      // Vérifier les identifiants dans le nom de fichier
      for (const identifier of config.identifiers) {
        if (filenameUpper.includes(identifier.toUpperCase())) {
          confidence += 30;
        }
      }
      
      // Vérifier les identifiants dans le contenu
      for (const identifier of config.identifiers) {
        if (dataText.includes(identifier.toUpperCase())) {
          confidence += 20;
        }
      }
      
      // Vérifier la présence de mappings spécifiques
      for (const header of Object.keys(config.headerMappings)) {
        if (dataText.includes(header.toUpperCase())) {
          confidence += 10;
        }
      }
      
      console.log(`📊 Confiance ${config.bankName}: ${confidence}%`);
      
      if (confidence > 0 && (!bestMatch || confidence > bestMatch.confidence)) {
        bestMatch = { config, confidence };
      }
    }

    if (!bestMatch || bestMatch.confidence < 30) {
      return {
        success: false,
        errors: ['Type de rapport bancaire non reconnu'],
        confidence: bestMatch?.confidence || 0
      };
    }

    console.log(`✅ Rapport détecté: ${bestMatch.config.bankName} (confiance: ${bestMatch.confidence}%)`);

    // Extraire les données bancaires
    try {
      const bankReport = await this.extractBankReportData(rawData, bestMatch.config);
      
      return {
        success: true,
        bankType: bestMatch.config.bankName,
        data: bankReport,
        confidence: bestMatch.confidence
      };
    } catch (error) {
      console.error('❌ Erreur extraction données bancaires:', error);
      return {
        success: false,
        errors: [`Erreur extraction: ${error instanceof Error ? error.message : 'Erreur inconnue'}`],
        confidence: bestMatch.confidence
      };
    }
  }

  private async extractBankReportData(rawData: any[], config: BankFormatConfig): Promise<BankReport> {
    console.log(`🔄 Extraction des données pour ${config.bankName}...`);
    
    const headers = rawData[0] as string[];
    const dataRows = rawData.slice(1);
    
    // Initialiser le rapport bancaire
    const bankReport: BankReport = {
      bank: config.bankName,
      date: new Date().toISOString().split('T')[0], // Date par défaut
      openingBalance: 0,
      closingBalance: 0,
      bankFacilities: [],
      depositsNotCleared: [],
      impayes: []
    };

    // Mapper les en-têtes
    const columnMap: { [key: string]: number } = {};
    headers.forEach((header, index) => {
      const cleanHeader = header?.toString().trim();
      if (cleanHeader) {
        // Recherche exacte
        if (config.headerMappings[cleanHeader]) {
          columnMap[config.headerMappings[cleanHeader]] = index;
        } else {
          // Recherche partielle
          for (const [mappingKey, mappingValue] of Object.entries(config.headerMappings)) {
            if (cleanHeader.toLowerCase().includes(mappingKey.toLowerCase()) ||
                mappingKey.toLowerCase().includes(cleanHeader.toLowerCase())) {
              columnMap[mappingValue] = index;
            }
          }
        }
      }
    });

    console.log('📋 Colonnes mappées:', columnMap);

    // Extraire les données ligne par ligne
    for (const row of dataRows) {
      if (!row || row.every((cell: any) => !cell && cell !== 0)) continue;
      
      try {
        // Soldes d'ouverture et de clôture
        if (columnMap.openingBalance !== undefined && row[columnMap.openingBalance]) {
          const value = this.parseAmount(row[columnMap.openingBalance]);
          if (value !== null) bankReport.openingBalance = value;
        }
        
        if (columnMap.closingBalance !== undefined && row[columnMap.closingBalance]) {
          const value = this.parseAmount(row[columnMap.closingBalance]);
          if (value !== null) bankReport.closingBalance = value;
        }
        
        // Date du rapport
        if (columnMap.date !== undefined && row[columnMap.date]) {
          const dateStr = this.parseDate(row[columnMap.date], config.dateFormats);
          if (dateStr) bankReport.date = dateStr;
        }
        
        // Détecter les facilités bancaires
        if (this.containsAny(row.join(' '), config.facilityIndicators)) {
          const facility = this.extractFacility(row, headers, config);
          if (facility) {
            bankReport.bankFacilities.push(facility);
          }
        }
        
        // Détecter les impayés
        if (this.containsAny(row.join(' '), config.impayeIndicators)) {
          const impaye = this.extractImpaye(row, headers, config);
          if (impaye) {
            bankReport.impayes.push(impaye);
          }
        }
        
      } catch (error) {
        console.warn('⚠️ Erreur traitement ligne:', error);
      }
    }

    console.log(`✅ Extraction terminée pour ${config.bankName}:`, {
      openingBalance: bankReport.openingBalance,
      closingBalance: bankReport.closingBalance,
      facilities: bankReport.bankFacilities.length,
      impayes: bankReport.impayes.length
    });

    return bankReport;
  }

  private parseAmount(value: any): number | null {
    if (value === null || value === undefined || value === '') return null;
    
    try {
      if (typeof value === 'number') return value;
      
      if (typeof value === 'string') {
        // Nettoyer la chaîne
        const cleaned = value
          .replace(/[\s,]/g, '') // Supprimer espaces et virgules
          .replace(/[^\d.-]/g, '') // Garder seulement chiffres, points et tirets
          .replace(',', '.'); // Remplacer virgule par point
        
        const parsed = parseFloat(cleaned);
        return isNaN(parsed) ? null : parsed;
      }
      
      return null;
    } catch {
      return null;
    }
  }

  private parseDate(value: any, formats: string[]): string | null {
    if (!value) return null;
    
    try {
      let date: Date;
      
      if (value instanceof Date) {
        date = value;
      } else if (typeof value === 'number') {
        // Excel date serial
        date = new Date((value - 25569) * 86400 * 1000);
      } else if (typeof value === 'string') {
        date = new Date(value);
        if (isNaN(date.getTime())) return null;
      } else {
        return null;
      }
      
      return date.toISOString().split('T')[0];
    } catch {
      return null;
    }
  }

  private containsAny(text: string, keywords: string[]): boolean {
    const upperText = text.toUpperCase();
    return keywords.some(keyword => upperText.includes(keyword.toUpperCase()));
  }

  private extractFacility(row: any[], headers: string[], config: BankFormatConfig): BankFacility | null {
    try {
      const facility: BankFacility = {
        facilityType: 'Crédit',
        limitAmount: 0,
        usedAmount: 0,
        availableAmount: 0
      };

      // Rechercher les montants dans la ligne
      for (let i = 0; i < row.length; i++) {
        const value = this.parseAmount(row[i]);
        if (value !== null && value > 0) {
          const header = headers[i]?.toLowerCase() || '';
          
          if (header.includes('limite') || header.includes('limit')) {
            facility.limitAmount = value;
          } else if (header.includes('utilisé') || header.includes('used')) {
            facility.usedAmount = value;
          } else if (header.includes('disponible') || header.includes('available')) {
            facility.availableAmount = value;
          }
        }
      }

      // Calculer les montants manquants
      if (facility.limitAmount > 0 && facility.usedAmount > 0 && facility.availableAmount === 0) {
        facility.availableAmount = facility.limitAmount - facility.usedAmount;
      }

      return facility.limitAmount > 0 ? facility : null;
    } catch {
      return null;
    }
  }

  private extractImpaye(row: any[], headers: string[], config: BankFormatConfig): Impaye | null {
    try {
      const impaye: Impaye = {
        dateEcheance: new Date().toISOString().split('T')[0],
        clientCode: 'UNKNOWN',
        montant: 0
      };

      // Rechercher les données dans la ligne
      for (let i = 0; i < row.length; i++) {
        const value = row[i];
        const header = headers[i]?.toLowerCase() || '';
        
        if (header.includes('montant') || header.includes('amount')) {
          const amount = this.parseAmount(value);
          if (amount !== null && amount > 0) {
            impaye.montant = amount;
          }
        } else if (header.includes('client') || header.includes('code')) {
          if (value && typeof value === 'string') {
            impaye.clientCode = value.toString().trim();
          }
        } else if (header.includes('date') || header.includes('échéance')) {
          const date = this.parseDate(value, config.dateFormats);
          if (date) {
            impaye.dateEcheance = date;
          }
        }
      }

      return impaye.montant > 0 ? impaye : null;
    } catch {
      return null;
    }
  }
}

export const bankReportDetectionService = new BankReportDetectionService();

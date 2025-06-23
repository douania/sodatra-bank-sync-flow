
import * as XLSX from 'xlsx';
import { CollectionReport } from '@/types/banking';

export interface ExcelProcessingResult {
  success: boolean;
  data?: CollectionReport[];
  errors?: string[];
  totalRows?: number;
  processedRows?: number;
}

export class ExcelProcessingService {
  
  // Mapping des colonnes Excel vers les propriétés TypeScript
  private static readonly COLUMN_MAPPING = {
    'CLIENT CODE': 'clientCode',
    'COLLECTION AMOUNT': 'collectionAmount',
    'BANK NAME': 'bankName',
    'DATE OF VALIDITY': 'dateOfValidity',
    'FACTURE NO': 'factureNo',
    'NO CHQ/BD': 'noChqBd',
    'BANK NAME DISPLAY': 'bankNameDisplay',
    'DEPO REF': 'depoRef',
    'N.J': 'nj',
    'TAUX': 'taux',
    'INTERET': 'interet',
    'COMMISSION': 'commission',
    'TOB': 'tob',
    'FRAIS ESCOMPTE': 'fraisEscompte',
    'BANK COMMISSION': 'bankCommission',
    'SG OR FA NO': 'sgOrFaNo',
    'D.N AMOUNT': 'dNAmount',
    'INCOME': 'income',
    'DATE OF IMPAY': 'dateOfImpay',
    'REGLEMENT IMPAYE': 'reglementImpaye',
    'REMARQUES': 'remarques'
  };

  async processCollectionReportExcel(file: File): Promise<ExcelProcessingResult> {
    try {
      console.log('🚀 Début traitement fichier Excel Collection Report:', file.name);
      
      // Lire le fichier Excel
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      
      // Prendre la première feuille
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      // Convertir en JSON avec en-têtes
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      if (jsonData.length < 2) {
        return {
          success: false,
          errors: ['Le fichier Excel doit contenir au moins une ligne d\'en-tête et une ligne de données']
        };
      }

      // Extraire les en-têtes (première ligne)
      const headers = jsonData[0] as string[];
      const dataRows = jsonData.slice(1) as any[][];
      
      console.log('📋 En-têtes détectés:', headers);
      console.log(`📊 ${dataRows.length} lignes de données à traiter`);

      // Traiter chaque ligne de données
      const collections: CollectionReport[] = [];
      const errors: string[] = [];
      
      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const rowNumber = i + 2; // +2 car ligne 1 = en-têtes, et index commence à 0
        
        try {
          const collection = this.processRow(headers, row, rowNumber);
          if (collection) {
            collections.push(collection);
            console.log(`✅ Ligne ${rowNumber} traitée: ${collection.clientCode} - ${collection.collectionAmount}`);
          }
        } catch (error) {
          const errorMsg = `Erreur ligne ${rowNumber}: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
          errors.push(errorMsg);
          console.warn('⚠️', errorMsg);
        }
      }

      const result: ExcelProcessingResult = {
        success: errors.length === 0,
        data: collections,
        errors: errors.length > 0 ? errors : undefined,
        totalRows: dataRows.length,
        processedRows: collections.length
      };

      console.log(`✅ Traitement terminé: ${collections.length}/${dataRows.length} lignes traitées`);
      if (errors.length > 0) {
        console.warn(`⚠️ ${errors.length} erreurs détectées`);
      }

      return result;

    } catch (error) {
      console.error('❌ Erreur traitement Excel:', error);
      return {
        success: false,
        errors: [error instanceof Error ? error.message : 'Erreur inconnue lors du traitement Excel']
      };
    }
  }

  private processRow(headers: string[], row: any[], rowNumber: number): CollectionReport | null {
    // Vérifier si la ligne est vide
    if (!row || row.every(cell => !cell || cell.toString().trim() === '')) {
      return null;
    }

    // Créer un objet avec les valeurs mappées
    const collection: Partial<CollectionReport> = {
      reportDate: new Date().toISOString().split('T')[0], // Date actuelle par défaut
      status: 'pending'
    };

    // Mapper chaque colonne
    headers.forEach((header, index) => {
      const normalizedHeader = header?.toString().toUpperCase().trim();
      const value = row[index];
      
      if (!normalizedHeader || value === undefined || value === null) {
        return;
      }

      // Rechercher la correspondance dans le mapping
      const mappedField = Object.entries(ExcelProcessingService.COLUMN_MAPPING)
        .find(([excelCol]) => excelCol === normalizedHeader)?.[1];

      if (mappedField) {
        this.setFieldValue(collection, mappedField, value);
      } else {
        console.log(`🔍 Colonne non mappée: "${normalizedHeader}" = "${value}"`);
      }
    });

    // Validation des champs obligatoires
    if (!collection.clientCode) {
      throw new Error('CLIENT CODE manquant');
    }
    
    if (!collection.collectionAmount || collection.collectionAmount <= 0) {
      throw new Error('COLLECTION AMOUNT manquant ou invalide');
    }

    console.log(`📝 Collection créée pour ${collection.clientCode}:`, {
      clientCode: collection.clientCode,
      collectionAmount: collection.collectionAmount,
      bankName: collection.bankName,
      status: collection.status
    });

    return collection as CollectionReport;
  }

  private setFieldValue(collection: Partial<CollectionReport>, field: string, value: any) {
    const cleanValue = value?.toString().trim();
    
    if (!cleanValue) return;

    switch (field) {
      case 'clientCode':
      case 'bankName':
      case 'factureNo':
      case 'noChqBd':
      case 'bankNameDisplay':
      case 'depoRef':
      case 'sgOrFaNo':
      case 'reglementImpaye':
      case 'remarques':
        (collection as any)[field] = cleanValue;
        break;
        
      case 'collectionAmount':
      case 'nj':
        (collection as any)[field] = this.parseNumber(cleanValue);
        break;
        
      case 'taux':
      case 'interet':
      case 'commission':
      case 'tob':
      case 'fraisEscompte':
      case 'bankCommission':
      case 'dNAmount':
      case 'income':
        (collection as any)[field] = this.parseDecimal(cleanValue);
        break;
        
      case 'dateOfValidity':
      case 'dateOfImpay':
        const parsedDate = this.parseDate(cleanValue);
        if (parsedDate) {
          (collection as any)[field] = parsedDate;
        }
        break;
    }
  }

  private parseNumber(value: string): number {
    const cleaned = value.replace(/[^\d.-]/g, '');
    const parsed = parseInt(cleaned, 10);
    return isNaN(parsed) ? 0 : parsed;
  }

  private parseDecimal(value: string): number {
    const cleaned = value.replace(/[^\d.-]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  }

  private parseDate(value: string): string | null {
    try {
      // Essayer différents formats de date
      let date: Date;
      
      // Format Excel numérique (nombre de jours depuis 1900)
      if (/^\d+$/.test(value)) {
        const excelDate = parseInt(value, 10);
        // Excel compte les jours depuis le 1er janvier 1900
        date = new Date(1900, 0, excelDate - 1);
      } else {
        // Format texte
        date = new Date(value);
      }
      
      if (isNaN(date.getTime())) {
        return null;
      }
      
      // Retourner au format ISO (YYYY-MM-DD)
      return date.toISOString().split('T')[0];
    } catch {
      return null;
    }
  }
}

export const excelProcessingService = new ExcelProcessingService();

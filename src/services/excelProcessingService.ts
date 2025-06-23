import * as XLSX from 'xlsx';
import { CollectionReport } from '@/types/banking';

export interface ExcelProcessingResult {
  success: boolean;
  data?: CollectionReport[];
  errors?: string[];
  totalRows?: number;
  processedRows?: number;
  debugInfo?: {
    detectedHeaders: string[];
    sampleRows: any[];
    mappingResults: { [key: string]: any };
  };
}

export class ExcelProcessingService {
  
  // Mapping des colonnes Excel vers les propriétés TypeScript - VERSION ÉTENDUE
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
    'REMARQUES': 'remarques',
    
    // Variations possibles des noms de colonnes
    'CODE CLIENT': 'clientCode',
    'MONTANT COLLECTION': 'collectionAmount',
    'NOM BANQUE': 'bankName',
    'DATE VALIDITE': 'dateOfValidity',
    'NUMERO FACTURE': 'factureNo',
    'CHQ/BD': 'noChqBd',
    'REF DEPOT': 'depoRef',
    'NJ': 'nj',
    'FRAIS': 'fraisEscompte',
    'COMMISSION BANQUE': 'bankCommission',
    'MONTANT DN': 'dNAmount',
    'REVENUS': 'income',
    'DATE IMPAYE': 'dateOfImpay',
    'IMPAYE': 'reglementImpaye'
  };

  async processCollectionReportExcel(file: File): Promise<ExcelProcessingResult> {
    try {
      console.log('🚀 DÉBUT TRAITEMENT EXCEL - Fichier:', file.name, 'Taille:', file.size, 'bytes');
      
      // Lire le fichier Excel
      const arrayBuffer = await file.arrayBuffer();
      console.log('📁 ArrayBuffer créé, taille:', arrayBuffer.byteLength);
      
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      console.log('📊 Workbook lu, feuilles disponibles:', workbook.SheetNames);
      
      // Prendre la première feuille
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      console.log('📋 Traitement de la feuille:', firstSheetName);
      
      // Convertir en JSON avec en-têtes
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      console.log('🔄 Conversion JSON terminée, nombre de lignes:', jsonData.length);
      
      if (jsonData.length < 2) {
        console.error('❌ Fichier invalide - pas assez de données');
        return {
          success: false,
          errors: ['Le fichier Excel doit contenir au moins une ligne d\'en-tête et une ligne de données']
        };
      }

      // Extraire les en-têtes (première ligne)
      const headers = jsonData[0] as string[];
      const dataRows = jsonData.slice(1) as any[][];
      
      console.log('📋 EN-TÊTES DÉTECTÉS:', headers);
      console.log('📊 NOMBRE DE LIGNES DE DONNÉES:', dataRows.length);
      
      // Afficher un échantillon des premières lignes pour debug
      const sampleRows = dataRows.slice(0, 3);
      console.log('🔍 ÉCHANTILLON DES DONNÉES (3 premières lignes):', sampleRows);

      // Analyser le mapping des colonnes
      const mappingResults = this.analyzeColumnMapping(headers);
      console.log('🗺️ RÉSULTATS DU MAPPING:', mappingResults);

      // Traiter chaque ligne de données
      const collections: CollectionReport[] = [];
      const errors: string[] = [];
      
      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const rowNumber = i + 2; // +2 car ligne 1 = en-têtes, et index commence à 0
        
        console.log(`\n🔄 TRAITEMENT LIGNE ${rowNumber}:`, row);
        
        try {
          const collection = this.processRow(headers, row, rowNumber);
          if (collection) {
            collections.push(collection);
            console.log(`✅ Ligne ${rowNumber} traitée avec succès:`, {
              clientCode: collection.clientCode,
              collectionAmount: collection.collectionAmount,
              bankName: collection.bankName
            });
          } else {
            console.log(`⚠️ Ligne ${rowNumber} ignorée (vide)`);
          }
        } catch (error) {
          const errorMsg = `Erreur ligne ${rowNumber}: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
          errors.push(errorMsg);
          console.error('❌', errorMsg, 'Données de la ligne:', row);
        }
      }

      const result: ExcelProcessingResult = {
        success: collections.length > 0,
        data: collections,
        errors: errors.length > 0 ? errors : undefined,
        totalRows: dataRows.length,
        processedRows: collections.length,
        debugInfo: {
          detectedHeaders: headers,
          sampleRows: sampleRows,
          mappingResults: mappingResults
        }
      };

      console.log(`\n📊 RÉSUMÉ DU TRAITEMENT:`);
      console.log(`✅ Collections créées: ${collections.length}`);
      console.log(`❌ Erreurs: ${errors.length}`);
      console.log(`📋 Total lignes: ${dataRows.length}`);
      
      if (collections.length > 0) {
        console.log('🎯 Première collection créée:', collections[0]);
      }

      return result;

    } catch (error) {
      console.error('❌ ERREUR CRITIQUE TRAITEMENT EXCEL:', error);
      return {
        success: false,
        errors: [error instanceof Error ? error.message : 'Erreur inconnue lors du traitement Excel']
      };
    }
  }

  private analyzeColumnMapping(headers: string[]): { [key: string]: any } {
    const mappingResults: { [key: string]: any } = {};
    
    headers.forEach((header, index) => {
      const normalizedHeader = header?.toString().toUpperCase().trim();
      
      if (!normalizedHeader) {
        mappingResults[`Colonne_${index}`] = { original: header, mapped: null, reason: 'En-tête vide' };
        return;
      }

      // Rechercher la correspondance dans le mapping
      const mappedField = Object.entries(ExcelProcessingService.COLUMN_MAPPING)
        .find(([excelCol]) => excelCol === normalizedHeader)?.[1];

      if (mappedField) {
        mappingResults[normalizedHeader] = { 
          original: header, 
          mapped: mappedField, 
          reason: 'Mappé avec succès',
          index: index
        };
      } else {
        mappingResults[normalizedHeader] = { 
          original: header, 
          mapped: null, 
          reason: 'Pas de correspondance trouvée',
          index: index
        };
      }
    });
    
    return mappingResults;
  }

  private processRow(headers: string[], row: any[], rowNumber: number): CollectionReport | null {
    // Vérifier si la ligne est vide
    if (!row || row.every(cell => !cell || cell.toString().trim() === '')) {
      console.log(`⚠️ Ligne ${rowNumber} vide, ignorée`);
      return null;
    }

    console.log(`🔍 Traitement ligne ${rowNumber} - Données:`, row);

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

      console.log(`🔗 Mapping colonne "${normalizedHeader}" (index ${index}) = "${value}"`);

      // Rechercher la correspondance dans le mapping
      const mappedField = Object.entries(ExcelProcessingService.COLUMN_MAPPING)
        .find(([excelCol]) => excelCol === normalizedHeader)?.[1];

      if (mappedField) {
        this.setFieldValue(collection, mappedField, value);
        console.log(`✅ Colonne mappée: ${normalizedHeader} -> ${mappedField} = ${value}`);
      } else {
        console.log(`⚠️ Colonne non mappée: "${normalizedHeader}" = "${value}"`);
      }
    });

    // Validation des champs obligatoires avec logs détaillés
    console.log(`🔍 Validation collection:`, {
      clientCode: collection.clientCode,
      collectionAmount: collection.collectionAmount,
      hasClientCode: !!collection.clientCode,
      hasCollectionAmount: !!collection.collectionAmount && collection.collectionAmount > 0
    });

    if (!collection.clientCode) {
      throw new Error('CLIENT CODE manquant');
    }
    
    if (!collection.collectionAmount || collection.collectionAmount <= 0) {
      throw new Error('COLLECTION AMOUNT manquant ou invalide');
    }

    const finalCollection = collection as CollectionReport;
    console.log(`📝 Collection finale créée:`, finalCollection);

    return finalCollection;
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

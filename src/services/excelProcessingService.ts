import * as XLSX from 'xlsx';
import { CollectionReport } from '@/types/banking';
import { excelMappingService } from './excelMappingService';

export interface ExcelProcessingResult {
  success: boolean;
  data?: CollectionReport[];
  errors?: string[];
  warnings?: string[];
  sourceFile?: string;
  totalProcessed?: number;
}

class ExcelProcessingService {
  async processCollectionReportExcel(file: File): Promise<ExcelProcessingResult> {
    try {
      console.log('📊 DÉBUT TRAITEMENT EXCEL (MODE TOLÉRANT):', file.name);
      
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      
      if (!workbook.SheetNames.length) {
        return {
          success: false,
          errors: ['Aucune feuille trouvée dans le fichier Excel']
        };
      }
      
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      console.log(`📊 Données brutes extraites: ${rawData.length} lignes`);
      
      if (rawData.length < 2) {
        return {
          success: false,
          errors: ['Le fichier Excel doit contenir au moins un en-tête et une ligne de données']
        };
      }
      
      // Identifier la ligne d'en-tête
      const headers = rawData[0] as string[];
      console.log('📊 En-têtes détectés:', headers);
      
      // ⭐ MODE TOLÉRANT - Traiter les données même avec des erreurs
      const collections: CollectionReport[] = [];
      const errors: string[] = [];
      const warnings: string[] = [];
      
      for (let rowIndex = 1; rowIndex < rawData.length; rowIndex++) {
        const row = rawData[rowIndex] as any[];
        
        // Ignorer les lignes complètement vides
        if (!row || row.every(cell => !cell && cell !== 0)) {
          console.log(`⚠️ Ligne ${rowIndex + 1} ignorée (vide)`);
          continue;
        }
        
        try {
          // ⭐ TRAÇABILITÉ OPTIONNELLE - Ne plus bloquer
          const rowData = this.parseExcelRow(headers, row, rowIndex + 1);
          
          // ⭐ ASSIGNATION OPTIONNELLE de la traçabilité
          rowData.excel_filename = file.name;
          rowData.excel_source_row = rowIndex + 1;
          
          console.log(`📊 Ligne ${rowIndex + 1}: traitement (mode tolérant)`, {
            filename: rowData.excel_filename,
            row: rowData.excel_source_row,
            client: rowData.clientCode
          });
          
          // Mapper vers le format CollectionReport
          const mappedData = excelMappingService.mapExcelRowToCollection(rowData);
          
          // ⭐ PLUS DE VÉRIFICATION BLOQUANTE - Juste un avertissement
          if (!mappedData.excelFilename || !mappedData.excelSourceRow) {
            warnings.push(`Ligne ${rowIndex + 1}: Traçabilité manquante (non-bloquant)`);
          }
          
          collections.push(mappedData);
          
        } catch (error) {
          // ⭐ ERREUR NON-BLOQUANTE - Continuer le traitement
          const errorMsg = `Ligne ${rowIndex + 1}: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
          console.warn('⚠️ Erreur non-bloquante:', errorMsg);
          warnings.push(errorMsg); // Avertissement au lieu d'erreur
          
          // Continuer le traitement même avec des erreurs
          continue;
        }
      }
      
      console.log('📊 RÉSULTAT TRAITEMENT EXCEL (MODE TOLÉRANT):', {
        totalLignes: rawData.length - 1,
        collectionsTraitées: collections.length,
        erreurs: errors.length,
        avertissements: warnings.length
      });
      
      // ⭐ SUCCÈS même avec des avertissements
      return {
        success: collections.length > 0, // Succès si au moins une collection est traitée
        data: collections,
        errors: errors.length > 0 ? errors : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
        sourceFile: file.name,
        totalProcessed: collections.length
      };
      
    } catch (error) {
      console.error('❌ ERREUR CRITIQUE TRAITEMENT EXCEL:', error);
      return {
        success: false,
        errors: [`Erreur critique: ${error instanceof Error ? error.message : 'Erreur inconnue'}`]
      };
    }
  }
  
  private parseExcelRow(headers: string[], row: any[], rowNumber: number): any {
    const rowData: any = {
      _sourceRowNumber: rowNumber // Pour debug
    };
    
    for (let i = 0; i < headers.length && i < row.length; i++) {
      const header = headers[i];
      const value = row[i];
      
      if (header && value !== null && value !== undefined && value !== '') {
        // Nettoyer et normaliser la valeur
        let cleanValue = value;
        
        if (typeof value === 'string') {
          cleanValue = value.trim();
        }
        
        // Mapper les en-têtes vers les propriétés
        const mappedProperty = this.mapHeaderToProperty(header);
        if (mappedProperty) {
          rowData[mappedProperty] = cleanValue;
        }
      }
    }
    
    return rowData;
  }
  
  private mapHeaderToProperty(header: string): string | null {
    const headerMappings: { [key: string]: string } = {
      'Date': 'reportDate',
      'Report Date': 'reportDate',
      'Client Code': 'clientCode',
      'Client': 'clientCode',
      'Code Client': 'clientCode',
      'Amount': 'collectionAmount',
      'Collection Amount': 'collectionAmount',
      'Montant': 'collectionAmount',
      'Bank': 'bankName',
      'Banque': 'bankName',
      'Bank Name': 'bankName',
      'Date of Validity': 'dateOfValidity',
      'Date Validité': 'dateOfValidity',
      'Facture No': 'factureNo',
      'Invoice No': 'factureNo',
      'No Chèque/BD': 'noChqBd',
      'Chèque BD': 'noChqBd',
      'Bank Name Display': 'bankNameDisplay',
      'Depot Ref': 'depoRef',
      'Référence': 'depoRef',
      'NJ': 'nj',
      'Taux': 'taux',
      'Rate': 'taux',
      'Intérêt': 'interet',
      'Interest': 'interet',
      'Commission': 'commission',
      'TOB': 'tob',
      'Frais Escompte': 'fraisEscompte',
      'Bank Commission': 'bankCommission',
      'SG or FA No': 'sgOrFaNo',
      'D/N Amount': 'dNAmount',
      'Income': 'income',
      'Revenus': 'income',
      'Date of Impay': 'dateOfImpay',
      'Règlement Impayé': 'reglementImpaye',
      'Remarques': 'remarques',
      'Comments': 'remarques'
    };
    
    // Recherche exacte
    if (headerMappings[header]) {
      return headerMappings[header];
    }
    
    // Recherche insensible à la casse
    const lowerHeader = header.toLowerCase();
    for (const [key, value] of Object.entries(headerMappings)) {
      if (key.toLowerCase() === lowerHeader) {
        return value;
      }
    }
    
    // Recherche partielle
    for (const [key, value] of Object.entries(headerMappings)) {
      if (lowerHeader.includes(key.toLowerCase()) || key.toLowerCase().includes(lowerHeader)) {
        return value;
      }
    }
    
    return null;
  }
}

export const excelProcessingService = new ExcelProcessingService();

import * as XLSX from 'xlsx';
import { excelMappingService } from './excelMappingService';
import { ProcessingResults } from '@/types/banking';
import { databaseService } from './databaseService';

export interface ExcelProcessingOptions {
  filename: string;
  preventDuplicates?: boolean;
  forceReprocess?: boolean;
}

class ExcelProcessingService {
  async processExcelFile(
    file: File, 
    options: ExcelProcessingOptions = { filename: file.name, preventDuplicates: true }
  ): Promise<ProcessingResults> {
    console.log(`📊 === DÉBUT TRAITEMENT EXCEL: ${options.filename} ===`);
    
    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      
      let totalProcessed = 0;
      let duplicatesPrevented = 0;
      const results: ProcessingResults = {
        bankReports: [],
        fundPosition: null,
        collections: [],
        clientReconciliations: [],
        totalProcessed: 0,
        errors: [],
        warnings: [],
        duplicatesPrevented: 0,
        sourceFile: options.filename
      };

      // ⭐ CONTRÔLE STRICT: Vérification préalable des doublons par nom de fichier
      if (options.preventDuplicates && !options.forceReprocess) {
        const existingImports = await this.checkExistingImports(options.filename);
        if (existingImports.length > 0) {
          console.log(`🚫 FICHIER DÉJÀ TRAITÉ: ${existingImports.length} lignes trouvées`);
          results.warnings.push(
            `Ce fichier a déjà été traité le ${new Date(existingImports[0].excel_processed_at || '').toLocaleString('fr-FR')}. ${existingImports.length} lignes détectées.`
          );
          results.errors.push('DUPLICATE_FILE_DETECTED');
          return results;
        }
      }

      for (const sheetName of workbook.SheetNames) {
        console.log(`📋 Traitement feuille: ${sheetName}`);
        
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        if (jsonData.length === 0) {
          console.log(`⚠️ Feuille vide: ${sheetName}`);
          continue;
        }

        // ⭐ FILTRAGE DRASTIQUE: S'arrêter exactement à la ligne 868 + headers
        const validRows = this.filterValidRowsWithStrictLimit(jsonData as any[][], 868);
        console.log(`📊 Lignes valides après filtrage strict: ${validRows.length - 1} (headers exclus)`);

        // Traitement spécifique pour les collections avec traçabilité OBLIGATOIRE
        if (sheetName.toLowerCase().includes('collection') || validRows.length > 1) {
          const processedCollections = await this.processCollectionsWithMandatoryTraceability(
            validRows,
            options,
            results
          );
          
          results.collections.push(...processedCollections);
          totalProcessed += processedCollections.length;
        }
      }

      results.totalProcessed = totalProcessed;
      results.duplicatesPrevented = duplicatesPrevented;
      
      console.log(`✅ === TRAITEMENT TERMINÉ ===`);
      console.log(`📊 Total traité: ${totalProcessed}`);
      console.log(`🚫 Doublons évités: ${duplicatesPrevented}`);
      
      return results;
      
    } catch (error) {
      console.error('❌ Erreur traitement Excel:', error);
      return {
        bankReports: [],
        fundPosition: null,
        collections: [],
        clientReconciliations: [],
        totalProcessed: 0,
        errors: [error instanceof Error ? error.message : 'Erreur inconnue'],
        warnings: [],
        duplicatesPrevented: 0,
        sourceFile: options.filename
      };
    }
  }

  // ⭐ NOUVELLE MÉTHODE: Filtrage strict avec limite absolue à 868 lignes
  private filterValidRowsWithStrictLimit(jsonData: any[][], maxDataRows: number = 868): any[][] {
    const headers = jsonData[0];
    const validRows = [headers]; // Garder les headers
    
    let processedDataRows = 0;
    let consecutiveEmptyRows = 0;
    let consecutiveInvalidRows = 0;
    const MAX_CONSECUTIVE_EMPTY = 2; // Réduit drastiquement
    const MAX_CONSECUTIVE_INVALID = 3; // Réduit drastiquement
    
    console.log(`🔍 === DÉBUT FILTRAGE STRICT (MAX: ${maxDataRows} lignes) ===`);
    console.log(`📋 Headers détectés:`, headers?.slice(0, 5));
    
    for (let i = 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      const rowNumber = i + 1;
      
      // ⭐ LIMITE ABSOLUE: Arrêter après maxDataRows lignes de données valides
      if (processedDataRows >= maxDataRows) {
        console.log(`🛑 LIMITE ABSOLUE ATTEINTE: ${maxDataRows} lignes de données traitées`);
        break;
      }
      
      // ⭐ DÉTECTION RENFORCÉE DES LIGNES VIDES
      const isCompletelyEmpty = !row || row.length === 0 || row.every(cell => 
        cell === null || 
        cell === undefined || 
        cell === '' || 
        (typeof cell === 'string' && cell.trim() === '')
      );
      
      // ⭐ DÉTECTION RENFORCÉE DES VALEURS "undefined"
      const hasUndefinedStrings = row && row.some(cell => 
        cell === 'undefined' || 
        (typeof cell === 'string' && cell.toLowerCase().includes('undefined'))
      );
      
      // ⭐ VALIDATION DES DONNÉES CRITIQUES STRICTE
      const hasCriticalData = this.hasValidCriticalDataStrict(row, headers);
      
      // Log tous les 25 lignes pour suivi
      if (rowNumber % 25 === 0 || hasUndefinedStrings || !hasCriticalData) {
        console.log(`🔍 Ligne ${rowNumber}:`, {
          isEmpty: isCompletelyEmpty,
          hasUndefined: hasUndefinedStrings,
          hasCritical: hasCriticalData,
          processedSoFar: processedDataRows,
          sampleData: row?.slice(0, 3)
        });
      }
      
      // ⭐ DÉCISION STRICTE: Ignorer les lignes invalides
      if (isCompletelyEmpty) {
        consecutiveEmptyRows++;
        consecutiveInvalidRows = 0;
        
        if (consecutiveEmptyRows >= MAX_CONSECUTIVE_EMPTY) {
          console.log(`🛑 ARRÊT: ${MAX_CONSECUTIVE_EMPTY} lignes vides consécutives à la ligne ${rowNumber}`);
          break;
        }
        continue;
      }
      
      if (hasUndefinedStrings || !hasCriticalData) {
        consecutiveInvalidRows++;
        consecutiveEmptyRows = 0;
        
        if (consecutiveInvalidRows >= MAX_CONSECUTIVE_INVALID) {
          console.log(`🛑 ARRÊT: ${MAX_CONSECUTIVE_INVALID} lignes invalides consécutives à la ligne ${rowNumber}`);
          break;
        }
        continue;
      }
      
      // ⭐ LIGNE VALIDE: Réinitialiser compteurs et ajouter
      consecutiveEmptyRows = 0;
      consecutiveInvalidRows = 0;
      validRows.push(row);
      processedDataRows++;
      
      if (processedDataRows % 100 === 0) {
        console.log(`✅ ${processedDataRows} lignes valides ajoutées (ligne Excel ${rowNumber})`);
      }
    }
    
    console.log(`📊 === FILTRAGE STRICT TERMINÉ ===`);
    console.log(`✅ Lignes de données valides: ${processedDataRows}`);
    console.log(`🎯 Objectif respecté: ${processedDataRows <= maxDataRows ? 'OUI' : 'NON'}`);
    
    return validRows;
  }
  
  // ⭐ VALIDATION STRICTE DES DONNÉES CRITIQUES
  private hasValidCriticalDataStrict(row: any[], headers: any[]): boolean {
    if (!row || !headers) return false;
    
    // Chercher les colonnes critiques avec plus de variantes
    const clientCodeIndex = headers.findIndex(header => 
      header && typeof header === 'string' && 
      (header.toLowerCase().includes('client') || 
       header.toLowerCase().includes('code') ||
       header.toLowerCase().includes('nom'))
    );
    
    const amountIndex = headers.findIndex(header => 
      header && typeof header === 'string' && 
      (header.toLowerCase().includes('montant') || 
       header.toLowerCase().includes('amount') || 
       header.toLowerCase().includes('collection') ||
       header.toLowerCase().includes('somme'))
    );
    
    // Validation STRICTE du code client
    const hasValidClientCode = clientCodeIndex >= 0 && 
      row[clientCodeIndex] && 
      row[clientCodeIndex] !== 'undefined' &&
      typeof row[clientCodeIndex] === 'string' &&
      row[clientCodeIndex].toString().trim().length > 0 &&
      !row[clientCodeIndex].toString().toLowerCase().includes('undefined');
    
    // Validation STRICTE du montant
    const hasValidAmount = amountIndex >= 0 && 
      row[amountIndex] && 
      row[amountIndex] !== 'undefined' &&
      (typeof row[amountIndex] === 'number' || 
       (typeof row[amountIndex] === 'string' && !isNaN(parseFloat(row[amountIndex])))) &&
      parseFloat(row[amountIndex].toString()) > 0;
    
    return hasValidClientCode && hasValidAmount;
  }

  // ⭐ TRAITEMENT AVEC TRAÇABILITÉ OBLIGATOIRE
  private async processCollectionsWithMandatoryTraceability(
    jsonData: any[][],
    options: ExcelProcessingOptions,
    results: ProcessingResults
  ) {
    const collections = [];
    const headers = jsonData[0];
    let duplicatesPrevented = 0;
    const totalRows = jsonData.length - 1; // Exclure les headers

    console.log(`📋 Traitement de ${totalRows} lignes avec traçabilité OBLIGATOIRE`);

    for (let rowIndex = 1; rowIndex < jsonData.length; rowIndex++) {
      const row = jsonData[rowIndex];
      const excelSourceRow = rowIndex + 1; // +1 car Excel commence à 1
      
      // Progress tous les 50 lignes
      if (rowIndex % 50 === 0) {
        const progressPercent = Math.floor((rowIndex / totalRows) * 100);
        console.log(`📊 Progression: ${progressPercent}% (${rowIndex}/${totalRows})`);
      }
      
      try {
        // ⭐ VÉRIFICATION STRICTE DES DOUBLONS PAR TRAÇABILITÉ
        if (options.preventDuplicates && !options.forceReprocess) {
          const existingRow = await this.checkSpecificRowExistsStrict(options.filename, excelSourceRow);
          if (existingRow) {
            console.log(`🚫 Ligne ${excelSourceRow} déjà traitée, ignorée`);
            duplicatesPrevented++;
            results.warnings.push(`Ligne ${excelSourceRow} ignorée (déjà traitée)`);
            continue;
          }
        }

        // Convertir le tableau en objet avec les headers comme clés
        const rowObject: any = {};
        headers.forEach((header: string, index: number) => {
          rowObject[header] = row[index];
        });

        // Traiter la ligne avec traçabilité OBLIGATOIRE
        const collection = excelMappingService.transformExcelRowToSupabase(rowObject, excelSourceRow);
        
        if (collection) {
          // ⭐ TRAÇABILITÉ OBLIGATOIRE: Ces champs sont maintenant REQUIS
          collection.excel_source_row = excelSourceRow;
          collection.excel_filename = options.filename;
          collection.excel_processed_at = new Date().toISOString();
          
          // Vérifications de sécurité
          if (!collection.excel_filename || !collection.excel_source_row) {
            throw new Error(`Traçabilité manquante pour ligne ${excelSourceRow}`);
          }
          
          collections.push(collection);
          console.log(`✅ Ligne ${excelSourceRow}: ${collection.client_code} - ${collection.collection_amount} FCFA [TRACÉ]`);
        }
      } catch (error) {
        console.error(`❌ Erreur ligne ${excelSourceRow}:`, error);
        results.errors.push(`Ligne ${excelSourceRow}: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
      }
    }

    results.duplicatesPrevented = (results.duplicatesPrevented || 0) + duplicatesPrevented;
    console.log(`🚫 ${duplicatesPrevented} doublons évités par traçabilité`);
    
    return collections;
  }

  // ⭐ VÉRIFICATION STRICTE D'EXISTENCE DE LIGNE SPÉCIFIQUE
  private async checkSpecificRowExistsStrict(filename: string, sourceRow: number) {
    try {
      const collection = await databaseService.getCollectionByFileAndRowStrict(filename, sourceRow);
      return collection;
    } catch (error) {
      console.error('❌ Erreur vérification ligne spécifique stricte:', error);
      return null;
    }
  }

  private async checkExistingImports(filename: string) {
    try {
      const collections = await databaseService.getCollectionsByFilename(filename);
      return collections;
    } catch (error) {
      console.error('❌ Erreur vérification imports existants:', error);
      return [];
    }
  }

  private async checkSpecificRowExists(filename: string, sourceRow: number) {
    try {
      const collection = await databaseService.getCollectionByFileAndRow(filename, sourceRow);
      return collection;
    } catch (error) {
      console.error('❌ Erreur vérification ligne spécifique:', error);
      return null;
    }
  }

  async getFileImportHistory(filename: string) {
    try {
      const collections = await databaseService.getCollectionsByFilename(filename);
      
      return {
        filename,
        totalRows: collections.length,
        firstImport: collections.length > 0 ? collections[0].excel_processed_at : null,
        lastImport: collections.length > 0 ? collections[collections.length - 1].excel_processed_at : null,
        sourceRows: collections.map(c => c.excel_source_row).filter(Boolean)
      };
    } catch (error) {
      console.error('❌ Erreur historique import:', error);
      return null;
    }
  }

  async processCollectionReportExcel(file: File): Promise<{ success: boolean; data?: any[]; errors?: string[] }> {
    try {
      const results = await this.processExcelFile(file, {
        filename: file.name,
        preventDuplicates: true
      });
      
      return {
        success: results.errors.length === 0,
        data: results.collections,
        errors: results.errors
      };
    } catch (error) {
      return {
        success: false,
        errors: [error instanceof Error ? error.message : 'Erreur inconnue']
      };
    }
  }
}

export const excelProcessingService = new ExcelProcessingService();

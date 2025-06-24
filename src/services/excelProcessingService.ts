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

      // Vérifier si le fichier a déjà été traité (si prévention activée)
      if (options.preventDuplicates && !options.forceReprocess) {
        const existingImports = await this.checkExistingImports(options.filename);
        if (existingImports.length > 0) {
          console.log(`⚠️ Fichier déjà traité: ${existingImports.length} lignes trouvées`);
          results.warnings.push(
            `Ce fichier a déjà été traité le ${new Date(existingImports[0].excelProcessedAt || '').toLocaleString('fr-FR')}. ${existingImports.length} lignes détectées.`
          );
          
          // Proposer les options à l'utilisateur
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

        // ⭐ OPTIMISATION: Filtrer les lignes vides AVANT traitement
        const validRows = this.filterValidRows(jsonData as any[][]);
        console.log(`📊 Lignes valides détectées: ${validRows.length} sur ${jsonData.length}`);

        // Traitement spécifique pour les collections
        if (sheetName.toLowerCase().includes('collection') || validRows.length > 0) {
          const processedCollections = await this.processCollectionsWithTraceability(
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

  // ⭐ NOUVELLE MÉTHODE: Filtrer les lignes vides et invalides
  private filterValidRows(jsonData: any[][]): any[][] {
    const headers = jsonData[0];
    const validRows = [headers]; // Garder les headers
    
    let consecutiveEmptyRows = 0;
    const MAX_CONSECUTIVE_EMPTY = 5; // Arrêter après 5 lignes vides consécutives
    
    for (let i = 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      
      // Vérifier si la ligne est vide ou ne contient que des valeurs nulles/undefined
      const isEmptyRow = !row || row.length === 0 || row.every(cell => 
        cell === null || 
        cell === undefined || 
        cell === '' || 
        (typeof cell === 'string' && cell.trim() === '')
      );
      
      if (isEmptyRow) {
        consecutiveEmptyRows++;
        console.log(`⚠️ Ligne vide détectée: ${i + 1}, consécutives: ${consecutiveEmptyRows}`);
        
        // Arrêter si trop de lignes vides consécutives
        if (consecutiveEmptyRows >= MAX_CONSECUTIVE_EMPTY) {
          console.log(`🛑 Arrêt du traitement: ${MAX_CONSECUTIVE_EMPTY} lignes vides consécutives atteintes à la ligne ${i + 1}`);
          break;
        }
        continue;
      }
      
      // Réinitialiser le compteur si on trouve une ligne valide
      consecutiveEmptyRows = 0;
      validRows.push(row);
    }
    
    console.log(`📊 Filtrage terminé: ${validRows.length - 1} lignes valides (headers exclus)`);
    return validRows;
  }

  // Nouvelle méthode qui remplace processCollectionReportExcel
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

  private async processCollectionsWithTraceability(
    jsonData: any[][],
    options: ExcelProcessingOptions,
    results: ProcessingResults
  ) {
    const collections = [];
    const headers = jsonData[0];
    let duplicatesPrevented = 0;
    const totalRows = jsonData.length - 1; // Exclure les headers

    console.log(`📋 Traitement de ${totalRows} lignes de collections avec traçabilité`);

    for (let rowIndex = 1; rowIndex < jsonData.length; rowIndex++) {
      const row = jsonData[rowIndex];
      const excelSourceRow = rowIndex + 1; // +1 car Excel commence à 1, pas 0
      
      // ⭐ PROGRESSION GRANULAIRE: Mettre à jour tous les 10 lignes
      if (rowIndex % 10 === 0) {
        const progressPercent = Math.floor((rowIndex / totalRows) * 100);
        console.log(`📊 Progression traitement: ${progressPercent}% (${rowIndex}/${totalRows})`);
      }
      
      try {
        // Vérifier si cette ligne spécifique a déjà été traitée
        if (options.preventDuplicates && !options.forceReprocess) {
          const existingRow = await this.checkSpecificRowExists(options.filename, excelSourceRow);
          if (existingRow) {
            console.log(`🚫 Ligne ${excelSourceRow} déjà traitée, ignorée`);
            duplicatesPrevented++;
            results.warnings.push(`Ligne ${excelSourceRow} ignorée (déjà traitée le ${new Date(existingRow.excelProcessedAt || '').toLocaleString('fr-FR')})`);
            continue;
          }
        }

        // Convertir le tableau en objet avec les headers comme clés
        const rowObject: any = {};
        headers.forEach((header: string, index: number) => {
          rowObject[header] = row[index];
        });

        // Traiter la ligne normalement en utilisant la méthode correcte
        const collection = excelMappingService.transformExcelRowToSupabase(rowObject, excelSourceRow);
        
        if (collection) {
          // Ajouter les métadonnées de traçabilité
          collection.excelSourceRow = excelSourceRow;
          collection.excelFilename = options.filename;
          collection.excelProcessedAt = new Date().toISOString();
          
          collections.push(collection);
          console.log(`✅ Ligne ${excelSourceRow}: ${collection.clientCode} - ${collection.collectionAmount} FCFA`);
        }
      } catch (error) {
        console.error(`❌ Erreur ligne ${excelSourceRow}:`, error);
        results.errors.push(`Ligne ${excelSourceRow}: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
      }
    }

    results.duplicatesPrevented = (results.duplicatesPrevented || 0) + duplicatesPrevented;
    console.log(`🚫 ${duplicatesPrevented} doublons évités sur cette feuille`);
    
    return collections;
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
        firstImport: collections.length > 0 ? collections[0].excelProcessedAt : null,
        lastImport: collections.length > 0 ? collections[collections.length - 1].excelProcessedAt : null,
        sourceRows: collections.map(c => c.excelSourceRow).filter(Boolean)
      };
    } catch (error) {
      console.error('❌ Erreur historique import:', error);
      return null;
    }
  }
}

export const excelProcessingService = new ExcelProcessingService();

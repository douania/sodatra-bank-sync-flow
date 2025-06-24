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

        // Traitement spécifique pour les collections
        if (sheetName.toLowerCase().includes('collection') || jsonData.length > 0) {
          const processedCollections = await this.processCollectionsWithTraceability(
            jsonData as any[][],
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

    console.log(`📋 Traitement de ${jsonData.length - 1} lignes de collections avec traçabilité`);

    for (let rowIndex = 1; rowIndex < jsonData.length; rowIndex++) {
      const row = jsonData[rowIndex];
      const excelSourceRow = rowIndex + 1; // +1 car Excel commence à 1, pas 0
      
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

        // Traiter la ligne normalement en utilisant la méthode correcte
        const collection = excelMappingService.mapCollectionFromRow(headers, row);
        
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

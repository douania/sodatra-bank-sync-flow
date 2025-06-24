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

        // ⭐ AMÉLIORATION: Filtrer les lignes invalides avec détection renforcée
        const validRows = this.filterValidRowsEnhanced(jsonData as any[][]);
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

  // ⭐ NOUVELLE MÉTHODE AMÉLIORÉE: Filtrer les lignes invalides avec détection renforcée
  private filterValidRowsEnhanced(jsonData: any[][]): any[][] {
    const headers = jsonData[0];
    const validRows = [headers]; // Garder les headers
    
    let consecutiveEmptyRows = 0;
    let consecutiveInvalidRows = 0;
    const MAX_CONSECUTIVE_EMPTY = 3; // ⭐ RÉDUIT de 5 à 3
    const MAX_CONSECUTIVE_INVALID = 5; // Nouveau seuil pour les lignes avec données invalides
    
    console.log(`🔍 === DÉBUT FILTRAGE AVANCÉ ===`);
    console.log(`📋 Headers détectés:`, headers?.slice(0, 5)); // Afficher les 5 premiers headers
    
    for (let i = 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      const rowNumber = i + 1; // +1 car Excel commence à 1
      
      // ⭐ AMÉLIORATION 1: Vérifier si la ligne est complètement vide
      const isCompletelyEmpty = !row || row.length === 0 || row.every(cell => 
        cell === null || 
        cell === undefined || 
        cell === '' || 
        (typeof cell === 'string' && cell.trim() === '')
      );
      
      // ⭐ AMÉLIORATION 2: Détecter les valeurs "undefined" (chaîne de caractères)
      const hasUndefinedStrings = row && row.some(cell => 
        cell === 'undefined' || 
        (typeof cell === 'string' && cell.toLowerCase().includes('undefined'))
      );
      
      // ⭐ AMÉLIORATION 3: Validation des données critiques (code client et montant)
      const hasCriticalData = this.hasValidCriticalData(row, headers);
      
      // ⭐ AMÉLIORATION 4: Détection des lignes avec données partielles suspectes
      const hasPartialInvalidData = row && row.filter(cell => 
        cell !== null && 
        cell !== undefined && 
        cell !== '' && 
        !(typeof cell === 'string' && cell.trim() === '')
      ).length > 0 && !hasCriticalData;
      
      // Log détaillé pour le débogage
      if (rowNumber % 50 === 0 || hasUndefinedStrings || hasPartialInvalidData) {
        console.log(`🔍 Ligne ${rowNumber}:`, {
          isEmpty: isCompletelyEmpty,
          hasUndefined: hasUndefinedStrings,
          hasCritical: hasCriticalData,
          hasPartialInvalid: hasPartialInvalidData,
          sampleData: row?.slice(0, 3)
        });
      }
      
      // ⭐ DÉCISION: Ignorer la ligne si elle est invalide
      if (isCompletelyEmpty) {
        consecutiveEmptyRows++;
        consecutiveInvalidRows = 0;
        console.log(`⚠️ Ligne vide détectée: ${rowNumber}, consécutives: ${consecutiveEmptyRows}`);
        
        if (consecutiveEmptyRows >= MAX_CONSECUTIVE_EMPTY) {
          console.log(`🛑 Arrêt du traitement: ${MAX_CONSECUTIVE_EMPTY} lignes vides consécutives atteintes à la ligne ${rowNumber}`);
          break;
        }
        continue;
      }
      
      if (hasUndefinedStrings || !hasCriticalData) {
        consecutiveInvalidRows++;
        consecutiveEmptyRows = 0;
        console.log(`⚠️ Ligne invalide détectée: ${rowNumber}`, {
          hasUndefined: hasUndefinedStrings,
          lacksCritical: !hasCriticalData,
          consecutive: consecutiveInvalidRows
        });
        
        if (consecutiveInvalidRows >= MAX_CONSECUTIVE_INVALID) {
          console.log(`🛑 Arrêt du traitement: ${MAX_CONSECUTIVE_INVALID} lignes invalides consécutives atteintes à la ligne ${rowNumber}`);
          break;
        }
        continue;
      }
      
      // ⭐ LIGNE VALIDE: Réinitialiser les compteurs et ajouter la ligne
      consecutiveEmptyRows = 0;
      consecutiveInvalidRows = 0;
      validRows.push(row);
      
      if (validRows.length % 100 === 0) {
        console.log(`✅ ${validRows.length - 1} lignes valides ajoutées jusqu'à la ligne ${rowNumber}`);
      }
    }
    
    console.log(`📊 === FILTRAGE TERMINÉ ===`);
    console.log(`✅ Lignes valides finales: ${validRows.length - 1} (headers exclus)`);
    console.log(`🚫 Lignes ignorées: ${jsonData.length - validRows.length}`);
    
    return validRows;
  }
  
  // ⭐ NOUVELLE MÉTHODE: Valider les données critiques d'une ligne
  private hasValidCriticalData(row: any[], headers: any[]): boolean {
    if (!row || !headers) return false;
    
    // Chercher les colonnes critiques dans les headers
    const clientCodeIndex = headers.findIndex(header => 
      header && typeof header === 'string' && 
      (header.toLowerCase().includes('client') || header.toLowerCase().includes('code'))
    );
    
    const amountIndex = headers.findIndex(header => 
      header && typeof header === 'string' && 
      (header.toLowerCase().includes('montant') || 
       header.toLowerCase().includes('amount') || 
       header.toLowerCase().includes('collection'))
    );
    
    // Vérifier si les données critiques sont présentes et valides
    const hasValidClientCode = clientCodeIndex >= 0 && 
      row[clientCodeIndex] && 
      row[clientCodeIndex] !== 'undefined' &&
      typeof row[clientCodeIndex] === 'string' &&
      row[clientCodeIndex].trim().length > 0;
    
    const hasValidAmount = amountIndex >= 0 && 
      row[amountIndex] && 
      row[amountIndex] !== 'undefined' &&
      (typeof row[amountIndex] === 'number' || 
       (typeof row[amountIndex] === 'string' && !isNaN(parseFloat(row[amountIndex])))) &&
      parseFloat(row[amountIndex].toString()) > 0;
    
    return hasValidClientCode && hasValidAmount;
  }

  // ⭐ MÉTHODE DÉPRÉCIÉE: Remplacée par filterValidRowsEnhanced
  private filterValidRows(jsonData: any[][]): any[][] {
    console.log('⚠️ Utilisation de l\'ancienne méthode filterValidRows - utilisez filterValidRowsEnhanced');
    return this.filterValidRowsEnhanced(jsonData);
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

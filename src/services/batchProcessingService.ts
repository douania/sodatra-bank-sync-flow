
import { summarizeExtractionErrors } from './extractionErrorSummary';
import { CollectionReport } from '@/types/banking';
import { SupabaseRetryService } from './supabaseClientService';
import { progressService } from './progressService';

export interface BatchProcessingConfig {
  batchSize: number;
  pauseBetweenBatchesMs: number;
  maxConcurrentBatches: number;
  enableProgressTracking: boolean;
}

const DEFAULT_CONFIG: BatchProcessingConfig = {
  batchSize: 50,
  pauseBetweenBatchesMs: 200,
  maxConcurrentBatches: 3,
  enableProgressTracking: true
};

export interface BatchProcessingResult {
  success: boolean;
  totalProcessed: number;
  totalFailed: number;
  results: any[];
  errors: string[];
  processingTime: number;
}

export class BatchProcessingService {
  
  static async processCollectionsBatch(
    collections: CollectionReport[],
    processor: (batch: CollectionReport[]) => Promise<any>,
    config: Partial<BatchProcessingConfig> = {},
    stepId = 'batch_processing'
  ): Promise<BatchProcessingResult> {
    
    const finalConfig = { ...DEFAULT_CONFIG, ...config };
    const startTime = Date.now();
    
    console.log(`🔄 === DÉBUT TRAITEMENT PAR BATCH ===`);
    console.log(`📊 ${collections.length} collections à traiter`);
    console.log(`📦 Taille des lots: ${finalConfig.batchSize}`);
    console.log(`⏱️ Pause entre lots: ${finalConfig.pauseBetweenBatchesMs}ms`);
    
    const batches = this.createBatches(collections, finalConfig.batchSize);
    const results: any[] = [];
    const errors: string[] = [];
    let totalProcessed = 0;
    let totalFailed = 0;

    if (finalConfig.enableProgressTracking) {
      progressService.startStep(stepId, 'Traitement par lots', `${batches.length} lots à traiter`);
    }

    // ⭐ TRAITEMENT SÉQUENTIEL DES LOTS (plus stable que concurrent)
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchNumber = i + 1;
      
      try {
        console.log(`📦 Traitement du lot ${batchNumber}/${batches.length} (${batch.length} éléments)`);
        
        const batchResult = await SupabaseRetryService.executeWithRetry(
          () => processor(batch),
          { maxRetries: 2 },
          `Lot ${batchNumber}`
        );
        
        results.push(batchResult);
        totalProcessed += batch.length;
        
        // ⭐ MISE À JOUR DU PROGRÈS
        if (finalConfig.enableProgressTracking) {
          const progress = (batchNumber / batches.length) * 100;
          progressService.updateStepProgress(
            stepId,
            'Traitement par lots',
            `Lot ${batchNumber}/${batches.length} terminé`,
            progress,
            `${totalProcessed} collections traitées`
          );
        }
        
        console.log(`✅ Lot ${batchNumber} traité avec succès`);
        
        // ⭐ PAUSE ENTRE LES LOTS
        if (i < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, finalConfig.pauseBetweenBatchesMs));
        }
        
      } catch (error) {
        // Pack 2 (FIX_6) : motif fermé seulement, jamais le message d'origine.
        const errorMsg = `Erreur lot ${batchNumber} : ${summarizeExtractionErrors(error instanceof Error ? [error.message] : undefined)}`;
        console.error(`❌ ${errorMsg}`);
        errors.push(errorMsg);
        totalFailed += batch.length;
        
        // ⭐ DÉCISION: continuer ou arrêter ?
        // Pour l'instant, on continue avec les autres lots
        continue;
      }
    }

    const processingTime = Date.now() - startTime;
    
    if (finalConfig.enableProgressTracking) {
      if (errors.length === 0) {
        progressService.completeStep(
          stepId,
          'Traitement par lots',
          'Tous les lots traités',
          `${totalProcessed} collections traitées en ${Math.round(processingTime/1000)}s`
        );
      } else {
        progressService.errorStep(
          stepId,
          'Traitement par lots',
          'Certains lots ont échoué',
          `${errors.length} erreurs sur ${batches.length} lots`
        );
      }
    }

    const result: BatchProcessingResult = {
      success: errors.length === 0,
      totalProcessed,
      totalFailed,
      results,
      errors,
      processingTime
    };

    console.log(`📊 === RÉSUMÉ TRAITEMENT PAR BATCH ===`);
    console.log(`✅ Succès: ${result.success}`);
    console.log(`📦 Lots traités: ${batches.length}`);
    console.log(`📊 Collections traitées: ${totalProcessed}`);
    console.log(`❌ Collections échouées: ${totalFailed}`);
    console.log(`⏱️ Temps total: ${Math.round(processingTime/1000)}s`);
    console.log(`🚀 Vitesse: ${Math.round(totalProcessed / (processingTime/1000))} collections/s`);

    return result;
  }

  // ⭐ DÉCOUPAGE EN LOTS
  private static createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    
    return batches;
  }

  // ⭐ TRAITEMENT CONCURRENT (optionnel, plus risqué)
  static async processCollectionsConcurrent(
    collections: CollectionReport[],
    processor: (batch: CollectionReport[]) => Promise<any>,
    config: Partial<BatchProcessingConfig> = {}
  ): Promise<BatchProcessingResult> {
    
    const finalConfig = { ...DEFAULT_CONFIG, ...config };
    const startTime = Date.now();
    
    console.log(`🔄 === DÉBUT TRAITEMENT CONCURRENT ===`);
    console.log(`📊 ${collections.length} collections à traiter`);
    console.log(`📦 ${finalConfig.maxConcurrentBatches} lots simultanés`);
    
    const batches = this.createBatches(collections, finalConfig.batchSize);
    const results: any[] = [];
    const errors: string[] = [];
    
    // ⭐ TRAITEMENT PAR GROUPES CONCURRENTS
    for (let i = 0; i < batches.length; i += finalConfig.maxConcurrentBatches) {
      const batchGroup = batches.slice(i, i + finalConfig.maxConcurrentBatches);
      
      const batchPromises = batchGroup.map(async (batch, index) => {
        try {
          const batchNumber = i + index + 1;
          console.log(`📦 Démarrage lot concurrent ${batchNumber}`);
          
          const result = await processor(batch);
          console.log(`✅ Lot concurrent ${batchNumber} terminé`);
          return { success: true, result, batch };
        } catch (error) {
          console.error(`❌ Lot concurrent échoué:`, error);
          return { success: false, error, batch };
        }
      });
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      batchResults.forEach((promiseResult, index) => {
        if (promiseResult.status === 'fulfilled') {
          const { success, result, error } = promiseResult.value;
          if (success) {
            results.push(result);
          } else {
            errors.push(`Erreur lot concurrent: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
          }
        } else {
          errors.push(`Promise rejetée: ${promiseResult.reason}`);
        }
      });
      
      // Pause entre les groupes concurrents
      if (i + finalConfig.maxConcurrentBatches < batches.length) {
        await new Promise(resolve => setTimeout(resolve, finalConfig.pauseBetweenBatchesMs * 2));
      }
    }

    const processingTime = Date.now() - startTime;
    
    return {
      success: errors.length === 0,
      totalProcessed: collections.length - errors.length,
      totalFailed: errors.length,
      results,
      errors,
      processingTime
    };
  }
}

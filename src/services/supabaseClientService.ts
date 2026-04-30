import { supabase } from '@/integrations/supabase/client';

// ⭐ Utiliser le client Supabase partagé pour bénéficier de la session d'authentification
export const supabaseOptimized = supabase;

// ⭐ SERVICE DE RETRY AUTOMATIQUE
interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  exponentialBase: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  baseDelay: 1000, // 1 seconde
  maxDelay: 30000, // 30 secondes max
  exponentialBase: 2,
};

export class SupabaseRetryService {
  private static calculateDelay(attempt: number, config: RetryConfig): number {
    const delay = config.baseDelay * Math.pow(config.exponentialBase, attempt);
    return Math.min(delay, config.maxDelay);
  }

  static async executeWithRetry<T>(
    operation: () => Promise<T>,
    config: Partial<RetryConfig> = {},
    operationName = 'Supabase Operation'
  ): Promise<T> {
    const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
    let lastError: Error;

    console.log(`🔄 Début ${operationName} avec retry (max ${finalConfig.maxRetries} tentatives)`);

    for (let attempt = 0; attempt <= finalConfig.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = this.calculateDelay(attempt - 1, finalConfig);
          console.log(`⏳ Tentative ${attempt}/${finalConfig.maxRetries} après ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        const result = await operation();
        
        if (attempt > 0) {
          console.log(`✅ ${operationName} réussie après ${attempt} tentatives`);
        }
        
        return result;
      } catch (error) {
        lastError = error as Error;
        const isConnectionError = error instanceof Error && (
          error.message.includes('timeout') ||
          error.message.includes('connection') ||
          error.message.includes('network') ||
          error.message.includes('ECONNRESET') ||
          error.message.includes('ETIMEDOUT')
        );

        if (!isConnectionError || attempt === finalConfig.maxRetries) {
          console.error(`❌ ${operationName} échec définitif:`, error);
          throw error;
        }

        console.warn(`⚠️ ${operationName} tentative ${attempt + 1} échouée:`, error.message);
      }
    }

    throw lastError!;
  }

  // ⭐ MÉTHODES SPÉCIALISÉES POUR LES OPÉRATIONS COMMUNES
  static async insertWithRetry<T>(
    data: any,
    operationName?: string
  ): Promise<T> {
    return this.executeWithRetry(
      async () => {
        const { data: result, error } = await supabaseOptimized.from('collection_report').insert(data);
        if (error) throw error;
        return result as T;
      },
      { maxRetries: 3 },
      operationName || 'Insert dans collection_report'
    );
  }

  static async selectWithRetry<T>(
    queryBuilder: any,
    operationName?: string
  ): Promise<T> {
    return this.executeWithRetry(
      async () => {
        const { data, error } = await queryBuilder;
        if (error) throw error;
        return data as T;
      },
      { maxRetries: 5, baseDelay: 500 },
      operationName || 'Select query'
    );
  }

  static async batchInsertWithRetry<T>(
    dataArray: any[],
    batchSize = 50,
    operationName?: string
  ): Promise<T[]> {
    const results: T[] = [];
    const totalBatches = Math.ceil(dataArray.length / batchSize);

    console.log(`📦 Insertion par batch: ${dataArray.length} éléments en ${totalBatches} lots de ${batchSize}`);

    for (let i = 0; i < dataArray.length; i += batchSize) {
      const batch = dataArray.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;

      try {
        const result = await this.executeWithRetry(
          async () => {
            const { data, error } = await supabaseOptimized.from('collection_report').insert(batch);
            if (error) throw error;
            return data;
          },
          { maxRetries: 3 },
          `${operationName || 'Batch Insert'} ${batchNumber}/${totalBatches}`
        );

        results.push(result as T);

        // ⭐ PAUSE ENTRE LES LOTS pour éviter la surcharge
        if (i + batchSize < dataArray.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }

      } catch (error) {
        console.error(`❌ Erreur batch ${batchNumber}:`, error);
        throw error;
      }
    }

    return results;
  }
}

// ⭐ HEARTBEAT SERVICE pour maintenir la connexion
export class HeartbeatService {
  private static intervalId: ReturnType<typeof setInterval> | null = null;
  private static isActive = false;

  static start(intervalMs = 30000) { // 30 secondes
    if (this.isActive) return;

    console.log('💓 Démarrage du heartbeat Supabase');
    this.isActive = true;

    this.intervalId = setInterval(async () => {
      try {
        await supabaseOptimized
          .from('collection_report')
          .select('id')
          .limit(1);
        
        console.log('💓 Heartbeat OK');
      } catch (error) {
        console.warn('💓 Heartbeat failed:', error);
      }
    }, intervalMs);
  }

  static stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.isActive = false;
      console.log('💓 Arrêt du heartbeat');
    }
  }
}


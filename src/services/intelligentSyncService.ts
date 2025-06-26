import { supabaseOptimized, SupabaseRetryService } from './supabaseClientService';
import { CollectionReport } from '@/types/banking';
import { excelMappingService } from './excelMappingService';

export enum CollectionStatus {
  NEW = 'NEW',
  EXISTS_COMPLETE = 'EXISTS_COMPLETE',
  EXISTS_INCOMPLETE = 'EXISTS_INCOMPLETE',
  UPDATED = 'UPDATED'
}

export interface EnrichmentOpportunity {
  type: 'BANK_CREDIT' | 'BANK_COMMISSION' | 'STATUS_UPDATE' | 'REFERENCE_UPDATE';
  field: string;
  newValue: any;
  source: 'BANK_STATEMENT' | 'EXCEL_UPDATE' | 'MANUAL_INPUT';
  confidence: number;
}

export interface CollectionComparison {
  excelRow: any;
  existingRecord?: CollectionReport;
  status: CollectionStatus;
  missingFields: string[];
  enrichmentOpportunities: EnrichmentOpportunity[];
  collectionKey: string;
}

export interface SyncResult {
  new_collections: number;
  enriched_collections: number;
  ignored_collections: number;
  errors: Array<{ collection: any; error: string }>;
  summary: {
    total_processed: number;
    enrichments: {
      date_of_validity_added: number;
      bank_commissions_added: number;
      references_updated: number;
      statuses_updated: number;
    };
  };
}

export interface BankMatch {
  deposit: any;
  confidence: number;
  value_date?: string;
  commission?: number;
  reference?: string;
}

export class IntelligentSyncService {

  // ⭐ GÉNÉRATION DE CLÉ UNIQUE RENFORCÉE avec traçabilité
  static generateCollectionKey(row: any): string {
    const components = [
      row.reportDate || row.date || '',
      row.clientCode || row.client_name || '',
      row.bankName || row.bank || '',
      row.collectionAmount || row.amount || '0',
      row.factureNo || row.facture_no || 'NO_FACTURE'
    ];
    
    const key = components.join('|');
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  // ⭐ CONVERSION CORRECTE depuis la DB vers CollectionReport
  private convertDbToCollectionReport(dbRecord: any): CollectionReport {
    return {
      id: dbRecord.id,
      reportDate: dbRecord.report_date,
      clientCode: dbRecord.client_code,
      collectionAmount: dbRecord.collection_amount,
      bankName: dbRecord.bank_name,
      status: dbRecord.status as 'pending' | 'processed' | 'failed',
      commission: dbRecord.commission,
      dateOfValidity: dbRecord.date_of_validity,
      nj: dbRecord.nj,
      taux: dbRecord.taux,
      interet: dbRecord.interet,
      tob: dbRecord.tob,
      fraisEscompte: dbRecord.frais_escompte,
      bankCommission: dbRecord.bank_commission,
      dNAmount: dbRecord.d_n_amount,
      income: dbRecord.income,
      dateOfImpay: dbRecord.date_of_impay,
      reglementImpaye: dbRecord.reglement_impaye,
      creditedDate: dbRecord.credited_date,
      remarques: dbRecord.remarques,
      factureNo: dbRecord.facture_no,
      noChqBd: dbRecord.no_chq_bd,
      bankNameDisplay: dbRecord.bank_name_display,
      depoRef: dbRecord.depo_ref,
      processingStatus: dbRecord.processing_status,
      matchedBankDepositId: dbRecord.matched_bank_deposit_id,
      matchConfidence: dbRecord.match_confidence,
      matchMethod: dbRecord.match_method,
      sgOrFaNo: dbRecord.sg_or_fa_no,
      processedAt: dbRecord.processed_at,
      excelSourceRow: dbRecord.excel_source_row,
      excelFilename: dbRecord.excel_filename,
      excelProcessedAt: dbRecord.excel_processed_at
    };
  }

  // ⭐ ANALYSE OPTIMISÉE pour gestion quotidienne
  async analyzeExcelFile(excelData: any[]): Promise<CollectionComparison[]> {
    console.log('🔍 DÉBUT ANALYSE QUOTIDIENNE OPTIMISÉE - Collections:', excelData.length);
    
    const comparisons: CollectionComparison[] = [];
    
    // ⭐ OPTIMISATION: Requête groupée pour réduire les appels DB
    const clientCodes = [...new Set(excelData.map(row => row.clientCode).filter(Boolean))];
    const reportDates = [...new Set(excelData.map(row => row.reportDate).filter(Boolean))];
    
    console.log(`🔍 Chargement optimisé: ${clientCodes.length} codes clients, ${reportDates.length} dates`);
    
    // Pré-charger les collections existantes par lot
    const existingCollections = await this.batchLoadExistingCollections(clientCodes, reportDates);
    
    for (let i = 0; i < excelData.length; i++) {
      const excelRow = excelData[i];
      
      try {
        const collectionKey = IntelligentSyncService.generateCollectionKey(excelRow);
        
        // ⭐ RECHERCHE OPTIMISÉE dans les collections pré-chargées
        const existingRecord = this.findExistingInBatch(excelRow, existingCollections);
        
        const comparison = await this.determineCollectionStatusOptimized(excelRow, existingRecord, collectionKey);
        comparisons.push(comparison);
        
        if ((i + 1) % 100 === 0) {
          console.log(`🔍 Analyse: ${i + 1}/${excelData.length} (${Math.round((i + 1) / excelData.length * 100)}%)`);
        }
        
      } catch (error) {
        console.error(`❌ Erreur analyse ligne ${i + 1}:`, error);
        comparisons.push({
          excelRow,
          status: CollectionStatus.NEW,
          missingFields: [],
          enrichmentOpportunities: [],
          collectionKey: 'ERROR'
        });
      }
    }
    
    const summary = this.generateAnalysisSummary(comparisons);
    console.log('📊 RÉSUMÉ ANALYSE QUOTIDIENNE:', summary);
    
    return comparisons;
  }

  // ⭐ CHARGEMENT PAR LOT des collections existantes
  private async batchLoadExistingCollections(clientCodes: string[], reportDates: string[]): Promise<CollectionReport[]> {
    try {
      const collections = await SupabaseRetryService.executeWithRetry(
        async () => {
          const { data, error } = await supabaseOptimized
            .from('collection_report')
            .select('*')
            .in('client_code', clientCodes.slice(0, 1000)) // Limite pour éviter les requêtes trop grandes
            .in('report_date', reportDates.slice(0, 100));
          
          if (error) throw error;
          return data;
        }
      );
      
      console.log(`📦 Collections pré-chargées: ${collections?.length || 0}`);
      
      // ⭐ CONVERSION CORRECTE vers CollectionReport[]
      const convertedCollections: CollectionReport[] = (collections || []).map(existing => 
        this.convertDbToCollectionReport(existing)
      );
      
      return convertedCollections;
    } catch (error) {
      console.warn('⚠️ Erreur chargement par lot:', error);
      return [];
    }
  }

  // ⭐ RECHERCHE dans le lot pré-chargé
  private findExistingInBatch(excelRow: any, existingCollections: CollectionReport[]): CollectionReport | null {
    return existingCollections.find(existing => 
      existing.clientCode === excelRow.clientCode &&
      existing.reportDate === excelRow.reportDate &&
      Math.abs(existing.collectionAmount - excelRow.collectionAmount) < 0.01 // Tolérance pour les décimales
    ) || null;
  }

  // ⭐ DÉTERMINATION INTELLIGENTE DU STATUT
  private async determineCollectionStatusOptimized(
    excelRow: any, 
    existingRecord: CollectionReport | null,
    collectionKey: string
  ): Promise<CollectionComparison> {
    
    if (!existingRecord) {
      return {
        excelRow,
        status: CollectionStatus.NEW,
        missingFields: [],
        enrichmentOpportunities: [],
        collectionKey
      };
    }
    
    // ⭐ ANALYSE D'ENRICHISSEMENT
    const missingFields = this.identifyMissingFields(existingRecord);
    const enrichmentOpportunities = await this.identifyEnrichmentOpportunitiesOptimized(excelRow, existingRecord);
    
    if (missingFields.length === 0 && enrichmentOpportunities.length === 0) {
      return {
        excelRow,
        existingRecord,
        status: CollectionStatus.EXISTS_COMPLETE,
        missingFields: [],
        enrichmentOpportunities: [],
        collectionKey
      };
    } else {
      return {
        excelRow,
        existingRecord,
        status: CollectionStatus.EXISTS_INCOMPLETE,
        missingFields,
        enrichmentOpportunities,
        collectionKey
      };
    }
  }

  
  // ⭐ IDENTIFICATION DES OPPORTUNITÉS D'ENRICHISSEMENT
  private async identifyEnrichmentOpportunitiesOptimized(
    excelRow: any, 
    existingRecord: CollectionReport
  ): Promise<EnrichmentOpportunity[]> {
    
    const opportunities: EnrichmentOpportunity[] = [];
    
    // ⭐ ENRICHISSEMENT INTELLIGENT champ par champ
    const enrichmentFields = [
      { excel: 'dateOfValidity', db: 'dateOfValidity', type: 'BANK_CREDIT', confidence: 0.95 },
      { excel: 'bankCommission', db: 'bankCommission', type: 'BANK_COMMISSION', confidence: 0.90 },
      { excel: 'interet', db: 'interet', type: 'BANK_COMMISSION', confidence: 0.85 },
      { excel: 'tob', db: 'tob', type: 'BANK_COMMISSION', confidence: 0.85 },
      { excel: 'fraisEscompte', db: 'fraisEscompte', type: 'BANK_COMMISSION', confidence: 0.85 },
      { excel: 'income', db: 'income', type: 'BANK_COMMISSION', confidence: 0.85 },
      { excel: 'noChqBd', db: 'noChqBd', type: 'REFERENCE_UPDATE', confidence: 0.80 },
      { excel: 'sgOrFaNo', db: 'sgOrFaNo', type: 'REFERENCE_UPDATE', confidence: 0.80 },
      { excel: 'depoRef', db: 'depoRef', type: 'REFERENCE_UPDATE', confidence: 0.80 },
      { excel: 'remarques', db: 'remarques', type: 'REFERENCE_UPDATE', confidence: 0.75 }
    ];
    
    for (const field of enrichmentFields) {
      const excelValue = excelRow[field.excel];
      const dbValue = (existingRecord as any)[field.db];
      
      // ⭐ LOGIQUE D'ENRICHISSEMENT INTELLIGENT
      if (this.shouldEnrichField(excelValue, dbValue)) {
        opportunities.push({
          type: field.type as any,
          field: field.db,
          newValue: excelValue,
          source: 'EXCEL_UPDATE',
          confidence: field.confidence
        });
      }
    }
    
    return opportunities;
  }

  // ⭐ LOGIQUE DÉCISION D'ENRICHISSEMENT
  private shouldEnrichField(excelValue: any, dbValue: any): boolean {
    // Valeur Excel existe et DB est vide/null
    if (excelValue && (!dbValue || dbValue === null || dbValue === '')) {
      return true;
    }
    
    // Valeur Excel plus récente/complète que DB
    if (excelValue && dbValue && excelValue !== dbValue) {
      // Pour les dates, prendre la plus récente
      if (typeof excelValue === 'string' && excelValue.includes('-') && 
          typeof dbValue === 'string' && dbValue.includes('-')) {
        return new Date(excelValue) > new Date(dbValue);
      }
      
      // Pour les montants, prendre la valeur non-zéro
      if (typeof excelValue === 'number' && typeof dbValue === 'number') {
        return excelValue > 0 && dbValue === 0;
      }
      
      // Pour les textes, prendre la valeur plus longue (plus d'info)
      if (typeof excelValue === 'string' && typeof dbValue === 'string') {
        return excelValue.length > dbValue.length;
      }
    }
    
    return false;
  }

  // ⭐ SYNCHRONISATION QUOTIDIENNE OPTIMISÉE avec UPSERT
  async processIntelligentSync(comparisons: CollectionComparison[]): Promise<SyncResult> {
    console.log('🔄 DÉBUT SYNCHRONISATION QUOTIDIENNE OPTIMISÉE');
    
    const result: SyncResult = {
      new_collections: 0,
      enriched_collections: 0,
      ignored_collections: 0,
      errors: [],
      summary: {
        total_processed: 0,
        enrichments: {
          date_of_validity_added: 0,
          bank_commissions_added: 0,
          references_updated: 0,
          statuses_updated: 0
        }
      }
    };
    
    // ⭐ TRAITEMENT PAR LOTS pour améliorer les performances
    const batchSize = 50;
    const batches = [];
    for (let i = 0; i < comparisons.length; i += batchSize) {
      batches.push(comparisons.slice(i, i + batchSize));
    }
    
    console.log(`🔄 Traitement par lots: ${batches.length} lots de ${batchSize} max`);
    
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(`🔄 Lot ${batchIndex + 1}/${batches.length}: ${batch.length} collections`);
      
      for (const comparison of batch) {
        try {
          switch (comparison.status) {
            case CollectionStatus.NEW:
              await this.upsertNewCollection(comparison.excelRow);
              result.new_collections++;
              break;
              
            case CollectionStatus.EXISTS_INCOMPLETE:
              const enrichmentResult = await this.enrichExistingCollection(comparison);
              result.enriched_collections++;
              
              // ⭐ COMPTABILISATION DES ENRICHISSEMENTS
              for (const enrichment of enrichmentResult.enrichments) {
                if (enrichment.field === 'dateOfValidity') result.summary.enrichments.date_of_validity_added++;
                if (['bankCommission', 'interet', 'tob', 'fraisEscompte', 'income'].includes(enrichment.field)) {
                  result.summary.enrichments.bank_commissions_added++;
                }
                if (['noChqBd', 'sgOrFaNo', 'depoRef'].includes(enrichment.field)) {
                  result.summary.enrichments.references_updated++;
                }
              }
              break;
              
            case CollectionStatus.EXISTS_COMPLETE:
              result.ignored_collections++;
              break;
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Erreur inconnue';
          result.errors.push({
            collection: comparison.excelRow,
            error: errorMsg
          });
          console.error(`❌ Erreur traitement collection:`, errorMsg);
        }
      }
    }

    result.summary.total_processed = result.new_collections + result.enriched_collections + result.ignored_collections;
    
    console.log('📊 SYNCHRONISATION QUOTIDIENNE TERMINÉE:', {
      nouvelles: result.new_collections,
      enrichies: result.enriched_collections,
      ignorées: result.ignored_collections,
      erreurs: result.errors.length
    });
    
    return result;
  }

  // ⭐ UPSERT POUR ÉVITER LES VIOLATIONS DE CONTRAINTES
  private async upsertNewCollection(excelRow: any): Promise<void> {
    const collectionData = {
      report_date: excelRow.reportDate,
      client_code: excelRow.clientCode,
      collection_amount: excelRow.collectionAmount,
      bank_name: excelRow.bankName || '',
      status: excelRow.status || 'pending',
      
      // Logique métier effet/chèque
      collection_type: excelRow.collectionType || 'UNKNOWN',
      effet_echeance_date: excelRow.effetEcheanceDate || null,
      effet_status: excelRow.effetStatus || null,
      cheque_number: excelRow.chequeNumber || null,
      cheque_status: excelRow.chequeStatus || null,
      
      // ⭐ TRAÇABILITÉ AMÉLIORÉE
      excel_filename: excelRow.excelFilename || 'DAILY_IMPORT',
      excel_source_row: excelRow.excelSourceRow || 0,
      excel_processed_at: new Date().toISOString(),
      
      // Tous les champs disponibles
      date_of_validity: excelRow.dateOfValidity || null,
      facture_no: excelRow.factureNo || null,
      no_chq_bd: excelRow.noChqBd || null, // Conserver la valeur brute
      bank_name_display: excelRow.bankNameDisplay || null,
      depo_ref: excelRow.depoRef || null,
      nj: excelRow.nj || null,
      taux: excelRow.taux || null,
      interet: excelRow.interet || null,
      commission: excelRow.commission || null,
      tob: excelRow.tob || null,
      frais_escompte: excelRow.fraisEscompte || null,
      bank_commission: excelRow.bankCommission || null,
      sg_or_fa_no: excelRow.sgOrFaNo || null,
      d_n_amount: excelRow.dNAmount || null,
      income: excelRow.income || null,
      date_of_impay: excelRow.dateOfImpay || null,
      reglement_impaye: excelRow.reglementImpaye || null,
      remarques: excelRow.remarques || null,
      
      processing_status: 'NEW',
      processed_at: new Date().toISOString()
    };
    
    try {
      // ⭐ UTILISER UPSERT AVEC LE NOUVEL INDEX FIXE
      
      // Détecter le type de collection si non spécifié
      if (!collectionData.collection_type && collectionData.no_chq_bd) {
        const typeResult = excelMappingService.detectCollectionType(collectionData.no_chq_bd);
        collectionData.collection_type = typeResult.type;
        collectionData.effet_echeance_date = typeResult.effetEcheanceDate ? 
          typeResult.effetEcheanceDate.toISOString().split('T')[0] : null;
        collectionData.effet_status = typeResult.type === 'EFFET' ? 'PENDING' : null;
        collectionData.cheque_number = typeResult.chequeNumber;
        collectionData.cheque_status = typeResult.type === 'CHEQUE' ? 'PENDING' : null;
      }
      
      await SupabaseRetryService.executeWithRetry(
        async () => {
          const { error } = await supabaseOptimized
            .from('collection_report')
            .upsert(collectionData, {
              onConflict: 'idx_collection_excel_upsert_constraint',
              ignoreDuplicates: false
            });
          
          if (error) throw error;
          return { success: true };
        }
      );
      
    } catch (error: any) {
      console.warn(`⚠️ Upsert collection avec index fixe:`, error.message);
      
      // ⭐ FALLBACK: Vérifier si l'enregistrement existe déjà
      if (error.message.includes('constraint') || error.message.includes('unique') || error.message.includes('conflict')) {
        console.log(`🔄 Fallback: Vérification existence pour ${excelRow.clientCode}`);
        
        // Vérifier si l'enregistrement existe déjà
        const existingData = await SupabaseRetryService.executeWithRetry(
          async () => {
            const { data, error: selectError } = await supabaseOptimized
              .from('collection_report')
              .select('id')
              .eq('excel_filename', collectionData.excel_filename)
              .eq('excel_source_row', collectionData.excel_source_row)
              .maybeSingle();
            
            if (selectError) throw new Error(`Erreur sélection: ${selectError.message}`);
            return data;
          }
        );
        
        if (existingData?.id) {
          // Mise à jour si existe
          console.log(`🔄 Mise à jour de l'enregistrement existant: ${existingData.id}`);
          await SupabaseRetryService.executeWithRetry(
            async () => {
              const { error: updateError } = await supabaseOptimized
                .from('collection_report')
                .update(collectionData)
                .eq('id', existingData.id);
                
              if (updateError) throw new Error(`Erreur mise à jour: ${updateError.message}`);
              return { success: true };
            }
          );
          return;
        } else {
          // Insertion si n'existe pas
          console.log(`🔄 Insertion nouvelle collection (fallback)`);
          await SupabaseRetryService.executeWithRetry(
            async () => {
              const { error: insertError } = await supabaseOptimized
                .from('collection_report')
                .insert(collectionData);
                
              if (insertError) throw new Error(`Erreur insertion: ${insertError.message}`);
              return { success: true };
            }
          );
          return;
        }
      }
      
      throw new Error(`Erreur upsert: ${error.message}`);
    }
  }

  private identifyMissingFields(record: CollectionReport): string[] {
    const missingFields: string[] = [];
    
    const criticalFields = [
      'dateOfValidity',
      'bankCommission',
      'income',
      'noChqBd',
      'sgOrFaNo',
      'depoRef'
    ];
    
    for (const field of criticalFields) {
      const value = (record as any)[field];
      if (!value || value === null || value === '' || value === 0) {
        missingFields.push(field);
      }
    }
    
    return missingFields;
  }

  private async enrichExistingCollection(comparison: CollectionComparison): Promise<{
    enrichments: Array<{ field: string; oldValue: any; newValue: any; source: string }>
  }> {
    const updates: any = {};
    const enrichments: Array<{ field: string; oldValue: any; newValue: any; source: string }> = [];
    
    for (const opportunity of comparison.enrichmentOpportunities) {
      if (opportunity.confidence > 0.7) { // Seuil plus bas pour permettre plus d'enrichissements
        const oldValue = (comparison.existingRecord as any)![opportunity.field];
        
        // Convertir les noms de champs vers la base de données
        const dbFieldMapping: { [key: string]: string } = {
          dateOfValidity: 'date_of_validity',
          bankCommission: 'bank_commission',
          noChqBd: 'no_chq_bd',
          sgOrFaNo: 'sg_or_fa_no',
          depoRef: 'depo_ref',
          fraisEscompte: 'frais_escompte'
        };
        
        const dbField = dbFieldMapping[opportunity.field] || opportunity.field;
        updates[dbField] = opportunity.newValue;
        
        enrichments.push({
          field: opportunity.field,
          oldValue,
          newValue: opportunity.newValue,
          source: opportunity.source
        });
      }
    }
    
    if (Object.keys(updates).length > 0) {
      updates.excel_processed_at = new Date().toISOString();
      updates.processing_status = 'ENRICHED';
      
      await SupabaseRetryService.executeWithRetry(
        async () => {
          const { error } = await supabaseOptimized
            .from('collection_report')
            .update(updates)
            .eq('id', comparison.existingRecord!.id);
          
          if (error) throw new Error(`Erreur enrichissement: ${error.message}`);
          return { success: true };
        }
      );
    }
    
    return { enrichments };
  }

  private generateAnalysisSummary(comparisons: CollectionComparison[]) {
    const summary = {
      total: comparisons.length,
      new: comparisons.filter(c => c.status === CollectionStatus.NEW).length,
      to_enrich: comparisons.filter(c => c.status === CollectionStatus.EXISTS_INCOMPLETE).length,
      complete: comparisons.filter(c => c.status === CollectionStatus.EXISTS_COMPLETE).length,
      missing_date_validity: comparisons.filter(c => c.missingFields.includes('dateOfValidity')).length,
      enrichment_opportunities: comparisons.reduce((sum, c) => sum + c.enrichmentOpportunities.length, 0)
    };
    
    return summary;
  }
}

export const intelligentSyncService = new IntelligentSyncService();

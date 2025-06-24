import { supabase } from '@/integrations/supabase/client';
import { CollectionReport } from '@/types/banking';

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
      row.factureNo || row.facture_no || 'NO_FACTURE',
      // ⭐ AJOUT: Traçabilité Excel dans la clé
      row.excel_filename || '',
      row.excel_source_row || '0'
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

  // ⭐ ANALYSE OPTIMISÉE avec vérification de traçabilité stricte
  async analyzeExcelFile(excelData: any[]): Promise<CollectionComparison[]> {
    console.log('🔍 DÉBUT ANALYSE INTELLIGENTE OPTIMISÉE - Collections:', excelData.length);
    
    const comparisons: CollectionComparison[] = [];
    
    // ⭐ OPTIMISATION: Requête groupée pour réduire les appels DB
    const clientCodes = excelData.map(row => row.clientCode).filter(Boolean);
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
        
        // ⭐ VÉRIFICATION STRICTE DE TRAÇABILITÉ
        const isStrictDuplicate = await this.checkStrictTraceabilityDuplicate(excelRow);
        
        if (isStrictDuplicate) {
          console.log(`🚫 Doublon strict détecté: ${excelRow.clientCode} (ligne ${excelRow.excel_source_row})`);
          comparisons.push({
            excelRow,
            status: CollectionStatus.EXISTS_COMPLETE,
            missingFields: [],
            enrichmentOpportunities: [],
            collectionKey: 'STRICT_DUPLICATE'
          });
          continue;
        }
        
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
    console.log('📊 RÉSUMÉ ANALYSE OPTIMISÉE:', summary);
    
    return comparisons;
  }

  // ⭐ NOUVELLE MÉTHODE: Vérification stricte de doublon par traçabilité
  private async checkStrictTraceabilityDuplicate(excelRow: any): Promise<boolean> {
    if (!excelRow.excel_filename || !excelRow.excel_source_row) {
      return false; // Pas de traçabilité = pas de vérification possible
    }
    
    try {
      const { data: existing } = await supabase
        .from('collection_report')
        .select('id')
        .eq('excel_filename', excelRow.excel_filename)
        .eq('excel_source_row', excelRow.excel_source_row)
        .maybeSingle();
      
      return existing !== null;
    } catch (error) {
      console.warn('⚠️ Erreur vérification traçabilité stricte:', error);
      return false;
    }
  }

  // ⭐ NOUVELLE MÉTHODE: Chargement par lot des collections existantes
  private async batchLoadExistingCollections(clientCodes: string[], reportDates: string[]): Promise<any[]> {
    try {
      const { data: collections } = await supabase
        .from('collection_report')
        .select('*')
        .in('client_code', clientCodes.slice(0, 1000)) // Limite pour éviter les requêtes trop grandes
        .in('report_date', reportDates.slice(0, 100));
      
      console.log(`📦 Collections pré-chargées: ${collections?.length || 0}`);
      return collections || [];
    } catch (error) {
      console.warn('⚠️ Erreur chargement par lot:', error);
      return [];
    }
  }

  // ⭐ NOUVELLE MÉTHODE: Recherche dans le lot pré-chargé
  private findExistingInBatch(excelRow: any, existingCollections: any[]): any | null {
    return existingCollections.find(existing => 
      existing.client_code === excelRow.clientCode &&
      existing.report_date === excelRow.reportDate &&
      existing.collection_amount === excelRow.collectionAmount
    ) || null;
  }

  // ⭐ DÉTERMINATION OPTIMISÉE DU STATUT
  private async determineCollectionStatusOptimized(
    excelRow: any, 
    existingRecord: any,
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

  // ⭐ OPTIMISATION: Enrichissement sans requêtes supplémentaires
  private async identifyEnrichmentOpportunitiesOptimized(
    excelRow: any, 
    existingRecord: any
  ): Promise<EnrichmentOpportunity[]> {
    
    const opportunities: EnrichmentOpportunity[] = [];
    
    // ⭐ ENRICHISSEMENT DIRECT (sans requêtes DB supplémentaires)
    const enrichmentFields = [
      { excel: 'dateOfValidity', db: 'date_of_validity', type: 'BANK_CREDIT', confidence: 0.95 },
      { excel: 'bankCommission', db: 'bank_commission', type: 'BANK_COMMISSION', confidence: 0.90 },
      { excel: 'interet', db: 'interet', type: 'BANK_COMMISSION', confidence: 0.85 },
      { excel: 'tob', db: 'tob', type: 'BANK_COMMISSION', confidence: 0.85 },
      { excel: 'fraisEscompte', db: 'frais_escompte', type: 'BANK_COMMISSION', confidence: 0.85 },
      { excel: 'income', db: 'income', type: 'BANK_COMMISSION', confidence: 0.85 },
      { excel: 'noChqBd', db: 'no_chq_bd', type: 'REFERENCE_UPDATE', confidence: 0.80 },
      { excel: 'sgOrFaNo', db: 'sg_or_fa_no', type: 'REFERENCE_UPDATE', confidence: 0.80 },
      { excel: 'depoRef', db: 'depo_ref', type: 'REFERENCE_UPDATE', confidence: 0.80 }
    ];
    
    for (const field of enrichmentFields) {
      if (!existingRecord[field.db] && excelRow[field.excel]) {
        opportunities.push({
          type: field.type as any,
          field: field.db,
          newValue: excelRow[field.excel],
          source: 'EXCEL_UPDATE',
          confidence: field.confidence
        });
      }
    }
    
    return opportunities;
  }

  // ⭐ SYNCHRONISATION AVEC GESTION D'ERREURS STRICTE
  async processIntelligentSync(comparisons: CollectionComparison[]): Promise<SyncResult> {
    console.log('🔄 DÉBUT SYNCHRONISATION INTELLIGENTE OPTIMISÉE');
    
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
              await this.insertNewCollectionWithTraceability(comparison.excelRow);
              result.new_collections++;
              break;
              
            case CollectionStatus.EXISTS_INCOMPLETE:
              const enrichmentResult = await this.enrichExistingCollection(comparison);
              result.enriched_collections++;
              
              for (const enrichment of enrichmentResult.enrichments) {
                if (enrichment.field === 'date_of_validity') result.summary.enrichments.date_of_validity_added++;
                if (enrichment.field.includes('commission')) result.summary.enrichments.bank_commissions_added++;
                if (['no_chq_bd', 'sg_or_fa_no', 'depo_ref'].includes(enrichment.field)) result.summary.enrichments.references_updated++;
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
    
    console.log('📊 SYNCHRONISATION OPTIMISÉE TERMINÉE:', {
      nouvelles: result.new_collections,
      enrichies: result.enriched_collections,
      ignorées: result.ignored_collections,
      erreurs: result.errors.length
    });
    
    return result;
  }

  // ⭐ INSERTION AVEC TRAÇABILITÉ OBLIGATOIRE
  private async insertNewCollectionWithTraceability(excelRow: any): Promise<void> {
    const collectionData = {
      report_date: excelRow.reportDate,
      client_code: excelRow.clientCode,
      collection_amount: excelRow.collectionAmount,
      bank_name: excelRow.bankName || '',
      status: excelRow.status || 'pending',
      
      // ⭐ TRAÇABILITÉ OBLIGATOIRE
      excel_filename: excelRow.excel_filename,
      excel_source_row: excelRow.excel_source_row,
      excel_processed_at: new Date().toISOString(),
      
      // Toutes les autres colonnes
      date_of_validity: excelRow.dateOfValidity || null,
      facture_no: excelRow.factureNo || null,
      no_chq_bd: excelRow.noChqBd || null,
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
    
    // ⭐ VÉRIFICATION TRAÇABILITÉ AVANT INSERTION
    if (!collectionData.excel_filename || !collectionData.excel_source_row) {
      throw new Error(`Traçabilité manquante: filename=${collectionData.excel_filename}, row=${collectionData.excel_source_row}`);
    }
    
    const { error } = await supabase
      .from('collection_report')
      .insert(collectionData);
    
    if (error) {
      // ⭐ GESTION SPÉCIALE DES ERREURS DE CONTRAINTE UNIQUE
      if (error.code === '23505' && error.message.includes('unique_excel_traceability')) {
        throw new Error(`Doublon détecté par contrainte: ${collectionData.excel_filename}:${collectionData.excel_source_row}`);
      }
      throw new Error(`Erreur insertion: ${error.message}`);
    }
  }

  private identifyMissingFields(record: any): string[] {
    const missingFields: string[] = [];
    
    const criticalFields = [
      'date_of_validity',
      'bank_commission',
      'income',
      'no_chq_bd',
      'sg_or_fa_no',
      'depo_ref',
      'interet',
      'tob',
      'frais_escompte'
    ];
    
    for (const field of criticalFields) {
      const value = record[field];
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
      if (opportunity.confidence > 0.8) {
        const oldValue = comparison.existingRecord![opportunity.field];
        updates[opportunity.field] = opportunity.newValue;
        
        enrichments.push({
          field: opportunity.field,
          oldValue,
          newValue: opportunity.newValue,
          source: opportunity.source
        });
      }
    }
    
    if (Object.keys(updates).length > 0) {
      updates.last_enriched_at = new Date().toISOString();
      updates.enrichment_source = comparison.enrichmentOpportunities
        .filter(o => o.confidence > 0.8)
        .map(o => o.source)
        .join(',');
      
      const { error } = await supabase
        .from('collection_report')
        .update(updates)
        .eq('id', comparison.existingRecord!.id);
      
      if (error) {
        throw new Error(`Erreur enrichissement: ${error.message}`);
      }
    }
    
    return { enrichments };
  }

  private generateAnalysisSummary(comparisons: CollectionComparison[]) {
    const summary = {
      total: comparisons.length,
      new: comparisons.filter(c => c.status === CollectionStatus.NEW).length,
      to_enrich: comparisons.filter(c => c.status === CollectionStatus.EXISTS_INCOMPLETE).length,
      complete: comparisons.filter(c => c.status === CollectionStatus.EXISTS_COMPLETE).length,
      missing_date_validity: comparisons.filter(c => c.missingFields.includes('date_of_validity')).length,
      enrichment_opportunities: comparisons.reduce((sum, c) => sum + c.enrichmentOpportunities.length, 0)
    };
    
    return summary;
  }

  private addDays(dateString: string, days: number): string {
    const date = new Date(dateString);
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
  }
}

export const intelligentSyncService = new IntelligentSyncService();


import { supabase } from '@/integrations/supabase/client';
import { CollectionReport } from '@/types/banking';
import { createHash } from 'crypto';

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

  // ⭐ GÉNÉRATION DE CLÉ UNIQUE POUR IDENTIFICATION
  static generateCollectionKey(row: any): string {
    const components = [
      row.reportDate || row.date || '',
      row.clientCode || row.client_name || '',
      row.bankName || row.bank || '',
      row.collectionAmount || row.amount || '0',
      row.factureNo || row.facture_no || 'NO_FACTURE'
    ];
    
    const key = components.join('|');
    return createHash('md5').update(key).digest('hex');
  }

  // ⭐ ANALYSE COMPLÈTE DU FICHIER EXCEL
  async analyzeExcelFile(excelData: any[]): Promise<CollectionComparison[]> {
    console.log('🔍 DÉBUT ANALYSE INTELLIGENTE - Collections:', excelData.length);
    
    const comparisons: CollectionComparison[] = [];
    
    for (let i = 0; i < excelData.length; i++) {
      const excelRow = excelData[i];
      
      try {
        // 1. Générer la clé d'identification unique
        const collectionKey = IntelligentSyncService.generateCollectionKey(excelRow);
        
        // 2. Chercher dans la base de données
        const { data: existingRecord } = await supabase
          .from('collection_report')
          .select('*')
          .eq('client_code', excelRow.clientCode)
          .eq('report_date', excelRow.reportDate)
          .eq('collection_amount', excelRow.collectionAmount)
          .maybeSingle();
        
        // 3. Déterminer le statut et les actions
        const comparison = await this.determineCollectionStatus(excelRow, existingRecord, collectionKey);
        comparisons.push(comparison);
        
        console.log(`🔍 [${i + 1}/${excelData.length}] Analyse: ${comparison.status}`, {
          key: collectionKey.substring(0, 8),
          client: excelRow.clientCode,
          amount: excelRow.collectionAmount,
          missingFields: comparison.missingFields.length,
          enrichments: comparison.enrichmentOpportunities.length
        });
        
      } catch (error) {
        console.error(`❌ Erreur analyse ligne ${i + 1}:`, error);
        comparisons.push({
          excelRow,
          status: CollectionStatus.NEW, // Par défaut, traiter comme nouveau
          missingFields: [],
          enrichmentOpportunities: [],
          collectionKey: 'ERROR'
        });
      }
    }
    
    // 📊 RÉSUMÉ DE L'ANALYSE
    const summary = this.generateAnalysisSummary(comparisons);
    console.log('📊 RÉSUMÉ ANALYSE INTELLIGENTE:', summary);
    
    return comparisons;
  }

  // ⭐ DÉTERMINATION DU STATUT DE CHAQUE COLLECTION
  private async determineCollectionStatus(
    excelRow: any, 
    existingRecord: any,
    collectionKey: string
  ): Promise<CollectionComparison> {
    
    if (!existingRecord) {
      // ✅ NOUVELLE COLLECTION
      return {
        excelRow,
        status: CollectionStatus.NEW,
        missingFields: [],
        enrichmentOpportunities: [],
        collectionKey
      };
    }
    
    // 🔍 ANALYSER LES CHAMPS MANQUANTS ET OPPORTUNITÉS
    const missingFields = this.identifyMissingFields(existingRecord);
    const enrichmentOpportunities = await this.identifyEnrichmentOpportunities(excelRow, existingRecord);
    
    if (missingFields.length === 0 && enrichmentOpportunities.length === 0) {
      // ✅ COLLECTION COMPLÈTE - IGNORER
      return {
        excelRow,
        existingRecord,
        status: CollectionStatus.EXISTS_COMPLETE,
        missingFields: [],
        enrichmentOpportunities: [],
        collectionKey
      };
    } else {
      // ⚡ COLLECTION À ENRICHIR
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

  // ⭐ IDENTIFICATION DES CHAMPS MANQUANTS
  private identifyMissingFields(record: any): string[] {
    const missingFields: string[] = [];
    
    // ⭐ CHAMPS CRITIQUES À VÉRIFIER
    const criticalFields = [
      'date_of_validity',    // Date de crédit banque (PRIORITÉ ABSOLUE)
      'bank_commission',     // Commission bancaire
      'income',             // Revenu net
      'no_chq_bd',          // Numéro chèque/bordereau
      'sg_or_fa_no',        // Référence SG/FA
      'depo_ref',           // Référence dépôt
      'interet',            // Intérêt
      'tob',                // TOB
      'frais_escompte'      // Frais d'escompte
    ];
    
    for (const field of criticalFields) {
      const value = record[field];
      if (!value || value === null || value === '' || value === 0) {
        missingFields.push(field);
      }
    }
    
    return missingFields;
  }

  // ⭐ IDENTIFICATION DES OPPORTUNITÉS D'ENRICHISSEMENT
  private async identifyEnrichmentOpportunities(
    excelRow: any, 
    existingRecord: any
  ): Promise<EnrichmentOpportunity[]> {
    
    const opportunities: EnrichmentOpportunity[] = [];
    
    // ⭐ ENRICHISSEMENT DATE OF VALIDITY (PRIORITÉ MAXIMALE)
    if (!existingRecord.date_of_validity && excelRow.dateOfValidity) {
      opportunities.push({
        type: 'BANK_CREDIT',
        field: 'date_of_validity',
        newValue: excelRow.dateOfValidity,
        source: 'EXCEL_UPDATE',
        confidence: 0.95
      });
    }
    
    // ⭐ ENRICHISSEMENT COMMISSIONS BANCAIRES
    if (!existingRecord.bank_commission && excelRow.bankCommission) {
      opportunities.push({
        type: 'BANK_COMMISSION',
        field: 'bank_commission',
        newValue: excelRow.bankCommission,
        source: 'EXCEL_UPDATE',
        confidence: 0.90
      });
    }
    
    // ⭐ ENRICHISSEMENT CALCULS FINANCIERS
    const financialFields = [
      { excel: 'interet', db: 'interet' },
      { excel: 'tob', db: 'tob' },
      { excel: 'fraisEscompte', db: 'frais_escompte' },
      { excel: 'income', db: 'income' }
    ];
    
    for (const field of financialFields) {
      if (!existingRecord[field.db] && excelRow[field.excel]) {
        opportunities.push({
          type: 'BANK_COMMISSION',
          field: field.db,
          newValue: excelRow[field.excel],
          source: 'EXCEL_UPDATE',
          confidence: 0.85
        });
      }
    }
    
    // ⭐ ENRICHISSEMENT RÉFÉRENCES
    const referenceFields = [
      { excel: 'noChqBd', db: 'no_chq_bd' },
      { excel: 'sgOrFaNo', db: 'sg_or_fa_no' },
      { excel: 'depoRef', db: 'depo_ref' }
    ];
    
    for (const field of referenceFields) {
      if (!existingRecord[field.db] && excelRow[field.excel]) {
        opportunities.push({
          type: 'REFERENCE_UPDATE',
          field: field.db,
          newValue: excelRow[field.excel],
          source: 'EXCEL_UPDATE',
          confidence: 0.80
        });
      }
    }
    
    // ⭐ RECHERCHE DE CORRESPONDANCES BANCAIRES (pour DATE OF VALIDITY)
    if (!existingRecord.date_of_validity) {
      const bankMatches = await this.findBankStatementMatches(existingRecord);
      
      for (const match of bankMatches) {
        if (match.value_date && match.confidence > 0.8) {
          opportunities.push({
            type: 'BANK_CREDIT',
            field: 'date_of_validity',
            newValue: match.value_date,
            source: 'BANK_STATEMENT',
            confidence: match.confidence
          });
        }
      }
    }
    
    return opportunities;
  }

  // ⭐ RECHERCHE DE CORRESPONDANCES DANS LES RELEVÉS BANCAIRES
  private async findBankStatementMatches(collection: any): Promise<BankMatch[]> {
    const matches: BankMatch[] = [];
    
    try {
      // 🔍 RECHERCHE DANS LES DÉPÔTS NON DÉBITÉS
      const { data: bankDeposits } = await supabase
        .from('deposits_not_cleared')
        .select('*')
        .eq('montant', collection.collection_amount)
        .gte('date_depot', collection.report_date)
        .lte('date_depot', this.addDays(collection.report_date, 30));
      
      for (const deposit of bankDeposits || []) {
        const confidence = this.calculateMatchConfidence(collection, deposit);
        
        if (confidence > 0.8) {
          matches.push({
            deposit,
            confidence,
            value_date: deposit.date_valeur || deposit.date_depot,
            commission: 0, // À calculer selon les règles métier
            reference: deposit.reference
          });
        }
      }
    } catch (error) {
      console.warn('⚠️ Erreur recherche correspondances bancaires:', error);
    }
    
    return matches;
  }

  // ⭐ CALCUL DE CONFIANCE POUR LE MATCHING
  private calculateMatchConfidence(collection: any, deposit: any): number {
    let confidence = 0;
    
    // ⭐ CRITÈRES DE MATCHING
    if (Math.abs(collection.collection_amount - deposit.montant) < 1000) confidence += 0.4;
    if (collection.bank_name === deposit.bank_name) confidence += 0.2;
    if (collection.facture_no && deposit.reference?.includes(collection.facture_no.toString())) confidence += 0.3;
    if (collection.client_code === deposit.client_code) confidence += 0.1;
    
    return Math.min(confidence, 1.0);
  }

  // ⭐ TRAITEMENT INTELLIGENT DE LA SYNCHRONISATION
  async processIntelligentSync(comparisons: CollectionComparison[]): Promise<SyncResult> {
    console.log('🔄 DÉBUT SYNCHRONISATION INTELLIGENTE');
    
    const result: SyncResult = {
      new_collections: 0,
      enriched_collections: 0,
      ignored_collections: 0,
      errors: [],
      summary: {
        total_processed: comparisons.length,
        enrichments: {
          date_of_validity_added: 0,
          bank_commissions_added: 0,
          references_updated: 0,
          statuses_updated: 0
        }
      }
    };
    
    for (let i = 0; i < comparisons.length; i++) {
      const comparison = comparisons[i];
      
      try {
        console.log(`🔄 [${i + 1}/${comparisons.length}] Traitement: ${comparison.status}`);
        
        switch (comparison.status) {
          case CollectionStatus.NEW:
            await this.insertNewCollection(comparison.excelRow);
            result.new_collections++;
            console.log(`✅ Nouvelle collection ajoutée: ${comparison.excelRow.clientCode}`);
            break;
            
          case CollectionStatus.EXISTS_INCOMPLETE:
            const enrichmentResult = await this.enrichExistingCollection(comparison);
            result.enriched_collections++;
            
            // Compter les types d'enrichissement
            for (const enrichment of enrichmentResult.enrichments) {
              if (enrichment.field === 'date_of_validity') result.summary.enrichments.date_of_validity_added++;
              if (enrichment.field.includes('commission')) result.summary.enrichments.bank_commissions_added++;
              if (['no_chq_bd', 'sg_or_fa_no', 'depo_ref'].includes(enrichment.field)) result.summary.enrichments.references_updated++;
            }
            
            console.log(`⚡ Collection enrichie: ${comparison.existingRecord?.client_code}`, enrichmentResult.enrichments);
            break;
            
          case CollectionStatus.EXISTS_COMPLETE:
            result.ignored_collections++;
            console.log(`✅ Collection complète ignorée: ${comparison.existingRecord?.client_code}`);
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
    
    // 📊 RÉSUMÉ FINAL
    console.log('📊 SYNCHRONISATION TERMINÉE:', {
      nouvelles: result.new_collections,
      enrichies: result.enriched_collections,
      ignorées: result.ignored_collections,
      erreurs: result.errors.length,
      enrichissements: result.summary.enrichments
    });
    
    return result;
  }

  // ⭐ INSERTION DE NOUVELLE COLLECTION
  private async insertNewCollection(excelRow: any): Promise<void> {
    const collectionData = {
      report_date: excelRow.reportDate,
      client_code: excelRow.clientCode,
      collection_amount: excelRow.collectionAmount,
      bank_name: excelRow.bankName || '',
      status: excelRow.status || 'pending',
      
      // Toutes les nouvelles colonnes
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
      
      // Métadonnées
      processing_status: 'NEW',
      processed_at: new Date().toISOString()
    };
    
    const { error } = await supabase
      .from('collection_report')
      .insert(collectionData);
    
    if (error) {
      throw new Error(`Erreur insertion: ${error.message}`);
    }
  }

  // ⭐ ENRICHISSEMENT SÉLECTIF D'UNE COLLECTION EXISTANTE
  private async enrichExistingCollection(comparison: CollectionComparison): Promise<{
    enrichments: Array<{ field: string; oldValue: any; newValue: any; source: string }>
  }> {
    const updates: any = {};
    const enrichments: Array<{ field: string; oldValue: any; newValue: any; source: string }> = [];
    
    // ⭐ APPLIQUER SEULEMENT LES ENRICHISSEMENTS À HAUTE CONFIANCE
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
    
    // ⭐ MÉTADONNÉES D'ENRICHISSEMENT
    if (Object.keys(updates).length > 0) {
      updates.last_enriched_at = new Date().toISOString();
      updates.enrichment_source = comparison.enrichmentOpportunities
        .filter(o => o.confidence > 0.8)
        .map(o => o.source)
        .join(',');
      
      // ⭐ MISE À JOUR SÉLECTIVE
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

  // ⭐ GÉNÉRATION DU RÉSUMÉ D'ANALYSE
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

  // ⭐ UTILITAIRE POUR AJOUTER DES JOURS
  private addDays(dateString: string, days: number): string {
    const date = new Date(dateString);
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
  }
}

export const intelligentSyncService = new IntelligentSyncService();

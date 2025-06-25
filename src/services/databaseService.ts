import { supabase } from '@/integrations/supabase/client';
import { BankReport, CollectionReport, FundPosition, ClientReconciliation } from '@/types/banking';
import type { DuplicateReport, DuplicateGroup, DuplicateRemovalResult } from '@/types/banking';

export class DatabaseService {
  
  async testConnection(): Promise<boolean> {
    // ⭐ TEST DE CONNEXION AVEC RETRY
    const { SupabaseRetryService } = await import('./supabaseClientService');
    
    try {
      await SupabaseRetryService.executeWithRetry(
        async () => {
          const { data, error } = await supabase
            .from('collection_report')
            .select('id')
            .limit(1);
          
          if (error) throw error;
          return data;
        },
        { maxRetries: 3, baseDelay: 500 },
        'Test de connexion'
      );
      
      return true;
    } catch (error) {
      console.error('Database connection test failed:', error);
      return false;
    }
  }

  async getCollectionCount(): Promise<number> {
    try {
      const { count, error } = await supabase
        .from('collection_report')
        .select('*', { count: 'exact', head: true });
      
      if (error) {
        console.error('Error getting collection count:', error);
        return 0;
      }
      
      return count || 0;
    } catch (error) {
      console.error('Error getting collection count:', error);
      return 0;
    }
  }

  async getCollectionReports(): Promise<CollectionReport[]> {
    try {
      const { data, error } = await supabase
        .from('collection_report')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching collection reports:', error);
        return [];
      }

      return (data || []).map(this.mapDbToCollectionReport);
    } catch (error) {
      console.error('Error fetching collection reports:', error);
      return [];
    }
  }

  async getLatestBankReports(): Promise<BankReport[]> {
    try {
      const { data, error } = await supabase
        .from('bank_reports')
        .select(`
          *,
          bank_facilities (*),
          deposits_not_cleared (*),
          impayes (*)
        `)
        .order('report_date', { ascending: false })
        .limit(10);

      if (error) {
        console.error('Error fetching bank reports:', error);
        return [];
      }

      return (data || []).map(this.mapDbToBankReport);
    } catch (error) {
      console.error('Error fetching bank reports:', error);
      return [];
    }
  }

  async getAllBankReports(): Promise<BankReport[]> {
    try {
      const { data, error } = await supabase
        .from('bank_reports')
        .select(`
          *,
          bank_facilities (*),
          deposits_not_cleared (*),
          impayes (*)
        `)
        .order('report_date', { ascending: false });

      if (error) {
        console.error('Error fetching all bank reports:', error);
        return [];
      }

      return (data || []).map(this.mapDbToBankReport);
    } catch (error) {
      console.error('Error fetching all bank reports:', error);
      return [];
    }
  }

  async getLatestFundPosition(): Promise<FundPosition | null> {
    try {
      const { data, error } = await supabase
        .from('fund_position')
        .select('*')
        .order('report_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Error fetching fund position:', error);
        return null;
      }

      if (!data) return null;

      return {
        reportDate: data.report_date,
        totalFundAvailable: data.total_fund_available,
        collectionsNotDeposited: data.collections_not_deposited,
        grandTotal: data.grand_total
      };
    } catch (error) {
      console.error('Error fetching fund position:', error);
      return null;
    }
  }

  async updateCollectionDateOfValidity(id: string, dateOfValidity: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('collection_report')
        .update({ date_of_validity: dateOfValidity })
        .eq('id', id);

      if (error) {
        console.error('Error updating collection date of validity:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error updating collection date of validity:', error);
      return false;
    }
  }

  async getCollectionsByFilename(filename: string): Promise<CollectionReport[]> {
    try {
      const { data, error } = await supabase
        .from('collection_report')
        .select('*')
        .eq('excel_filename', filename)
        .order('excel_source_row', { ascending: true });

      if (error) {
        console.error('Error fetching collections by filename:', error);
        return [];
      }

      return (data || []).map(this.mapDbToCollectionReport);
    } catch (error) {
      console.error('Error fetching collections by filename:', error);
      return [];
    }
  }

  async getCollectionByFileAndRow(filename: string, sourceRow: number): Promise<CollectionReport | null> {
    try {
      const { data, error } = await supabase
        .from('collection_report')
        .select('*')
        .eq('excel_filename', filename)
        .eq('excel_source_row', sourceRow)
        .maybeSingle();

      if (error) {
        console.error('Error fetching collection by file and row:', error);
        return null;
      }

      return data ? this.mapDbToCollectionReport(data) : null;
    } catch (error) {
      console.error('Error fetching collection by file and row:', error);
      return null;
    }
  }

  async getCollectionByFileAndRowStrict(filename: string, sourceRow: number): Promise<CollectionReport | null> {
    try {
      const { data, error } = await supabase
        .from('collection_report')
        .select('*')
        .eq('excel_filename', filename)
        .eq('excel_source_row', sourceRow)
        .maybeSingle();

      if (error) {
        console.error('Error fetching collection by file and row (strict):', error);
        return null;
      }

      return data ? this.mapDbToCollectionReport(data) : null;
    } catch (error) {
      console.error('Error fetching collection by file and row (strict):', error);
      return null;
    }
  }

  async detectDuplicates(): Promise<DuplicateReport> {
    try {
      console.log('🔍 Analyse des doublons en cours...');
      
      // Requête pour détecter les groupes de doublons
      const { data: duplicateData, error } = await supabase
        .from('collection_report')
        .select('client_code, collection_amount, report_date, bank_name, facture_no')
        .order('client_code, collection_amount, report_date');

      if (error) {
        console.error('Error detecting duplicates:', error);
        return {
          totalCollections: 0,
          totalDuplicates: 0,
          uniqueCollections: 0,
          duplicateGroups: []
        };
      }

      // Grouper par clé unique
      const groups = new Map<string, any[]>();
      
      for (const row of duplicateData || []) {
        const key = `${row.client_code}-${row.collection_amount}-${row.report_date}-${row.bank_name || ''}-${row.facture_no || ''}`;
        if (!groups.has(key)) {
          groups.set(key, []);
        }
        groups.get(key)!.push(row);
      }

      // Identifier les groupes avec doublons
      const duplicateGroups: DuplicateGroup[] = [];
      let totalDuplicates = 0;

      for (const [key, items] of groups.entries()) {
        if (items.length > 1) {
          // Récupérer les détails complets pour ce groupe
          const { data: fullItems, error: detailError } = await supabase
            .from('collection_report')
            .select('*')
            .eq('client_code', items[0].client_code)
            .eq('collection_amount', items[0].collection_amount)
            .eq('report_date', items[0].report_date);

          if (!detailError && fullItems) {
            duplicateGroups.push({
              count: items.length,
              collections: fullItems.map(this.mapDbToCollectionReport)
            });
            totalDuplicates += items.length - 1; // -1 car on garde l'original
          }
        }
      }

      const totalCollections = duplicateData?.length || 0;
      const uniqueCollections = totalCollections - totalDuplicates;

      return {
        totalCollections,
        totalDuplicates,
        uniqueCollections,
        duplicateGroups
      };
    } catch (error) {
      console.error('Error detecting duplicates:', error);
      return {
        totalCollections: 0,
        totalDuplicates: 0,
        uniqueCollections: 0,
        duplicateGroups: []
      };
    }
  }

  async removeDuplicates(duplicateGroups: DuplicateGroup[]): Promise<DuplicateRemovalResult> {
    try {
      let totalDeleted = 0;

      for (const group of duplicateGroups) {
        if (group.collections.length > 1) {
          // Garder le premier (plus ancien), supprimer les autres
          const toDelete = group.collections.slice(1);
          
          for (const collection of toDelete) {
            const { error } = await supabase
              .from('collection_report')
              .delete()
              .eq('id', collection.id);

            if (error) {
              console.error('Error deleting duplicate:', error);
            } else {
              totalDeleted++;
            }
          }
        }
      }

      return {
        success: true,
        data: { deletedCount: totalDeleted }
      };
    } catch (error) {
      console.error('Error removing duplicates:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erreur inconnue'
      };
    }
  }

  // Missing methods for fileProcessingService
  async saveBankReport(report: BankReport): Promise<{ success: boolean; error?: string }> {
    // ⭐ SAUVEGARDE AVEC RETRY
    const { SupabaseRetryService } = await import('./supabaseClientService');
    
    try {
      await SupabaseRetryService.executeWithRetry(
        async () => {
          const { error } = await supabase
            .from('bank_reports')
            .insert({
              bank_name: report.bank,
              report_date: report.date,
              opening_balance: report.openingBalance,
              closing_balance: report.closingBalance
            });

          if (error) throw error;
        },
        { maxRetries: 3 },
        `Sauvegarde rapport ${report.bank}`
      );

      return { success: true };
    } catch (error) {
      console.error('Error saving bank report:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Erreur inconnue' };
    }
  }

  // ⭐ CORRECTION FUND POSITION - Arrondir avant insertion
  async saveFundPosition(fundPosition: FundPosition): Promise<{ success: boolean; error?: string }> {
    // ⭐ SAUVEGARDE FUND POSITION AVEC RETRY ET ARRONDISSEMENT
    const { SupabaseRetryService } = await import('./supabaseClientService');
    
    try {
      console.log('💾 === SAUVEGARDE FUND POSITION OPTIMISÉE ===');
      console.log('📊 Valeurs reçues:', {
        totalFundAvailable: fundPosition.totalFundAvailable,
        collectionsNotDeposited: fundPosition.collectionsNotDeposited,
        grandTotal: fundPosition.grandTotal
      });
      
      // ⭐ ARRONDIR AVANT INSERTION pour éviter l'erreur bigint
      const roundedFundPosition = {
        report_date: fundPosition.reportDate,
        total_fund_available: Math.round(fundPosition.totalFundAvailable),
        collections_not_deposited: Math.round(fundPosition.collectionsNotDeposited),
        grand_total: Math.round(fundPosition.grandTotal)
      };
      
      console.log('🔢 Valeurs arrondies pour insertion:', roundedFundPosition);
      
      await SupabaseRetryService.executeWithRetry(
        async () => {
          const { error } = await supabase
            .from('fund_position')
            .insert(roundedFundPosition);

          if (error) throw error;
        },
        { maxRetries: 3 },
        'Sauvegarde Fund Position'
      );

      console.log('✅ Fund Position sauvegardée avec succès (optimisée)');
      return { success: true };
    } catch (error) {
      console.error('❌ Erreur critique sauvegarde Fund Position:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Erreur inconnue' };
    }
  }

  async getTotalCollections(): Promise<number> {
    // ⭐ CALCUL TOTAL AVEC RETRY
    const { SupabaseRetryService } = await import('./supabaseClientService');
    
    try {
      const data = await SupabaseRetryService.executeWithRetry(
        async () => {
          const { data, error } = await supabase
            .from('collection_report')
            .select('collection_amount');

          if (error) throw error;
          return data;
        },
        { maxRetries: 3 },
        'Calcul total collections'
      );

      // ⭐ ARRONDIR le total pour éviter les décimales
      const total = (data || []).reduce((sum, item) => sum + (item.collection_amount || 0), 0);
      return Math.round(total);
    } catch (error) {
      console.error('Error getting total collections:', error);
      return 0;
    }
  }

  async getClientsWithCollections(): Promise<{ clientCode: string; clientName?: string }[]> {
    try {
      const { data, error } = await supabase
        .from('collection_report')
        .select('client_code')
        .order('client_code');

      if (error) {
        console.error('Error getting clients with collections:', error);
        return [];
      }

      // Get unique client codes
      const uniqueClients = [...new Set((data || []).map(item => item.client_code))];
      
      return uniqueClients.map(clientCode => ({
        clientCode,
        clientName: `Client ${clientCode}`
      }));
    } catch (error) {
      console.error('Error getting clients with collections:', error);
      return [];
    }
  }

  private mapDbToCollectionReport(data: any): CollectionReport {
    return {
      id: data.id,
      reportDate: data.report_date,
      clientCode: data.client_code,
      collectionAmount: data.collection_amount,
      bankName: data.bank_name,
      status: data.status,
      commission: data.commission,
      dateOfValidity: data.date_of_validity,
      nj: data.nj,
      taux: data.taux,
      interet: data.interet,
      tob: data.tob,
      fraisEscompte: data.frais_escompte,
      bankCommission: data.bank_commission,
      dNAmount: data.d_n_amount,
      income: data.income,
      dateOfImpay: data.date_of_impay,
      reglementImpaye: data.reglement_impaye,
      creditedDate: data.credited_date,
      remarques: data.remarques,
      factureNo: data.facture_no,
      noChqBd: data.no_chq_bd,
      bankNameDisplay: data.bank_name_display,
      depoRef: data.depo_ref,
      processingStatus: data.processing_status,
      matchedBankDepositId: data.matched_bank_deposit_id,
      matchConfidence: data.match_confidence,
      matchMethod: data.match_method,
      sgOrFaNo: data.sg_or_fa_no,
      processedAt: data.processed_at,
      excelSourceRow: data.excel_source_row,
      excelFilename: data.excel_filename,
      excelProcessedAt: data.excel_processed_at
    };
  }

  private mapDbToBankReport(data: any): BankReport {
    return {
      id: data.id,
      bank: data.bank_name,
      date: data.report_date,
      openingBalance: data.opening_balance,
      closingBalance: data.closing_balance,
      bankFacilities: (data.bank_facilities || []).map((facility: any) => ({
        facilityType: facility.facility_type,
        limitAmount: facility.limit_amount,
        usedAmount: facility.used_amount,
        availableAmount: facility.available_amount
      })),
      depositsNotCleared: (data.deposits_not_cleared || []).map((deposit: any) => ({
        dateDepot: deposit.date_depot,
        dateValeur: deposit.date_valeur,
        typeReglement: deposit.type_reglement,
        reference: deposit.reference,
        clientCode: deposit.client_code,
        montant: deposit.montant
      })),
      checksNotCleared: [],
      impayes: (data.impayes || []).map((impaye: any) => ({
        dateRetour: impaye.date_retour,
        dateEcheance: impaye.date_echeance,
        clientCode: impaye.client_code,
        description: impaye.description,
        montant: impaye.montant
      }))
    };
  }
}

export const databaseService = new DatabaseService();
export type { DuplicateReport, DuplicateGroup, DuplicateRemovalResult };

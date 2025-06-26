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
        .update({ 
          date_of_validity: dateOfValidity,
          // Mettre à jour le statut en fonction du type de collection
          effet_status: 'PAID',
          cheque_status: 'CLEARED',
          status: 'processed'
        })
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

  // Nouvelle méthode pour marquer un effet comme impayé
  async markEffetAsImpaye(id: string, dateOfImpay: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('collection_report')
        .update({ 
          date_of_impay: dateOfImpay,
          effet_status: 'IMPAYE',
          status: 'failed'
        })
        .eq('id', id)
        .eq('collection_type', 'EFFET');

      if (error) {
        console.error('Error marking effet as impaye:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error marking effet as impaye:', error);
      return false;
    }
  }

  // Nouvelle méthode pour marquer un chèque comme rejeté
  async markChequeAsBounced(id: string, dateOfImpay: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('collection_report')
        .update({ 
          date_of_impay: dateOfImpay,
          cheque_status: 'BOUNCED',
          status: 'failed'
        })
        .eq('id', id)
        .eq('collection_type', 'CHEQUE');

      if (error) {
        console.error('Error marking cheque as bounced:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error marking cheque as bounced:', error);
      return false;
    }
  }

  // Méthode pour obtenir les effets à échéance
  async getUpcomingEffets(daysThreshold: number = 7): Promise<CollectionReport[]> {
    try {
      const today = new Date().toISOString().split('T')[0];
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + daysThreshold);
      const futureDateStr = futureDate.toISOString().split('T')[0];
      
      const { data, error } = await supabase
        .from('collection_report')
        .select('*')
        .eq('collection_type', 'EFFET')
        .eq('effet_status', 'PENDING')
        .gte('effet_echeance_date', today)
        .lte('effet_echeance_date', futureDateStr)
        .order('effet_echeance_date', { ascending: true });

      if (error) {
        console.error('Error fetching upcoming effets:', error);
        return [];
      }

      return (data || []).map(this.mapDbToCollectionReport);
    } catch (error) {
      console.error('Error fetching upcoming effets:', error);
      return [];
    }
  }

  // Méthode pour obtenir les effets échus non payés
  async getOverdueEffets(): Promise<CollectionReport[]> {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      const { data, error } = await supabase
        .from('collection_report')
        .select('*')
        .eq('collection_type', 'EFFET')
        .eq('effet_status', 'PENDING')
        .lt('effet_echeance_date', today)
        .order('effet_echeance_date', { ascending: true });

      if (error) {
        console.error('Error fetching overdue effets:', error);
        return [];
      }

      return (data || []).map(this.mapDbToCollectionReport);
    } catch (error) {
      console.error('Error fetching overdue effets:', error);
      return [];
    }
  }

  // Méthode pour obtenir les chèques en attente d'encaissement
  async getPendingCheques(): Promise<CollectionReport[]> {
    try {
      const { data, error } = await supabase
        .from('collection_report')
        .select('*')
        .eq('collection_type', 'CHEQUE')
        .eq('cheque_status', 'PENDING')
        .order('report_date', { ascending: true });

      if (error) {
        console.error('Error fetching pending cheques:', error);
        return [];
      }

      return (data || []).map(this.mapDbToCollectionReport);
    } catch (error) {
      console.error('Error fetching pending cheques:', error);
      return [];
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

  async getCollectionsByClient(clientCode: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('collection_report')
        .select('*')
        .eq('client_code', clientCode)
        .order('report_date', { ascending: false });

      if (error) {
        console.error('Erreur récupération collections client:', error);
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error('Erreur service collections client:', error);
      throw error;
    }
  }

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
      console.log('💾 === SAUVEGARDE FUND POSITION DÉTAILLÉE ===');
      console.log('📊 Valeurs reçues:', {
        totalFundAvailable: fundPosition.totalFundAvailable,
        collectionsNotDeposited: fundPosition.collectionsNotDeposited,
        grandTotal: fundPosition.grandTotal,
        depositForDay: fundPosition.depositForDay,
        paymentForDay: fundPosition.paymentForDay,
        details: fundPosition.details?.length || 0,
        holdCollections: fundPosition.holdCollections?.length || 0
      });
      
      // ⭐ ARRONDIR AVANT INSERTION pour éviter l'erreur bigint
      const roundedFundPosition = {
        report_date: fundPosition.reportDate,
        total_fund_available: Math.round(fundPosition.totalFundAvailable),
        collections_not_deposited: Math.round(fundPosition.collectionsNotDeposited),
        grand_total: Math.round(fundPosition.grandTotal),
        deposit_for_day: fundPosition.depositForDay ? Math.round(fundPosition.depositForDay) : null,
        payment_for_day: fundPosition.paymentForDay ? Math.round(fundPosition.paymentForDay) : null
      };
      
      console.log('🔢 Valeurs arrondies pour insertion:', roundedFundPosition);
      
      const { data: fundPositionData, error: fundPositionError } = await SupabaseRetryService.executeWithRetry(
        async () => {
          const { data, error } = await supabase
            .from('fund_position')
            .insert(roundedFundPosition)
            .select('id')
            .single();

          if (error) throw error;
          return { data, error };
        },
        { maxRetries: 3 },
        'Sauvegarde Fund Position'
      );
      
      if (fundPositionError) {
        throw fundPositionError;
      }
      
      const fundPositionId = fundPositionData.id;
      console.log(`✅ Fund Position principale sauvegardée avec ID: ${fundPositionId}`);
      
      // Sauvegarder les détails par banque si disponibles
      if (fundPosition.details && fundPosition.details.length > 0) {
        console.log(`💾 Sauvegarde de ${fundPosition.details.length} détails bancaires...`);
        
        const detailsToInsert = fundPosition.details.map(detail => ({
          fund_position_id: fundPositionId,
          bank_name: detail.bankName,
          balance: Math.round(detail.balance),
          fund_applied: Math.round(detail.fundApplied),
          net_balance: Math.round(detail.netBalance),
          non_validated_deposit: Math.round(detail.nonValidatedDeposit),
          grand_balance: Math.round(detail.grandBalance)
        }));
        
        await SupabaseRetryService.executeWithRetry(
          async () => {
            const { error } = await supabase
              .from('fund_position_detail')
              .insert(detailsToInsert);
            
            if (error) throw error;
          },
          { maxRetries: 3 },
          'Sauvegarde détails Fund Position'
        );
        
        console.log('✅ Détails bancaires sauvegardés');
      }
      
      // Sauvegarder les collections en attente (HOLD) si disponibles
      if (fundPosition.holdCollections && fundPosition.holdCollections.length > 0) {
        console.log(`💾 Sauvegarde de ${fundPosition.holdCollections.length} collections en attente...`);
        
        const holdsToInsert = fundPosition.holdCollections.map(hold => ({
          fund_position_id: fundPositionId,
          hold_date: hold.holdDate,
          cheque_number: hold.chequeNumber,
          client_bank: hold.clientBank,
          client_name: hold.clientName,
          facture_reference: hold.factureReference,
          amount: Math.round(hold.amount),
          deposit_date: hold.depositDate,
          days_remaining: hold.daysRemaining
        }));
        
        await SupabaseRetryService.executeWithRetry(
          async () => {
            const { error } = await supabase
              .from('fund_position_hold')
              .insert(holdsToInsert);
            
            if (error) throw error;
          },
          { maxRetries: 3 },
          'Sauvegarde collections HOLD'
        );
        
        console.log('✅ Collections en attente sauvegardées');
      }

      console.log('✅ Fund Position complète sauvegardée avec succès');
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
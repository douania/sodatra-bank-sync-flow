import { supabase } from '@/integrations/supabase/client';
import { BankReport, FundPosition, ClientReconciliation, CollectionReport } from '@/types/banking';

export interface DatabaseResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  tablesCleared?: string[];
}

export class DatabaseService {
  // ⭐ NOUVELLE MÉTHODE: Test de connexion
  async testConnection(): Promise<boolean> {
    try {
      const { error } = await supabase.from('collection_report').select('count').limit(1);
      return !error;
    } catch (error) {
      console.error('❌ Test de connexion échoué:', error);
      return false;
    }
  }

  // ⭐ NOUVELLE MÉTHODE: Compter les collections
  async getCollectionCount(): Promise<number> {
    try {
      const { count, error } = await supabase
        .from('collection_report')
        .select('*', { count: 'exact', head: true });

      if (error) {
        console.error('❌ Erreur comptage collections:', error);
        return 0;
      }

      console.log(`📊 Nombre de collections en base: ${count || 0}`);
      return count || 0;
    } catch (error) {
      console.error('❌ Exception comptage collections:', error);
      return 0;
    }
  }

  // ⭐ NOUVELLE MÉTHODE: Récupérer les rapports de collection
  async getCollectionReports(): Promise<CollectionReport[]> {
    try {
      const { data, error } = await supabase
        .from('collection_report')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('❌ Erreur récupération collections:', error);
        return [];
      }

      return data?.map(item => ({
        id: item.id,
        reportDate: item.report_date,
        clientCode: item.client_code,
        collectionAmount: item.collection_amount,
        bankName: item.bank_name,
        status: (item.status === 'pending' || item.status === 'processed' || item.status === 'failed') 
          ? item.status as 'pending' | 'processed' | 'failed'
          : 'pending',
        dateOfValidity: item.date_of_validity,
        factureNo: item.facture_no,
        noChqBd: item.no_chq_bd,
        bankNameDisplay: item.bank_name_display,
        depoRef: item.depo_ref,
        commission: item.commission,
        nj: item.nj,
        taux: item.taux,
        interet: item.interet,
        tob: item.tob,
        fraisEscompte: item.frais_escompte,
        bankCommission: item.bank_commission,
        dNAmount: item.d_n_amount,
        income: item.income,
        dateOfImpay: item.date_of_impay,
        reglementImpaye: item.reglement_impaye,
        remarques: item.remarques,
        creditedDate: item.credited_date,
        processingStatus: item.processing_status,
        matchedBankDepositId: item.matched_bank_deposit_id,
        matchConfidence: item.match_confidence,
        matchMethod: item.match_method,
        sgOrFaNo: item.sg_or_fa_no,
        processedAt: item.processed_at
      })) || [];
    } catch (error) {
      console.error('❌ Exception récupération collections:', error);
      return [];
    }
  }

  // ⭐ NOUVELLE MÉTHODE: Mettre à jour la date de validité d'une collection
  async updateCollectionDateOfValidity(collectionId: string, dateOfValidity: string): Promise<DatabaseResult> {
    try {
      const { data, error } = await supabase
        .from('collection_report')
        .update({ 
          date_of_validity: dateOfValidity,
          status: 'processed',
          credited_date: dateOfValidity
        })
        .eq('id', collectionId)
        .select()
        .single();

      if (error) {
        console.error('❌ Erreur mise à jour collection:', error);
        return { success: false, error: error.message };
      }

      console.log('✅ Collection mise à jour avec succès:', collectionId);
      return { success: true, data };
    } catch (error) {
      console.error('❌ Exception mise à jour collection:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Erreur inconnue' 
      };
    }
  }

  // ⭐ NOUVELLE MÉTHODE: Nettoyage complet des données de test
  async cleanAllTestData(): Promise<DatabaseResult<{ tablesCleared: string[] }>> {
    console.log('🧹 === DÉBUT NETTOYAGE BASE DE DONNÉES ===');
    
    try {
      const tablesCleared: string[] = [];
      
      // 1. Nettoyer les impayés (données fictives)
      console.log('🧹 Nettoyage table impayes...');
      const { error: impayesError } = await supabase
        .from('impayes')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Supprimer tout sauf l'impossible
      
      if (!impayesError) {
        tablesCleared.push('impayes');
        console.log('✅ Table impayes nettoyée');
      } else {
        console.warn('⚠️ Erreur nettoyage impayes:', impayesError);
      }

      // 2. Nettoyer les facilités bancaires
      console.log('🧹 Nettoyage table bank_facilities...');
      const { error: facilitiesError } = await supabase
        .from('bank_facilities')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');
      
      if (!facilitiesError) {
        tablesCleared.push('bank_facilities');
        console.log('✅ Table bank_facilities nettoyée');
      } else {
        console.warn('⚠️ Erreur nettoyage bank_facilities:', facilitiesError);
      }

      // 3. Nettoyer les dépôts non compensés
      console.log('🧹 Nettoyage table deposits_not_cleared...');
      const { error: depositsError } = await supabase
        .from('deposits_not_cleared')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');
      
      if (!depositsError) {
        tablesCleared.push('deposits_not_cleared');
        console.log('✅ Table deposits_not_cleared nettoyée');
      } else {
        console.warn('⚠️ Erreur nettoyage deposits_not_cleared:', depositsError);
      }

      // 4. Nettoyer les rapports bancaires
      console.log('🧹 Nettoyage table bank_reports...');
      const { error: reportsError } = await supabase
        .from('bank_reports')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');
      
      if (!reportsError) {
        tablesCleared.push('bank_reports');
        console.log('✅ Table bank_reports nettoyée');
      } else {
        console.warn('⚠️ Erreur nettoyage bank_reports:', reportsError);
      }

      // 5. Nettoyer fund_position
      console.log('🧹 Nettoyage table fund_position...');
      const { error: fundError } = await supabase
        .from('fund_position')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');
      
      if (!fundError) {
        tablesCleared.push('fund_position');
        console.log('✅ Table fund_position nettoyée');
      } else {
        console.warn('⚠️ Erreur nettoyage fund_position:', fundError);
      }

      // 6. Nettoyer client_reconciliation
      console.log('🧹 Nettoyage table client_reconciliation...');
      const { error: clientError } = await supabase
        .from('client_reconciliation')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');
      
      if (!clientError) {
        tablesCleared.push('client_reconciliation');
        console.log('✅ Table client_reconciliation nettoyée');
      } else {
        console.warn('⚠️ Erreur nettoyage client_reconciliation:', clientError);
      }

      console.log(`🧹 === NETTOYAGE TERMINÉ: ${tablesCleared.length} tables nettoyées ===`);
      
      return {
        success: true,
        data: { tablesCleared },
        tablesCleared
      };
    } catch (error) {
      console.error('❌ ERREUR CRITIQUE NETTOYAGE:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erreur inconnue lors du nettoyage'
      };
    }
  }

  // ⭐ NOUVELLE MÉTHODE: Récupérer le total des collections
  async getTotalCollections(): Promise<number> {
    try {
      const { data, error } = await supabase
        .from('collection_report')
        .select('collection_amount');
      
      if (error) {
        console.error('❌ Erreur récupération collections:', error);
        return 0;
      }
      
      const total = data?.reduce((sum, item) => sum + (item.collection_amount || 0), 0) || 0;
      console.log(`📊 Total collections calculé: ${(total / 1000000).toFixed(1)}M CFA`);
      return total;
    } catch (error) {
      console.error('❌ Exception calcul total collections:', error);
      return 0;
    }
  }

  // ⭐ NOUVELLE MÉTHODE: Récupérer les clients avec collections
  async getClientsWithCollections(): Promise<Array<{ clientCode: string; clientName?: string }>> {
    try {
      const { data, error } = await supabase
        .from('collection_report')
        .select('client_code')
        .not('client_code', 'is', null);
      
      if (error) {
        console.error('❌ Erreur récupération clients:', error);
        return [];
      }
      
      // Dédoublonner les codes clients
      const uniqueClients = Array.from(new Set(data?.map(item => item.client_code) || []))
        .map(clientCode => ({
          clientCode,
          clientName: `Client ${clientCode}`
        }));
      
      console.log(`👥 ${uniqueClients.length} clients uniques trouvés`);
      return uniqueClients;
    } catch (error) {
      console.error('❌ Exception récupération clients:', error);
      return [];
    }
  }

  async saveBankReport(report: BankReport): Promise<DatabaseResult> {
    try {
      console.log(`💾 Sauvegarde rapport bancaire ${report.bank}...`);
      
      const { data: bankReportData, error: bankReportError } = await supabase
        .from('bank_reports')
        .insert({
          bank_name: report.bank,
          report_date: report.date,
          opening_balance: report.openingBalance,
          closing_balance: report.closingBalance
        })
        .select()
        .single();

      if (bankReportError) {
        console.error('❌ Erreur sauvegarde rapport bancaire:', bankReportError);
        return { success: false, error: bankReportError.message };
      }

      const bankReportId = bankReportData.id;

      // Sauvegarder les facilités bancaires
      if (report.bankFacilities.length > 0) {
        const facilitiesData = report.bankFacilities.map(facility => ({
          bank_report_id: bankReportId,
          facility_type: facility.facilityType,
          limit_amount: facility.limitAmount,
          used_amount: facility.usedAmount,
          available_amount: facility.availableAmount
        }));

        const { error: facilitiesError } = await supabase
          .from('bank_facilities')
          .insert(facilitiesData);

        if (facilitiesError) {
          console.error('❌ Erreur sauvegarde facilités:', facilitiesError);
        }
      }

      // Sauvegarder les dépôts non compensés
      if (report.depositsNotCleared.length > 0) {
        const depositsData = report.depositsNotCleared.map(deposit => ({
          bank_report_id: bankReportId,
          date_depot: deposit.dateDepot,
          date_valeur: deposit.dateValeur,
          type_reglement: deposit.typeReglement,
          reference: deposit.reference,
          client_code: deposit.clientCode,
          montant: deposit.montant
        }));

        const { error: depositsError } = await supabase
          .from('deposits_not_cleared')
          .insert(depositsData);

        if (depositsError) {
          console.error('❌ Erreur sauvegarde dépôts:', depositsError);
        }
      }

      // Sauvegarder les impayés
      if (report.impayes.length > 0) {
        const impayesData = report.impayes.map(impaye => ({
          bank_report_id: bankReportId,
          date_retour: impaye.dateRetour,
          date_echeance: impaye.dateEcheance,
          client_code: impaye.clientCode,
          description: impaye.description,
          montant: impaye.montant
        }));

        const { error: impayesError } = await supabase
          .from('impayes')
          .insert(impayesData);

        if (impayesError) {
          console.error('❌ Erreur sauvegarde impayés:', impayesError);
        }
      }

      console.log(`✅ Rapport bancaire ${report.bank} sauvegardé avec succès`);
      return { success: true, data: bankReportData };
    } catch (error) {
      console.error('❌ Exception sauvegarde rapport bancaire:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Erreur inconnue' 
      };
    }
  }

  async saveFundPosition(fundPosition: FundPosition): Promise<DatabaseResult> {
    try {
      console.log('💾 Sauvegarde Fund Position...');
      
      const { data, error } = await supabase
        .from('fund_position')
        .insert({
          report_date: fundPosition.reportDate,
          total_fund_available: fundPosition.totalFundAvailable,
          collections_not_deposited: fundPosition.collectionsNotDeposited,
          grand_total: fundPosition.grandTotal
        })
        .select()
        .single();

      if (error) {
        console.error('❌ Erreur sauvegarde Fund Position:', error);
        return { success: false, error: error.message };
      }

      console.log('✅ Fund Position sauvegardée avec succès');
      return { success: true, data };
    } catch (error) {
      console.error('❌ Exception sauvegarde Fund Position:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Erreur inconnue' 
      };
    }
  }

  async saveCollectionReport(collection: CollectionReport): Promise<DatabaseResult> {
    try {
      const { data, error } = await supabase
        .from('collection_report')
        .insert({
          client_code: collection.clientCode,
          collection_amount: collection.collectionAmount,
          bank_name: collection.bankName,
          report_date: collection.reportDate,
          commission: collection.commission,
          date_of_validity: collection.dateOfValidity,
          nj: collection.nj,
          taux: collection.taux,
          interet: collection.interet,
          tob: collection.tob,
          frais_escompte: collection.fraisEscompte,
          bank_commission: collection.bankCommission,
          d_n_amount: collection.dNAmount,
          income: collection.income,
          date_of_impay: collection.dateOfImpay,
          reglement_impaye: collection.reglementImpaye,
          credited_date: collection.creditedDate,
          status: collection.status,
          remarques: collection.remarques,
          facture_no: collection.factureNo,
          no_chq_bd: collection.noChqBd,
          bank_name_display: collection.bankNameDisplay,
          depo_ref: collection.depoRef,
          processing_status: collection.processingStatus,
          match_method: collection.matchMethod,
          sg_or_fa_no: collection.sgOrFaNo
        })
        .select()
        .single();

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true, data };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Erreur inconnue' 
      };
    }
  }

  // ⭐ NOUVELLE MÉTHODE: Récupérer tous les rapports bancaires (requis par QualityControl)
  async getAllBankReports(): Promise<BankReport[]> {
    try {
      console.log('🏦 Récupération de tous les rapports bancaires...');
      
      const { data: reports, error } = await supabase
        .from('bank_reports')
        .select(`
          *,
          bank_facilities(*),
          deposits_not_cleared(*),
          impayes(*)
        `)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('❌ Erreur récupération rapports bancaires:', error);
        return [];
      }

      const bankReports: BankReport[] = reports?.map(report => ({
        bank: report.bank_name,
        date: report.report_date,
        openingBalance: report.opening_balance,
        closingBalance: report.closing_balance,
        bankFacilities: report.bank_facilities?.map((facility: any) => ({
          facilityType: facility.facility_type,
          limitAmount: facility.limit_amount,
          usedAmount: facility.used_amount,
          availableAmount: facility.available_amount
        })) || [],
        depositsNotCleared: report.deposits_not_cleared?.map((deposit: any) => ({
          dateDepot: deposit.date_depot,
          dateValeur: deposit.date_valeur,
          typeReglement: deposit.type_reglement,
          reference: deposit.reference,
          clientCode: deposit.client_code,
          montant: deposit.montant
        })) || [],
        impayes: report.impayes?.map((impaye: any) => ({
          dateRetour: impaye.date_retour,
          dateEcheance: impaye.date_echeance,
          clientCode: impaye.client_code,
          description: impaye.description,
          montant: impaye.montant
        })) || []
      })) || [];

      console.log(`📊 ${bankReports.length} rapports bancaires récupérés pour analyse qualité`);
      return bankReports;
    } catch (error) {
      console.error('❌ Exception récupération rapports bancaires:', error);
      return [];
    }
  }

  async getLatestBankReports(): Promise<BankReport[]> {
    try {
      const { data: reports, error } = await supabase
        .from('bank_reports')
        .select(`
          *,
          bank_facilities(*),
          deposits_not_cleared(*),
          impayes(*)
        `)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('❌ Erreur récupération rapports bancaires:', error);
        return [];
      }

      return reports?.map(report => ({
        bank: report.bank_name,
        date: report.report_date,
        openingBalance: report.opening_balance,
        closingBalance: report.closing_balance,
        bankFacilities: report.bank_facilities?.map((facility: any) => ({
          facilityType: facility.facility_type,
          limitAmount: facility.limit_amount,
          usedAmount: facility.used_amount,
          availableAmount: facility.available_amount
        })) || [],
        depositsNotCleared: report.deposits_not_cleared?.map((deposit: any) => ({
          dateDepot: deposit.date_depot,
          dateValeur: deposit.date_valeur,
          typeReglement: deposit.type_reglement,
          reference: deposit.reference,
          clientCode: deposit.client_code,
          montant: deposit.montant
        })) || [],
        impayes: report.impayes?.map((impaye: any) => ({
          dateRetour: impaye.date_retour,
          dateEcheance: impaye.date_echeance,
          clientCode: impaye.client_code,
          description: impaye.description,
          montant: impaye.montant
        })) || []
      })) || [];
    } catch (error) {
      console.error('❌ Exception récupération rapports bancaires:', error);
      return [];
    }
  }

  async getLatestFundPosition(): Promise<FundPosition | null> {
    try {
      const { data, error } = await supabase
        .from('fund_position')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('❌ Erreur récupération Fund Position:', error);
        return null;
      }

      if (!data) {
        return null;
      }

      return {
        reportDate: data.report_date,
        totalFundAvailable: data.total_fund_available,
        collectionsNotDeposited: data.collections_not_deposited,
        grandTotal: data.grand_total
      };
    } catch (error) {
      console.error('❌ Exception récupération Fund Position:', error);
      return null;
    }
  }
}

export const databaseService = new DatabaseService();

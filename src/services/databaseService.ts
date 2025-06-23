import { supabase } from '@/integrations/supabase/client';
import { BankReport, FundPosition, ClientReconciliation, CollectionReport } from '@/types/banking';

export class DatabaseService {
  
  // Sauvegarder un rapport bancaire
  async saveBankReport(report: BankReport): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`💾 Sauvegarde rapport ${report.bank} pour le ${report.date}`);
      
      // Vérifier si un rapport existe déjà pour cette banque et cette date
      const { data: existingReport } = await supabase
        .from('bank_reports')
        .select('id')
        .eq('bank_name', report.bank)
        .eq('report_date', report.date)
        .single();

      let bankReportId: string;

      if (existingReport) {
        // Mettre à jour le rapport existant
        const { data: updatedReport, error: updateError } = await supabase
          .from('bank_reports')
          .update({
            opening_balance: report.openingBalance,
            closing_balance: report.closingBalance,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingReport.id)
          .select()
          .single();

        if (updateError) {
          console.error('❌ Erreur mise à jour rapport bancaire:', updateError);
          return { success: false, error: updateError.message };
        }

        bankReportId = existingReport.id;
        console.log(`🔄 Rapport ${report.bank} mis à jour`);
      } else {
        // Créer un nouveau rapport
        const { data: newReport, error: insertError } = await supabase
          .from('bank_reports')
          .insert({
            bank_name: report.bank,
            report_date: report.date,
            opening_balance: report.openingBalance,
            closing_balance: report.closingBalance
          })
          .select()
          .single();

        if (insertError) {
          console.error('❌ Erreur création rapport bancaire:', insertError);
          return { success: false, error: insertError.message };
        }

        bankReportId = newReport.id;
        console.log(`✅ Nouveau rapport ${report.bank} créé`);
      }

      // Supprimer les anciennes données liées
      await this.clearRelatedData(bankReportId);

      // Sauvegarder les dépôts non crédités
      if (report.depositsNotCleared && report.depositsNotCleared.length > 0) {
        const depositsData = report.depositsNotCleared.map(deposit => ({
          bank_report_id: bankReportId,
          date_depot: deposit.dateDepot,
          date_valeur: deposit.dateValeur,
          type_reglement: deposit.typeReglement,
          client_code: deposit.clientCode,
          reference: deposit.reference,
          montant: deposit.montant
        }));

        const { error: depositsError } = await supabase
          .from('deposits_not_cleared')
          .insert(depositsData);

        if (depositsError) {
          console.error('⚠️ Erreur sauvegarde dépôts:', depositsError);
        } else {
          console.log(`📄 ${depositsData.length} dépôts sauvegardés`);
        }
      }

      // Sauvegarder les facilités bancaires
      if (report.bankFacilities && report.bankFacilities.length > 0) {
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
          console.error('⚠️ Erreur sauvegarde facilités:', facilitiesError);
        } else {
          console.log(`💳 ${facilitiesData.length} facilités sauvegardées`);
        }
      }

      // Sauvegarder les impayés
      if (report.impayes && report.impayes.length > 0) {
        const impayesData = report.impayes.map(impaye => ({
          bank_report_id: bankReportId,
          date_echeance: impaye.dateEcheance,
          date_retour: impaye.dateRetour,
          client_code: impaye.clientCode,
          description: impaye.description,
          montant: impaye.montant
        }));

        const { error: impayesError } = await supabase
          .from('impayes')
          .insert(impayesData);

        if (impayesError) {
          console.error('⚠️ Erreur sauvegarde impayés:', impayesError);
        } else {
          console.log(`❌ ${impayesData.length} impayés sauvegardés`);
        }
      }

      console.log(`✅ Rapport ${report.bank} sauvegardé avec succès`);
      return { success: true };

    } catch (error) {
      console.error('❌ Erreur générale sauvegarde:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Erreur inconnue' 
      };
    }
  }

  // Nettoyer les données liées à un rapport
  private async clearRelatedData(bankReportId: string) {
    try {
      await Promise.all([
        supabase.from('deposits_not_cleared').delete().eq('bank_report_id', bankReportId),
        supabase.from('bank_facilities').delete().eq('bank_report_id', bankReportId),
        supabase.from('impayes').delete().eq('bank_report_id', bankReportId)
      ]);
      console.log(`🧹 Données liées nettoyées pour le rapport ${bankReportId}`);
    } catch (error) {
      console.error('⚠️ Erreur nettoyage données liées:', error);
    }
  }

  // Sauvegarder Collection Report avec TOUTES les nouvelles colonnes
  async saveCollectionReport(collection: CollectionReport): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('📊 Sauvegarde Collection Report...');
      
      // Vérifier si une collection existe déjà pour ce client et cette date
      const { data: existing } = await supabase
        .from('collection_report')
        .select('id')
        .eq('client_code', collection.clientCode)
        .eq('report_date', collection.reportDate)
        .maybeSingle();

      if (existing) {
        // Mettre à jour avec TOUTES les colonnes
        const { error } = await supabase
          .from('collection_report')
          .update({
            collection_amount: collection.collectionAmount,
            bank_name: collection.bankName,
            status: collection.status,
            
            // ⭐ NOUVELLES COLONNES AJOUTÉES
            date_of_validity: collection.dateOfValidity,
            facture_no: collection.factureNo,
            no_chq_bd: collection.noChqBd,
            bank_name_display: collection.bankNameDisplay,
            depo_ref: collection.depoRef,
            
            // ⭐ CALCULS FINANCIERS
            nj: collection.nj,
            taux: collection.taux,
            interet: collection.interet,
            commission: collection.commission,
            tob: collection.tob,
            frais_escompte: collection.fraisEscompte,
            bank_commission: collection.bankCommission,
            
            // ⭐ RÉFÉRENCES SUPPLÉMENTAIRES
            sg_or_fa_no: collection.sgOrFaNo,
            d_n_amount: collection.dNAmount,
            income: collection.income,
            
            // ⭐ GESTION DES IMPAYÉS
            date_of_impay: collection.dateOfImpay,
            reglement_impaye: collection.reglementImpaye,
            remarques: collection.remarques,
            
            // ⭐ MÉTADONNÉES DE TRAITEMENT
            credited_date: collection.creditedDate,
            processing_status: collection.processingStatus,
            matched_bank_deposit_id: collection.matchedBankDepositId,
            match_confidence: collection.matchConfidence,
            match_method: collection.matchMethod,
            processed_at: collection.processedAt
          })
          .eq('id', existing.id);

        if (error) {
          console.error('❌ Erreur mise à jour Collection:', error);
          return { success: false, error: error.message };
        }
        console.log('🔄 Collection mise à jour');
      } else {
        // Créer nouvelle collection avec TOUTES les colonnes
        const { error } = await supabase
          .from('collection_report')
          .insert({
            report_date: collection.reportDate,
            client_code: collection.clientCode,
            collection_amount: collection.collectionAmount,
            bank_name: collection.bankName,
            status: collection.status || 'pending',
            
            // ⭐ NOUVELLES COLONNES AJOUTÉES
            date_of_validity: collection.dateOfValidity,
            facture_no: collection.factureNo,
            no_chq_bd: collection.noChqBd,
            bank_name_display: collection.bankNameDisplay,
            depo_ref: collection.depoRef,
            
            // ⭐ CALCULS FINANCIERS
            nj: collection.nj,
            taux: collection.taux,
            interet: collection.interet,
            commission: collection.commission,
            tob: collection.tob,
            frais_escompte: collection.fraisEscompte,
            bank_commission: collection.bankCommission,
            
            // ⭐ RÉFÉRENCES SUPPLÉMENTAIRES
            sg_or_fa_no: collection.sgOrFaNo,
            d_n_amount: collection.dNAmount,
            income: collection.income,
            
            // ⭐ GESTION DES IMPAYÉS
            date_of_impay: collection.dateOfImpay,
            reglement_impaye: collection.reglementImpaye,
            remarques: collection.remarques,
            
            // ⭐ MÉTADONNÉES DE TRAITEMENT
            credited_date: collection.creditedDate,
            processing_status: collection.processingStatus || 'NEW',
            matched_bank_deposit_id: collection.matchedBankDepositId,
            match_confidence: collection.matchConfidence,
            match_method: collection.matchMethod,
            processed_at: collection.processedAt
          });

        if (error) {
          console.error('❌ Erreur création Collection:', error);
          return { success: false, error: error.message };
        }
        console.log('✅ Collection créée');
      }

      return { success: true };

    } catch (error) {
      console.error('❌ Erreur générale Collection:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Erreur inconnue' 
      };
    }
  }

  // Récupérer tous les rapports de collection avec TOUTES les colonnes
  async getCollectionReports(): Promise<CollectionReport[]> {
    try {
      console.log('📊 Récupération des collections...');
      
      const { data, error } = await supabase
        .from('collection_report')
        .select('*')
        .order('report_date', { ascending: false });

      if (error) {
        console.error('❌ Erreur récupération collections:', error);
        return [];
      }

      if (!data || data.length === 0) {
        console.log('⚠️ Aucune collection trouvée');
        return [];
      }

      const collections = data.map(item => ({
        id: item.id,
        reportDate: item.report_date,
        clientCode: item.client_code,
        collectionAmount: item.collection_amount || 0,
        bankName: item.bank_name,
        status: (item.status as 'pending' | 'processed' | 'failed') || 'pending',
        
        // ⭐ NOUVELLES COLONNES MAPPÉES
        dateOfValidity: item.date_of_validity || undefined,
        factureNo: item.facture_no || undefined,
        noChqBd: item.no_chq_bd || undefined,
        bankNameDisplay: item.bank_name_display || undefined,
        depoRef: item.depo_ref || undefined,
        
        // ⭐ CALCULS FINANCIERS
        nj: item.nj || undefined,
        taux: item.taux || undefined,
        interet: item.interet || undefined,
        commission: item.commission || undefined,
        tob: item.tob || undefined,
        fraisEscompte: item.frais_escompte || undefined,
        bankCommission: item.bank_commission || undefined,
        
        // ⭐ RÉFÉRENCES SUPPLÉMENTAIRES
        sgOrFaNo: item.sg_or_fa_no || undefined,
        dNAmount: item.d_n_amount || undefined,
        income: item.income || undefined,
        
        // ⭐ GESTION DES IMPAYÉS
        dateOfImpay: item.date_of_impay || undefined,
        reglementImpaye: item.reglement_impaye || undefined,
        remarques: item.remarques || undefined,
        
        // ⭐ MÉTADONNÉES DE TRAITEMENT
        creditedDate: item.credited_date || undefined,
        processingStatus: item.processing_status || undefined,
        matchedBankDepositId: item.matched_bank_deposit_id || undefined,
        matchConfidence: item.match_confidence || undefined,
        matchMethod: item.match_method || undefined,
        processedAt: item.processed_at || undefined
      }));

      console.log(`✅ ${collections.length} collections récupérées`);
      return collections;

    } catch (error) {
      console.error('❌ Erreur générale récupération collections:', error);
      return [];
    }
  }

  // Mettre à jour la date de validité d'une collection (FONCTION CRUCIALE!)
  async updateCollectionDateOfValidity(collectionId: string, dateOfValidity: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('📅 Mise à jour date de validité collection...');
      
      const { error } = await supabase
        .from('collection_report')
        .update({
          status: 'processed',
          date_of_validity: dateOfValidity,
          credited_date: dateOfValidity,
          processed_at: new Date().toISOString()
        })
        .eq('id', collectionId);

      if (error) {
        console.error('❌ Erreur mise à jour date validité:', error);
        return { success: false, error: error.message };
      }

      console.log('✅ Date de validité mise à jour');
      return { success: true };

    } catch (error) {
      console.error('❌ Erreur générale mise à jour date validité:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Erreur inconnue' 
      };
    }
  }

  // Sauvegarder Fund Position
  async saveFundPosition(fundPosition: FundPosition): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('💰 Sauvegarde Fund Position...');
      
      // Vérifier si une position existe déjà pour cette date
      const { data: existing } = await supabase
        .from('fund_position')
        .select('id')
        .eq('report_date', fundPosition.reportDate)
        .single();

      if (existing) {
        // Mettre à jour
        const { error } = await supabase
          .from('fund_position')
          .update({
            total_fund_available: fundPosition.totalFundAvailable,
            collections_not_deposited: fundPosition.collectionsNotDeposited,
            grand_total: fundPosition.grandTotal
          })
          .eq('id', existing.id);

        if (error) {
          console.error('❌ Erreur mise à jour Fund Position:', error);
          return { success: false, error: error.message };
        }
        console.log('🔄 Fund Position mise à jour');
      } else {
        // Créer nouvelle position
        const { error } = await supabase
          .from('fund_position')
          .insert({
            report_date: fundPosition.reportDate,
            total_fund_available: fundPosition.totalFundAvailable,
            collections_not_deposited: fundPosition.collectionsNotDeposited,
            grand_total: fundPosition.grandTotal
          });

        if (error) {
          console.error('❌ Erreur création Fund Position:', error);
          return { success: false, error: error.message };
        }
        console.log('✅ Fund Position créée');
      }

      return { success: true };

    } catch (error) {
      console.error('❌ Erreur générale Fund Position:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Erreur inconnue' 
      };
    }
  }

  // Récupérer les derniers rapports bancaires
  async getLatestBankReports(): Promise<BankReport[]> {
    try {
      console.log('📊 Récupération des rapports bancaires...');
      
      const { data: reports, error } = await supabase
        .from('bank_reports')
        .select(`
          *,
          deposits_not_cleared(*),
          bank_facilities(*),
          impayes(*)
        `)
        .order('report_date', { ascending: false })
        .limit(20);

      if (error) {
        console.error('❌ Erreur récupération rapports:', error);
        return [];
      }

      if (!reports || reports.length === 0) {
        console.log('⚠️ Aucun rapport bancaire trouvé');
        return [];
      }

      const bankReports = reports.map(report => ({
        id: report.id,
        bank: report.bank_name,
        date: report.report_date,
        openingBalance: report.opening_balance || 0,
        closingBalance: report.closing_balance || 0,
        depositsNotCleared: report.deposits_not_cleared?.map((d: any) => ({
          id: d.id,
          dateDepot: d.date_depot,
          dateValeur: d.date_valeur,
          typeReglement: d.type_reglement,
          clientCode: d.client_code,
          reference: d.reference,
          montant: d.montant
        })) || [],
        bankFacilities: report.bank_facilities?.map((f: any) => ({
          id: f.id,
          facilityType: f.facility_type,
          limitAmount: f.limit_amount || 0,
          usedAmount: f.used_amount || 0,
          availableAmount: f.available_amount || 0
        })) || [],
        impayes: report.impayes?.map((i: any) => ({
          id: i.id,
          dateEcheance: i.date_echeance,
          dateRetour: i.date_retour,
          clientCode: i.client_code,
          description: i.description,
          montant: i.montant
        })) || [],
        checksNotCleared: []
      }));

      console.log(`✅ ${bankReports.length} rapports bancaires récupérés`);
      return bankReports;

    } catch (error) {
      console.error('❌ Erreur générale récupération rapports:', error);
      return [];
    }
  }

  // Récupérer la dernière Fund Position
  async getLatestFundPosition(): Promise<FundPosition | null> {
    try {
      console.log('💰 Récupération Fund Position...');
      
      const { data, error } = await supabase
        .from('fund_position')
        .select('*')
        .order('report_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('❌ Erreur récupération Fund Position:', error);
        return null;
      }

      if (!data) {
        console.log('⚠️ Aucune Fund Position trouvée');
        return null;
      }

      const fundPosition = {
        id: data.id,
        reportDate: data.report_date,
        totalFundAvailable: data.total_fund_available || 0,
        collectionsNotDeposited: data.collections_not_deposited || 0,
        grandTotal: data.grand_total || 0
      };

      console.log('✅ Fund Position récupérée');
      return fundPosition;

    } catch (error) {
      console.error('❌ Erreur générale Fund Position:', error);
      return null;
    }
  }

  // Méthode de test pour vérifier la connectivité
  async testConnection(): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('bank_reports')
        .select('id')
        .limit(1);
      
      if (error) {
        console.error('❌ Test connexion échoué:', error);
        return false;
      }
      
      console.log('✅ Connexion base de données OK');
      return true;
    } catch (error) {
      console.error('❌ Erreur test connexion:', error);
      return false;
    }
  }
}

export const databaseService = new DatabaseService();

import { supabase } from '@/integrations/supabase/client';
import { BankReport, Impaye, BankFacility, CollectionReport, FundPosition, DepositNotCleared } from '@/types/banking';

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

  // Sauvegarder Collection Report avec TOUTES les nouvelles colonnes et logs détaillés
  async saveCollectionReport(collection: CollectionReport): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('📊 Début sauvegarde Collection Report:', {
        clientCode: collection.clientCode,
        collectionAmount: collection.collectionAmount,
        bankName: collection.bankName,
        reportDate: collection.reportDate
      });
      
      // Vérifier si une collection existe déjà pour ce client et cette date
      const { data: existing, error: selectError } = await supabase
        .from('collection_report')
        .select('id')
        .eq('client_code', collection.clientCode)
        .eq('report_date', collection.reportDate)
        .maybeSingle();

      if (selectError) {
        console.error('❌ Erreur vérification existence:', selectError);
        return { success: false, error: selectError.message };
      }

      const collectionData = {
        report_date: collection.reportDate,
        client_code: collection.clientCode,
        collection_amount: collection.collectionAmount,
        bank_name: collection.bankName || '',
        status: collection.status || 'pending',
        
        // Nouvelles colonnes
        date_of_validity: collection.dateOfValidity || null,
        facture_no: collection.factureNo || null,
        no_chq_bd: collection.noChqBd || null,
        bank_name_display: collection.bankNameDisplay || null,
        depo_ref: collection.depoRef || null,
        
        // Calculs financiers
        nj: collection.nj || null,
        taux: collection.taux || null,
        interet: collection.interet || null,
        commission: collection.commission || null,
        tob: collection.tob || null,
        frais_escompte: collection.fraisEscompte || null,
        bank_commission: collection.bankCommission || null,
        
        // Références supplémentaires
        sg_or_fa_no: collection.sgOrFaNo || null,
        d_n_amount: collection.dNAmount || null,
        income: collection.income || null,
        
        // Gestion des impayés
        date_of_impay: collection.dateOfImpay || null,
        reglement_impaye: collection.reglementImpaye || null,
        remarques: collection.remarques || null,
        
        // Métadonnées de traitement
        credited_date: collection.creditedDate || null,
        processing_status: collection.processingStatus || 'NEW',
        matched_bank_deposit_id: collection.matchedBankDepositId || null,
        match_confidence: collection.matchConfidence || null,
        match_method: collection.matchMethod || null,
        processed_at: collection.processedAt || null
      };

      if (existing) {
        // Mettre à jour avec TOUTES les colonnes
        console.log('🔄 Mise à jour collection existante ID:', existing.id);
        const { error } = await supabase
          .from('collection_report')
          .update(collectionData)
          .eq('id', existing.id);

        if (error) {
          console.error('❌ Erreur mise à jour Collection:', error);
          return { success: false, error: error.message };
        }
        console.log('✅ Collection mise à jour avec succès');
      } else {
        // Créer nouvelle collection avec TOUTES les colonnes
        console.log('✨ Création nouvelle collection');
        const { error } = await supabase
          .from('collection_report')
          .insert(collectionData);

        if (error) {
          console.error('❌ Erreur création Collection:', error);
          return { success: false, error: error.message };
        }
        console.log('✅ Collection créée avec succès');
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
      console.log('🔍 Récupération des rapports de collection...');
      
      const { data, error } = await supabase
        .from('collection_report')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('❌ Erreur récupération rapports collection:', error);
        throw error;
      }

      if (!data || data.length === 0) {
        console.log('ℹ️ Aucun rapport de collection trouvé');
        return [];
      }

      const collectionReports: CollectionReport[] = data.map(report => ({
        clientCode: report.client_code,
        collectionAmount: report.collection_amount,
        bankName: report.bank_name || '',
        reportDate: report.report_date,
        dateOfValidity: report.date_of_validity || '',
        factureNo: report.facture_no || '',
        noChqBd: report.no_chq_bd || '',
        bankNameDisplay: report.bank_name_display || '',
        depoRef: report.depo_ref || '',
        nj: report.nj || 0,
        taux: report.taux || 0,
        interet: report.interet || 0,
        commission: report.commission || 0,
        tob: report.tob || 0,
        fraisEscompte: report.frais_escompte || 0,
        bankCommission: report.bank_commission || 0,
        sgOrFaNo: report.sg_or_fa_no || '',
        dNAmount: report.d_n_amount || 0,
        income: report.income || 0,
        dateOfImpay: report.date_of_impay || '',
        reglementImpaye: report.reglement_impaye || '',
        remarques: report.remarques || '',
        status: (report.status as 'pending' | 'processed' | 'failed') || 'pending'
      }));

      console.log(`✅ ${collectionReports.length} rapports de collection récupérés avec succès`);
      return collectionReports;

    } catch (error) {
      console.error('❌ Erreur générale récupération rapports collection:', error);
      throw error;
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
      console.log('🔍 Récupération des derniers rapports bancaires...');
      
      // Récupérer tous les rapports bancaires avec leurs relations
      const { data: bankReportsData, error: reportsError } = await supabase
        .from('bank_reports')
        .select('*')
        .order('created_at', { ascending: false });

      if (reportsError) {
        console.error('❌ Erreur récupération rapports bancaires:', reportsError);
        throw reportsError;
      }

      if (!bankReportsData || bankReportsData.length === 0) {
        console.log('ℹ️ Aucun rapport bancaire trouvé');
        return [];
      }

      // Récupérer les impayés pour chaque rapport
      const { data: impayesData, error: impayesError } = await supabase
        .from('impayes')
        .select('*');

      if (impayesError) {
        console.error('❌ Erreur récupération impayés:', impayesError);
      }

      // Récupérer les facilités bancaires
      const { data: facilitiesData, error: facilitiesError } = await supabase
        .from('bank_facilities')
        .select('*');

      if (facilitiesError) {
        console.error('❌ Erreur récupération facilités:', facilitiesError);
      }

      // Récupérer les dépôts non débités
      const { data: depositsData, error: depositsError } = await supabase
        .from('deposits_not_cleared')
        .select('*');

      if (depositsError) {
        console.error('❌ Erreur récupération dépôts:', depositsError);
      }

      // Transformer les données en format BankReport
      const bankReports: BankReport[] = bankReportsData.map(report => {
        // Filtrer les impayés pour ce rapport
        const reportImpayes = (impayesData || [])
          .filter(impaye => impaye.bank_report_id === report.id)
          .map(impaye => ({
            clientCode: impaye.client_code,
            montant: impaye.montant,
            dateEcheance: impaye.date_echeance,
            dateRetour: impaye.date_retour,
            description: impaye.description || ''
          }));

        // Filtrer les facilités pour ce rapport
        const reportFacilities = (facilitiesData || [])
          .filter(facility => facility.bank_report_id === report.id)
          .map(facility => ({
            facilityType: facility.facility_type,
            limitAmount: facility.limit_amount,
            usedAmount: facility.used_amount,
            availableAmount: facility.available_amount
          }));

        // Filtrer les dépôts pour ce rapport
        const reportDeposits = (depositsData || [])
          .filter(deposit => deposit.bank_report_id === report.id)
          .map(deposit => ({
            dateDepot: deposit.date_depot,
            dateValeur: deposit.date_valeur,
            typeReglement: deposit.type_reglement,
            reference: deposit.reference || '',
            clientCode: deposit.client_code || '',
            montant: deposit.montant
          }));

        return {
          bank: report.bank_name,
          date: report.report_date,
          openingBalance: report.opening_balance,
          closingBalance: report.closing_balance,
          impayes: reportImpayes,
          bankFacilities: reportFacilities,
          depositsNotCleared: reportDeposits
        };
      });

      console.log(`✅ ${bankReports.length} rapports bancaires récupérés avec succès`);
      return bankReports;

    } catch (error) {
      console.error('❌ Erreur récupération rapports bancaires:', error);
      throw error;
    }
  }

  // Récupérer la dernière Fund Position
  async getLatestFundPosition(): Promise<FundPosition | null> {
    try {
      console.log('🔍 Récupération de la position des fonds...');
      
      const { data, error } = await supabase
        .from('fund_position')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('❌ Erreur récupération position fonds:', error);
        throw error;
      }

      if (!data) {
        console.log('ℹ️ Aucune position de fonds trouvée');
        return null;
      }

      const fundPosition: FundPosition = {
        reportDate: data.report_date,
        totalFundAvailable: data.total_fund_available,
        collectionsNotDeposited: data.collections_not_deposited,
        grandTotal: data.grand_total
      };

      console.log('✅ Position des fonds récupérée avec succès');
      return fundPosition;

    } catch (error) {
      console.error('❌ Erreur récupération position fonds:', error);
      throw error;
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

  // Récupérer les rapports bancaires par période
  async getBankReportsByDateRange(startDate: string, endDate: string): Promise<BankReport[]> {
    try {
      const { data, error } = await supabase
        .from('bank_reports')
        .select('*')
        .gte('report_date', startDate)
        .lte('report_date', endDate)
        .order('report_date', { ascending: false });

      if (error) throw error;

      // Transformer les données comme dans getLatestBankReports
      return data?.map(report => ({
        bank: report.bank_name,
        date: report.report_date,
        openingBalance: report.opening_balance,
        closingBalance: report.closing_balance,
        impayes: [],
        bankFacilities: [],
        depositsNotCleared: []
      })) || [];

    } catch (error) {
      console.error('❌ Erreur récupération rapports par période:', error);
      throw error;
    }
  }
}

export const databaseService = new DatabaseService();

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
        checksNotCleared: [] // Ajouté pour la compatibilité
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


import { supabase } from '@/integrations/supabase/client';
import { BankReport, FundPosition, ClientReconciliation, CollectionReport } from '@/types/banking';

export class DatabaseService {
  
  // Sauvegarder un rapport bancaire
  async saveBankReport(report: BankReport): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`Sauvegarde rapport ${report.bank} pour le ${report.date}`);
      
      // Insérer le rapport principal
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
        console.error('Erreur sauvegarde rapport bancaire:', bankReportError);
        return { success: false, error: bankReportError.message };
      }

      const bankReportId = bankReportData.id;

      // Sauvegarder les dépôts non crédités
      if (report.depositsNotCleared.length > 0) {
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
          console.error('Erreur sauvegarde dépôts:', depositsError);
        }
      }

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
          console.error('Erreur sauvegarde facilités:', facilitiesError);
        }
      }

      // Sauvegarder les impayés
      if (report.impayes.length > 0) {
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
          console.error('Erreur sauvegarde impayés:', impayesError);
        }
      }

      console.log(`Rapport ${report.bank} sauvegardé avec succès`);
      return { success: true };

    } catch (error) {
      console.error('Erreur générale sauvegarde:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Erreur inconnue' 
      };
    }
  }

  // Sauvegarder Fund Position
  async saveFundPosition(fundPosition: FundPosition): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('fund_position')
        .insert({
          report_date: fundPosition.reportDate,
          total_fund_available: fundPosition.totalFundAvailable,
          collections_not_deposited: fundPosition.collectionsNotDeposited,
          grand_total: fundPosition.grandTotal
        });

      if (error) {
        console.error('Erreur sauvegarde Fund Position:', error);
        return { success: false, error: error.message };
      }

      console.log('Fund Position sauvegardée avec succès');
      return { success: true };

    } catch (error) {
      console.error('Erreur générale Fund Position:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Erreur inconnue' 
      };
    }
  }

  // Récupérer les derniers rapports bancaires
  async getLatestBankReports(): Promise<BankReport[]> {
    try {
      const { data: reports, error } = await supabase
        .from('bank_reports')
        .select(`
          *,
          deposits_not_cleared(*),
          bank_facilities(*),
          impayes(*)
        `)
        .order('report_date', { ascending: false })
        .limit(10);

      if (error) {
        console.error('Erreur récupération rapports:', error);
        return [];
      }

      return reports?.map(report => ({
        id: report.id,
        bank: report.bank_name,
        date: report.report_date,
        openingBalance: report.opening_balance,
        closingBalance: report.closing_balance,
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
          limitAmount: f.limit_amount,
          usedAmount: f.used_amount,
          availableAmount: f.available_amount
        })) || [],
        impayes: report.impayes?.map((i: any) => ({
          id: i.id,
          dateEcheance: i.date_echeance,
          dateRetour: i.date_retour,
          clientCode: i.client_code,
          description: i.description,
          montant: i.montant
        })) || []
      })) || [];

    } catch (error) {
      console.error('Erreur générale récupération rapports:', error);
      return [];
    }
  }

  // Récupérer la dernière Fund Position
  async getLatestFundPosition(): Promise<FundPosition | null> {
    try {
      const { data, error } = await supabase
        .from('fund_position')
        .select('*')
        .order('report_date', { ascending: false })
        .limit(1)
        .single();

      if (error) {
        console.error('Erreur récupération Fund Position:', error);
        return null;
      }

      return {
        id: data.id,
        reportDate: data.report_date,
        totalFundAvailable: data.total_fund_available,
        collectionsNotDeposited: data.collections_not_deposited,
        grandTotal: data.grand_total
      };

    } catch (error) {
      console.error('Erreur générale Fund Position:', error);
      return null;
    }
  }
}

export const databaseService = new DatabaseService();


import { supabase } from '@/integrations/supabase/client';
import { BankReport, FundPosition, ClientReconciliation, CollectionReport } from '@/types/banking';

export interface DuplicateReport {
  clientCode: string;
  collectionAmount: number;
  count: number;
  collections: CollectionReport[];
}

class DatabaseService {
  async saveBankReport(bankReport: BankReport): Promise<{ success: boolean; error?: string }> {
    try {
      const { data, error } = await supabase
        .from('bank_reports')
        .insert({
          bank_name: bankReport.bank,
          report_date: bankReport.date,
          opening_balance: bankReport.openingBalance,
          closing_balance: bankReport.closingBalance
        });

      if (error) throw error;
      
      return { success: true };
    } catch (error) {
      console.error('Error saving bank report:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  async saveFundPosition(fundPosition: FundPosition): Promise<{ success: boolean; error?: string }> {
    try {
      const { data, error } = await supabase
        .from('fund_position')
        .insert({
          report_date: fundPosition.reportDate,
          total_fund_available: fundPosition.totalFundAvailable,
          collections_not_deposited: fundPosition.collectionsNotDeposited,
          grand_total: fundPosition.grandTotal
        });

      if (error) throw error;
      
      return { success: true };
    } catch (error) {
      console.error('Error saving fund position:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  async saveClientReconciliation(clientRecon: ClientReconciliation[]): Promise<{ success: boolean; error?: string }> {
    try {
      const insertData = clientRecon.map(item => ({
        report_date: item.reportDate,
        client_code: item.clientCode,
        client_name: item.clientName,
        impayes_amount: item.impayesAmount
      }));

      const { data, error } = await supabase
        .from('client_reconciliation')
        .insert(insertData);

      if (error) throw error;
      
      return { success: true };
    } catch (error) {
      console.error('Error saving client reconciliation:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  async getCollectionsByFilename(filename: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('collection_report')
        .select('*')
        .eq('excel_filename', filename)
        .order('excel_source_row', { ascending: true });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error getting collections by filename:', error);
      return [];
    }
  }

  async getCollectionByFileAndRow(filename: string, sourceRow: number): Promise<any | null> {
    try {
      const { data, error } = await supabase
        .from('collection_report')
        .select('*')
        .eq('excel_filename', filename)
        .eq('excel_source_row', sourceRow)
        .maybeSingle();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error getting collection by file and row:', error);
      return null;
    }
  }

  // ⭐ NOUVELLE MÉTHODE: Vérification stricte avec traçabilité obligatoire
  async getCollectionByFileAndRowStrict(filename: string, sourceRow: number): Promise<any | null> {
    try {
      // ⭐ VÉRIFICATION STRICTE: Les deux champs doivent être présents
      if (!filename || !sourceRow) {
        console.warn('⚠️ Vérification stricte: filename ou sourceRow manquant');
        return null;
      }

      const { data, error } = await supabase
        .from('collection_report')
        .select('id, excel_filename, excel_source_row, excel_processed_at, client_code, collection_amount')
        .eq('excel_filename', filename)
        .eq('excel_source_row', sourceRow)
        .maybeSingle();

      if (error) {
        console.error('❌ Erreur vérification stricte:', error);
        throw error;
      }

      if (data) {
        console.log(`🔍 Doublon détecté: ${filename}:${sourceRow} existe déjà (ID: ${data.id})`);
      }

      return data;
    } catch (error) {
      console.error('❌ Erreur vérification stricte:', error);
      return null;
    }
  }

  async getTotalCollections(): Promise<number> {
    try {
      const { data, error } = await supabase
        .from('collection_report')
        .select('collection_amount')
        .not('collection_amount', 'is', null);

      if (error) throw error;
      
      const total = data?.reduce((sum, item) => sum + (item.collection_amount || 0), 0) || 0;
      return total;
    } catch (error) {
      console.error('Error getting total collections:', error);
      return 0;
    }
  }

  async getClientsWithCollections(): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('collection_report')
        .select('client_code, bank_name')
        .not('client_code', 'is', null);

      if (error) throw error;
      
      // Regrouper par client_code unique
      const uniqueClients = Array.from(
        new Set(data?.map(item => item.client_code) || [])
      ).map(clientCode => ({
        clientCode,
        clientName: `Client ${clientCode}` // Nom par défaut
      }));

      return uniqueClients;
    } catch (error) {
      console.error('Error getting clients with collections:', error);
      return [];
    }
  }

  // ⭐ NOUVELLE MÉTHODE: Statistiques de traçabilité
  async getTraceabilityStats(): Promise<{
    totalCollections: number;
    withTraceability: number;
    withoutTraceability: number;
    uniqueFiles: number;
  }> {
    try {
      // Total des collections
      const { count: totalCollections } = await supabase
        .from('collection_report')
        .select('*', { count: 'exact', head: true });

      // Collections avec traçabilité
      const { count: withTraceability } = await supabase
        .from('collection_report')
        .select('*', { count: 'exact', head: true })
        .not('excel_filename', 'is', null)
        .not('excel_source_row', 'is', null);

      // Collections sans traçabilité
      const withoutTraceability = (totalCollections || 0) - (withTraceability || 0);

      // Fichiers uniques
      const { data: filesData } = await supabase
        .from('collection_report')
        .select('excel_filename')
        .not('excel_filename', 'is', null);

      const uniqueFiles = new Set(filesData?.map(f => f.excel_filename) || []).size;

      return {
        totalCollections: totalCollections || 0,
        withTraceability: withTraceability || 0,
        withoutTraceability,
        uniqueFiles
      };
    } catch (error) {
      console.error('❌ Erreur statistiques traçabilité:', error);
      return {
        totalCollections: 0,
        withTraceability: 0,
        withoutTraceability: 0,
        uniqueFiles: 0
      };
    }
  }

  // ⭐ NOUVELLES MÉTHODES MANQUANTES
  async getCollectionReports(): Promise<CollectionReport[]> {
    try {
      const { data, error } = await supabase
        .from('collection_report')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      return data?.map(item => ({
        id: item.id,
        reportDate: item.report_date,
        clientCode: item.client_code,
        collectionAmount: item.collection_amount,
        bankName: item.bank_name,
        status: item.status as 'pending' | 'processed',
        dateOfValidity: item.date_of_validity,
        factureNo: item.facture_no,
        noChqBd: item.no_chq_bd,
        bankNameDisplay: item.bank_name_display,
        depoRef: item.depo_ref,
        nj: item.nj,
        taux: item.taux,
        interet: item.interet,
        commission: item.commission,
        tob: item.tob,
        fraisEscompte: item.frais_escompte,
        bankCommission: item.bank_commission,
        sgOrFaNo: item.sg_or_fa_no,
        dNAmount: item.d_n_amount,
        income: item.income,
        dateOfImpay: item.date_of_impay,
        reglementImpaye: item.reglement_impaye,
        remarques: item.remarques,
        excelFilename: item.excel_filename,
        excelSourceRow: item.excel_source_row,
        excelProcessedAt: item.excel_processed_at
      })) || [];
    } catch (error) {
      console.error('Error getting collection reports:', error);
      return [];
    }
  }

  async getLatestBankReports(): Promise<BankReport[]> {
    try {
      const { data: bankReportsData, error: bankError } = await supabase
        .from('bank_reports')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      if (bankError) throw bankError;

      const bankReports: BankReport[] = [];

      for (const report of bankReportsData || []) {
        // Récupérer les dépôts non crédités
        const { data: depositsData } = await supabase
          .from('deposits_not_cleared')
          .select('*')
          .eq('bank_report_id', report.id);

        // Récupérer les impayés
        const { data: impayesData } = await supabase
          .from('impayes')
          .select('*')
          .eq('bank_report_id', report.id);

        // Récupérer les facilités bancaires
        const { data: facilitiesData } = await supabase
          .from('bank_facilities')
          .select('*')
          .eq('bank_report_id', report.id);

        bankReports.push({
          id: report.id,
          bank: report.bank_name,
          date: report.report_date,
          openingBalance: report.opening_balance,
          closingBalance: report.closing_balance,
          depositsNotCleared: depositsData?.map(d => ({
            id: d.id,
            dateDepot: d.date_depot,
            dateValeur: d.date_valeur,
            typeReglement: d.type_reglement,
            montant: d.montant,
            reference: d.reference,
            clientCode: d.client_code
          })) || [],
          impayes: impayesData?.map(i => ({
            id: i.id,
            clientCode: i.client_code,
            dateEcheance: i.date_echeance,
            dateRetour: i.date_retour,
            montant: i.montant,
            description: i.description
          })) || [],
          bankFacilities: facilitiesData?.map(f => ({
            id: f.id,
            facilityType: f.facility_type,
            limitAmount: f.limit_amount,
            usedAmount: f.used_amount,
            availableAmount: f.available_amount
          })) || []
        });
      }

      return bankReports;
    } catch (error) {
      console.error('Error getting latest bank reports:', error);
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

      if (error) throw error;
      
      if (!data) return null;

      return {
        reportDate: data.report_date,
        totalFundAvailable: data.total_fund_available,
        collectionsNotDeposited: data.collections_not_deposited,
        grandTotal: data.grand_total
      };
    } catch (error) {
      console.error('Error getting latest fund position:', error);
      return null;
    }
  }

  async getAllBankReports(): Promise<BankReport[]> {
    try {
      const { data: bankReportsData, error: bankError } = await supabase
        .from('bank_reports')
        .select('*')
        .order('created_at', { ascending: false });

      if (bankError) throw bankError;

      const bankReports: BankReport[] = [];

      for (const report of bankReportsData || []) {
        // Récupérer les dépôts non crédités
        const { data: depositsData } = await supabase
          .from('deposits_not_cleared')
          .select('*')
          .eq('bank_report_id', report.id);

        // Récupérer les impayés
        const { data: impayesData } = await supabase
          .from('impayes')
          .select('*')
          .eq('bank_report_id', report.id);

        // Récupérer les facilités bancaires
        const { data: facilitiesData } = await supabase
          .from('bank_facilities')
          .select('*')
          .eq('bank_report_id', report.id);

        bankReports.push({
          id: report.id,
          bank: report.bank_name,
          date: report.report_date,
          openingBalance: report.opening_balance,
          closingBalance: report.closing_balance,
          depositsNotCleared: depositsData?.map(d => ({
            id: d.id,
            dateDepot: d.date_depot,
            dateValeur: d.date_valeur,
            typeReglement: d.type_reglement,
            montant: d.montant,
            reference: d.reference,
            clientCode: d.client_code
          })) || [],
          impayes: impayesData?.map(i => ({
            id: i.id,
            clientCode: i.client_code,
            dateEcheance: i.date_echeance,
            dateRetour: i.date_retour,
            montant: i.montant,
            description: i.description
          })) || [],
          bankFacilities: facilitiesData?.map(f => ({
            id: f.id,
            facilityType: f.facility_type,
            limitAmount: f.limit_amount,
            usedAmount: f.used_amount,
            availableAmount: f.available_amount
          })) || []
        });
      }

      return bankReports;
    } catch (error) {
      console.error('Error getting all bank reports:', error);
      return [];
    }
  }

  async getCollectionCount(): Promise<number> {
    try {
      const { count, error } = await supabase
        .from('collection_report')
        .select('*', { count: 'exact', head: true });

      if (error) throw error;
      return count || 0;
    } catch (error) {
      console.error('Error getting collection count:', error);
      return 0;
    }
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const { data, error } = await supabase
        .from('collection_report')
        .select('id')
        .limit(1);

      if (error) throw error;
      
      return { success: true };
    } catch (error) {
      console.error('Error testing connection:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  async updateCollectionDateOfValidity(collectionId: string, dateOfValidity: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { data, error } = await supabase
        .from('collection_report')
        .update({ 
          date_of_validity: dateOfValidity,
          status: 'processed'
        })
        .eq('id', collectionId);

      if (error) throw error;
      
      return { success: true };
    } catch (error) {
      console.error('Error updating collection date of validity:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  async detectDuplicates(): Promise<DuplicateReport[]> {
    try {
      const { data, error } = await supabase
        .from('collection_report')
        .select('*');

      if (error) throw error;

      const duplicatesMap = new Map<string, CollectionReport[]>();
      
      data?.forEach(item => {
        const collection: CollectionReport = {
          id: item.id,
          reportDate: item.report_date,
          clientCode: item.client_code,
          collectionAmount: item.collection_amount,
          bankName: item.bank_name,
          status: item.status as 'pending' | 'processed',
          dateOfValidity: item.date_of_validity,
          factureNo: item.facture_no,
          noChqBd: item.no_chq_bd,
          bankNameDisplay: item.bank_name_display,
          depoRef: item.depo_ref,
          nj: item.nj,
          taux: item.taux,
          interet: item.interet,
          commission: item.commission,
          tob: item.tob,
          fraisEscompte: item.frais_escompte,
          bankCommission: item.bank_commission,
          sgOrFaNo: item.sg_or_fa_no,
          dNAmount: item.d_n_amount,
          income: item.income,
          dateOfImpay: item.date_of_impay,
          reglementImpaye: item.reglement_impaye,
          remarques: item.remarques,
          excelFilename: item.excel_filename,
          excelSourceRow: item.excel_source_row,
          excelProcessedAt: item.excel_processed_at
        };

        const key = `${collection.clientCode}-${collection.collectionAmount}-${collection.reportDate}`;
        
        if (!duplicatesMap.has(key)) {
          duplicatesMap.set(key, []);
        }
        duplicatesMap.get(key)!.push(collection);
      });

      const duplicateReports: DuplicateReport[] = [];
      duplicatesMap.forEach((collections, key) => {
        if (collections.length > 1) {
          duplicateReports.push({
            clientCode: collections[0].clientCode,
            collectionAmount: collections[0].collectionAmount,
            count: collections.length,
            collections
          });
        }
      });

      return duplicateReports;
    } catch (error) {
      console.error('Error detecting duplicates:', error);
      return [];
    }
  }

  async removeDuplicates(duplicateIds: string[]): Promise<{ success: boolean; error?: string }> {
    try {
      const { data, error } = await supabase
        .from('collection_report')
        .delete()
        .in('id', duplicateIds);

      if (error) throw error;
      
      return { success: true };
    } catch (error) {
      console.error('Error removing duplicates:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }
}

export const databaseService = new DatabaseService();

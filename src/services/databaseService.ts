
import { supabase } from '@/integrations/supabase/client';
import { BankReport, FundPosition, ClientReconciliation, CollectionReport } from '@/types/banking';

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
}

export const databaseService = new DatabaseService();

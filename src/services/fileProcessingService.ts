
import { extractBankReport, extractFundPosition, extractClientReconciliation } from './extractionService';
import { databaseService } from './databaseService';
import { BankReport, FundPosition, ClientReconciliation } from '@/types/banking';

export interface ProcessingResult {
  success: boolean;
  data?: {
    bankReports: BankReport[];
    fundPosition?: FundPosition;
    clientReconciliation?: ClientReconciliation[];
  };
  errors?: string[];
}

export class FileProcessingService {
  async processFiles(files: { [key: string]: File }): Promise<ProcessingResult> {
    const results: ProcessingResult = {
      success: false,
      data: {
        bankReports: [],
        fundPosition: undefined,
        clientReconciliation: []
      },
      errors: []
    };

    try {
      console.log('🚀 Début du traitement des fichiers selon guide SODATRA');

      // 1. Traitement des relevés bancaires (Priorité 1)
      if (files.bankStatements) {
        console.log('📄 Extraction des relevés bancaires...');
        const bankReports = await this.processBankStatements(files.bankStatements);
        results.data!.bankReports = bankReports;

        // Sauvegarde en base
        for (const report of bankReports) {
          const saveResult = await databaseService.saveBankReport(report);
          if (!saveResult.success) {
            results.errors?.push(`Erreur sauvegarde ${report.bank}: ${saveResult.error}`);
          }
        }
      }

      // 2. Traitement Fund Position (Priorité 2)
      if (files.fundsPosition) {
        console.log('💰 Extraction Fund Position...');
        const fundPosition = await this.processFundPosition(files.fundsPosition);
        if (fundPosition) {
          results.data!.fundPosition = fundPosition;
          const saveResult = await databaseService.saveFundPosition(fundPosition);
          if (!saveResult.success) {
            results.errors?.push(`Erreur sauvegarde Fund Position: ${saveResult.error}`);
          }
        }
      }

      // 3. Traitement Client Reconciliation
      if (files.clientReconciliation) {
        console.log('👥 Extraction Client Reconciliation...');
        const clientRecon = await this.processClientReconciliation(files.clientReconciliation);
        results.data!.clientReconciliation = clientRecon;
      }

      results.success = results.errors?.length === 0;
      console.log(`✅ Traitement terminé - ${results.data!.bankReports.length} rapports bancaires traités`);

      return results;

    } catch (error) {
      console.error('❌ Erreur générale de traitement:', error);
      results.errors?.push(error instanceof Error ? error.message : 'Erreur inconnue');
      return results;
    }
  }

  private async processBankStatements(file: File): Promise<BankReport[]> {
    const reports: BankReport[] = [];
    
    // Simuler l'extraction PDF (en attendant une vraie lib PDF)
    const bankNames = ['BDK', 'SGS', 'BICIS', 'ATB', 'BIS', 'ORA'];
    
    for (const bankName of bankNames) {
      // Simuler le contenu PDF avec vos données de test réelles
      const mockPdfContent = this.generateMockPdfContent(bankName);
      
      const extractionResult = extractBankReport(mockPdfContent, bankName);
      if (extractionResult.success && extractionResult.data) {
        reports.push(extractionResult.data as BankReport);
      }
    }

    return reports;
  }

  private async processFundPosition(file: File): Promise<FundPosition | null> {
    // Simuler l'extraction avec vos données réelles du guide
    const mockContent = `
      FUND POSITION 18/06/2025
      TOTAL FUND AVAILABLE    340 097 805
      COLLECTIONS NOT DEPOSITED    299 190 047  
      GRAND TOTAL    463 182 919
    `;

    const extractionResult = extractFundPosition(mockContent);
    return extractionResult.success ? extractionResult.data as FundPosition : null;
  }

  private async processClientReconciliation(file: File): Promise<ClientReconciliation[]> {
    // Simuler avec vos données clients réelles (anonymisées)
    const mockContent = `
      CLIENT RECONCILIATION 18/06/2025
      CLIENT_A    ENTREPRISE ALPHA    215 093 602
      CLIENT_B    SOCIETE BETA    24 522 116
      CLIENT_C    COMPAGNIE GAMMA    6 142 736
    `;

    const extractionResult = extractClientReconciliation(mockContent);
    return extractionResult.success ? extractionResult.data as ClientReconciliation[] : [];
  }

  private generateMockPdfContent(bankName: string): string {
    // Générer du contenu avec vos vraies données de test du guide
    const testData = {
      BDK: { opening: 52_060_260, closing: 49_295_378 },
      SGS: { opening: 213_024_456, closing: 217_621_606 },
      BICIS: { opening: 70_417_520, closing: 95_417_520 },
      ATB: { opening: 68_503_519, closing: 6_855_675 },
      BIS: { opening: 9_423_856, closing: 3_911_541 },
      ORA: { opening: 51_741_551, closing: 50_077_201 }
    };

    const bankData = testData[bankName as keyof typeof testData];
    
    return `
      ${bankName} 18/06/2025
      OPENING BALANCE 18/06/2025 ${bankData.opening.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}
      CLOSING BALANCE ${bankData.closing.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}
      
      DEPOSIT NOT YET CLEARED
      15/06/2025 16/06/2025 REGLEMENT FACTURE CLI001 REF001 5 000 000
      
      BANK FACILITY
      FACILITE CAISSE 100 000 000 15 000 000 85 000 000
      
      IMPAYE
      10/06/2025 15/06/2025 IMPAYE CLI002 FACTURE IMPAYEE 2 500 000
    `;
  }
}

export const fileProcessingService = new FileProcessingService();

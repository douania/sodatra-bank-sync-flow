
import { BankReport, BankFacility, Impaye, DepositNotCleared, CheckNotCleared } from '@/types/banking';
import { detectBankFromContent } from './bankIdentity';
import { hasStructuredLines, parseDocumentDate, parseFinancialInteger } from './bankReportExtractionContract';

export interface SectionExtractionResult {
  success: boolean;
  data?: BankReport;
  errors?: string[];
}

export interface BankSectionConfig {
  bankName: string;
  patterns: {
    reportDate: RegExp;
    openingBalance: RegExp;
    closingBalance: RegExp;
    depositsSection: RegExp;
    depositLine: RegExp;
    checksSection: RegExp;
    checkLine: RegExp;
    facilitiesSection: RegExp;
    facilityLine: RegExp;
    impayesSection: RegExp;
    impayeLine: RegExp;
  };
}

class BankReportSectionExtractor {
  private bankConfigs: BankSectionConfig[] = [
    {
      bankName: 'BDK',
      patterns: {
        reportDate: /(?:\bBDK\b|BANQUE\s+DE\s+DAKAR)[^\n]{0,80}?(\d{2}[/-]\d{2}[/-]\d{4})/i,
        openingBalance: /OPENING\s+BALANCE\s+(\d{2}[/-]\d{2}[/-]\d{4})[ \t]+([^\t\r\n]+?)(?=\t|\r?\n|$)/i,
        closingBalance: /CLOSING\s+BALANCE\s+as\s+per\s+Book\s*:\s*C=\(A-B\)[ \t]+([^\t\r\n]+?)(?=\t|\r?\n|$)/i,
        depositsSection: /DEPOSIT\s+NOT\s+YET\s+CLEARED/i,
        depositLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(REGUL\s+IMPAYE|REGLEMENT\s+FACTURE|TR\s+No\/FACT\.No)\s+(.*?)\s+([\d\s]+)/i,
        checksSection: /CHECK\s+Not\s+yet\s+cleared/i,
        checkLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(.*?)\s+([\d\s]+)/i,
        facilitiesSection: /BANK\s+FACILITY/i,
        facilityLine: /(.*?)\s+([\d\s]+)\s+([\d\s]+)\s+([\d\s]+)/,
        impayesSection: /IMPAYE/i,
        impayeLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+IMPAYE\s+(\S+)\s+(.*?)\s+([\d\s]+)/i
      }
    },
    {
      bankName: 'ATB',
      patterns: {
        reportDate: /(?:\bATB\b|ARAB\s+TUNISIAN\s+BANK|BANQUE\s+ATLANTIQUE)[^\n]{0,80}?(\d{2}[/-]\d{2}[/-]\d{4})/i,
        openingBalance: /SOLDE\s+OUVERTURE\s+(\d{2}[/-]\d{2}[/-]\d{4})[ \t]+([^\t\r\n]+?)(?=\t|\r?\n|$)/i,
        closingBalance: /SOLDE\s+CLOTURE\s+COMPTABLE\s*:[ \t]*([^\t\r\n]+?)(?=\t|\r?\n|$)/i,
        depositsSection: /DEPOTS\s+NON\s+CREDITES/i,
        depositLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(.*?)\s+([\d\s]+)/i,
        checksSection: /CHEQUES\s+EMIS\s+NON\s+DEBITES/i,
        checkLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(.*?)\s+([\d\s]+)/i,
        facilitiesSection: /FACILITES\s+BANCAIRES/i,
        facilityLine: /(.*?)\s+([\d\s]+)\s+([\d\s]+)\s+([\d\s]+)/,
        impayesSection: /IMPAYES\s+NON\s+REGULARISES/i,
        impayeLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+IMPAYE\s+(\S+)\s+(.*?)\s+([\d\s]+)/i
      }
    },
    {
      bankName: 'BICIS',
      patterns: {
        reportDate: /\bBICIS\b[^\n]{0,80}?(\d{2}[/-]\d{2}[/-]\d{4})/i,
        openingBalance: /SOLDE\s+INITIAL\s+(\d{2}[/-]\d{2}[/-]\d{4})[ \t]+([^\t\r\n]+?)(?=\t|\r?\n|$)/i,
        closingBalance: /SOLDE\s+FINAL\s+COMPTABLE\s*:[ \t]*([^\t\r\n]+?)(?=\t|\r?\n|$)/i,
        depositsSection: /DEPOTS\s+EN\s+ATTENTE/i,
        depositLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(.*?)\s+([\d\s]+)/i,
        checksSection: /CHEQUES\s+EN\s+CIRCULATION/i,
        checkLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(.*?)\s+([\d\s]+)/i,
        facilitiesSection: /LIGNES\s+DE\s+CREDIT/i,
        facilityLine: /(.*?)\s+([\d\s]+)\s+([\d\s]+)\s+([\d\s]+)/,
        impayesSection: /INCIDENTS\s+DE\s+PAIEMENT/i,
        impayeLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+IMPAYE\s+(\S+)\s+(.*?)\s+([\d\s]+)/i
      }
    },
    {
      bankName: 'ORA',
      patterns: {
        reportDate: /(?:\bORA\b|\bORABANK\b|\bORA\s+BANK\b)[^\n]{0,80}?(\d{2}[/-]\d{2}[/-]\d{4})/i,
        openingBalance: /BALANCE\s+OPENING\s+(\d{2}[/-]\d{2}[/-]\d{4})[ \t]+([^\t\r\n]+?)(?=\t|\r?\n|$)/i,
        closingBalance: /BALANCE\s+CLOSING\s+BOOK\s*:[ \t]*([^\t\r\n]+?)(?=\t|\r?\n|$)/i,
        depositsSection: /DEPOSITS\s+NOT\s+CLEARED/i,
        depositLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(.*?)\s+([\d\s]+)/i,
        checksSection: /CHECKS\s+NOT\s+CLEARED/i,
        checkLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(.*?)\s+([\d\s]+)/i,
        facilitiesSection: /CREDIT\s+FACILITIES/i,
        facilityLine: /(.*?)\s+([\d\s]+)\s+([\d\s]+)\s+([\d\s]+)/,
        impayesSection: /UNPAID\s+ITEMS/i,
        impayeLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})?\s*UNPAID\s+(\S+)\s+(.*?)\s+([\d\s]+)/i
      }
    },
    {
      bankName: 'SGBS',
      patterns: {
        reportDate: /(?:\bSGBS\b|\bSGS\b|SOCIETE\s+GENERALE)[^\n]{0,80}?(\d{2}[/-]\d{2}[/-]\d{4})/i,
        openingBalance: /SOLDE\s+OUVERTURE\s+(\d{2}[/-]\d{2}[/-]\d{4})[ \t]+([^\t\r\n]+?)(?=\t|\r?\n|$)/i,
        closingBalance: /SOLDE\s+FERMETURE\s+LIVRE\s*:[ \t]*([^\t\r\n]+?)(?=\t|\r?\n|$)/i,
        depositsSection: /DEPOTS\s+NON\s+CREDITES/i,
        depositLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(.*?)\s+([\d\s]+)/i,
        checksSection: /CHEQUES\s+NON\s+DEBITES/i,
        checkLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(.*?)\s+([\d\s]+)/i,
        facilitiesSection: /FACILITES\s+BANCAIRES/i,
        facilityLine: /(.*?)\s+([\d\s]+)\s+([\d\s]+)\s+([\d\s]+)/,
        impayesSection: /IMPAYES\s+NON\s+REGULARISES/i,
        impayeLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})?\s*IMPAYE\s+(\S+)\s+(.*?)\s+([\d\s]+)/i
      }
    },
    {
      bankName: 'BIS',
      patterns: {
        reportDate: /(?:\bBIS\b|BANQUE\s+ISLAMIQUE(?:\s+DU\s+SENEGAL)?)[^\n]{0,80}?(\d{2}[/-]\d{2}[/-]\d{4})/i,
        openingBalance: /OPENING\s+BALANCE\s+(\d{2}[/-]\d{2}[/-]\d{4})[ \t]+([^\t\r\n]+?)(?=\t|\r?\n|$)/i,
        closingBalance: /CLOSING\s+BALANCE\s+BOOK\s*:[ \t]*([^\t\r\n]+?)(?=\t|\r?\n|$)/i,
        depositsSection: /DEPOSITS\s+NOT\s+CLEARED/i,
        depositLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(.*?)\s+([\d\s]+)/i,
        checksSection: /CHECKS\s+NOT\s+CLEARED/i,
        checkLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(.*?)\s+([\d\s]+)/i,
        facilitiesSection: /FINANCING\s+FACILITIES/i,
        facilityLine: /(.*?)\s+([\d\s]+)\s+([\d\s]+)\s+([\d\s]+)/,
        impayesSection: /DEFAULTED\s+ITEMS/i,
        impayeLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})?\s*DEFAULT\s+(\S+)\s+(.*?)\s+([\d\s]+)/i
      }
    }
  ];

  async extractBankReportSections(textContent: string, bankName: string): Promise<SectionExtractionResult> {
    console.log(`🔍 Extraction par sections pour ${bankName}...`);
    
    const config = this.bankConfigs.find(c => c.bankName === bankName);
    if (!config) {
      return {
        success: false,
        errors: [`Configuration non trouvée pour la banque ${bankName}`]
      };
    }

    try {
      const errors: string[] = [];
      if (!hasStructuredLines(textContent, 3)) {
        return {
          success: false,
          errors: ['Structure de lignes insuffisante : le document PDF semble aplati.'],
        };
      }

      const contentBank = detectBankFromContent(textContent);
      if (contentBank !== bankName) {
        return {
          success: false,
          errors: [`Identité bancaire non corroborée pour ${bankName}.`],
        };
      }

      const reportDateMatch = textContent.match(config.patterns.reportDate);
      const headerDate = parseDocumentDate(reportDateMatch?.[1]);

      const openingMatch = textContent.match(config.patterns.openingBalance);
      const closingMatch = textContent.match(config.patterns.closingBalance);
      const openingDate = parseDocumentDate(openingMatch?.[1]);
      const reportDate = openingDate ?? headerDate;
      const openingBalance = openingMatch ? parseFinancialInteger(openingMatch[2]) : null;
      const closingBalance = closingMatch ? parseFinancialInteger(closingMatch[1]) : null;

      if (!reportDate) errors.push('Date de rapport absente ou invalide.');
      if (openingMatch && !openingDate) errors.push('Date du solde d’ouverture invalide.');
      if (openingDate && headerDate && openingDate !== headerDate) {
        errors.push('Date de rapport incohérente avec la date du solde d’ouverture.');
      }
      if (!openingMatch) errors.push('Solde d’ouverture daté absent.');
      if (!closingMatch) errors.push('Solde de clôture absent.');
      if (openingMatch && openingBalance === null) errors.push('Solde d’ouverture invalide.');
      if (closingMatch && closingBalance === null) errors.push('Solde de clôture invalide.');

      const bankReport: BankReport = {
        bank: bankName,
        date: reportDate ?? '',
        openingBalance: openingBalance ?? 0,
        closingBalance: closingBalance ?? 0,
        bankFacilities: [],
        depositsNotCleared: [],
        checksNotCleared: [],
        impayes: []
      };

      // Extraction des dépôts non crédités
      bankReport.depositsNotCleared = this.extractDepositsNotCleared(textContent, config);
      console.log(`💰 Dépôts non crédités: ${bankReport.depositsNotCleared.length}`);

      // Extraction des chèques non débités
      bankReport.checksNotCleared = this.extractChecksNotCleared(textContent, config);
      console.log(`📝 Chèques non débités: ${bankReport.checksNotCleared?.length || 0}`);

      // Extraction des facilités bancaires
      bankReport.bankFacilities = this.extractBankFacilities(textContent, config);
      console.log(`🏦 Facilités bancaires: ${bankReport.bankFacilities.length}`);

      // Extraction des impayés
      bankReport.impayes = this.extractImpayes(textContent, config);
      console.log(`❌ Impayés: ${bankReport.impayes.length}`);

      const sectionChecks = [
        [config.patterns.depositsSection, bankReport.depositsNotCleared.length, 'dépôts non crédités'],
        [config.patterns.checksSection, bankReport.checksNotCleared?.length ?? 0, 'chèques non débités'],
        [config.patterns.facilitiesSection, bankReport.bankFacilities.length, 'facilités bancaires'],
        [config.patterns.impayesSection, bankReport.impayes.length, 'impayés'],
      ] as const;
      for (const [sectionPattern, count, label] of sectionChecks) {
        if (sectionPattern.test(textContent) && count === 0) {
          errors.push(`Section ${label} déclarée mais sans ligne exploitable.`);
        }
      }

      if (errors.length > 0) return { success: false, errors };

      return {
        success: true,
        data: bankReport
      };

    } catch (error) {
      console.error(`❌ Erreur extraction ${bankName}:`, error);
      return {
        success: false,
        errors: [`Erreur extraction: ${error instanceof Error ? error.message : 'Erreur inconnue'}`]
      };
    }
  }

  private extractDepositsNotCleared(textContent: string, config: BankSectionConfig): DepositNotCleared[] {
    const deposits: DepositNotCleared[] = [];
    const lines = textContent.split('\n');
    let inDepositsSection = false;

    for (const line of lines) {
      if (config.patterns.depositsSection.test(line)) {
        inDepositsSection = true;
        continue;
      }

      if (inDepositsSection && line.trim()) {
        const match = this.matchCompleteLine(line, config.patterns.depositLine);
        if (match) {
          const hasExplicitPaymentType = match.length === 6;
          deposits.push({
            dateDepot: this.parseDate(match[1]),
            reference: match[2] || '',
            clientCode: (hasExplicitPaymentType ? match[4] : match[3]) || '',
            typeReglement: hasExplicitPaymentType ? match[3] : 'DEPOT',
            montant: this.parseAmount(match[match.length - 1])
          });
        } else if (line.match(/^[A-Z\s]+:/) || line.match(/TOTAL|SOUS-TOTAL/i)) {
          inDepositsSection = false;
        }
      }
    }

    return deposits;
  }

  private extractChecksNotCleared(textContent: string, config: BankSectionConfig): CheckNotCleared[] {
    const checks: CheckNotCleared[] = [];
    const lines = textContent.split('\n');
    let inChecksSection = false;

    for (const line of lines) {
      if (config.patterns.checksSection.test(line)) {
        inChecksSection = true;
        continue;
      }

      if (inChecksSection && line.trim()) {
        const match = this.matchCompleteLine(line, config.patterns.checkLine);
        if (match) {
          checks.push({
            dateEmission: this.parseDate(match[1]),
            numeroCheque: match[2] || '',
            beneficiaire: match[3] || '',
            montant: this.parseAmount(match[4])
          });
        } else if (line.match(/^[A-Z\s]+:/) || line.match(/TOTAL|SOUS-TOTAL/i)) {
          inChecksSection = false;
        }
      }
    }

    return checks;
  }

  private extractBankFacilities(textContent: string, config: BankSectionConfig): BankFacility[] {
    const facilities: BankFacility[] = [];
    const lines = textContent.split('\n');
    let inFacilitiesSection = false;

    for (const line of lines) {
      if (config.patterns.facilitiesSection.test(line)) {
        inFacilitiesSection = true;
        continue;
      }

      if (inFacilitiesSection && line.trim()) {
        const match = this.matchCompleteLine(line, config.patterns.facilityLine);
        if (match && match[1] && !match[1].match(/CLIENT|TOTAL|LIMIT/i)) {
          const limitAmount = this.parseAmount(match[2]);
          const usedAmount = this.parseAmount(match[3]);
          const availableAmount = this.parseAmount(match[4]);

          facilities.push({
            facilityType: match[1].trim(),
            limitAmount,
            usedAmount,
            availableAmount
          });
        } else if (line.match(/^[A-Z\s]+:/) || line.match(/TOTAL|SOUS-TOTAL/i)) {
          inFacilitiesSection = false;
        }
      }
    }

    return facilities;
  }

  private extractImpayes(textContent: string, config: BankSectionConfig): Impaye[] {
    const impayes: Impaye[] = [];
    const lines = textContent.split('\n');
    let inImpayesSection = false;
    
    console.log('🔍 Recherche des impayés dans le texte...');

    for (const line of lines) {
      if (inImpayesSection && line.trim()) {
        const match = this.matchCompleteLine(line, config.patterns.impayeLine);
        if (match) {
          // Extraire le code client et la description (nom du client)
          const clientCode = match[3]?.trim() || 'UNKNOWN';
          const description = match[4]?.trim() || 'IMPAYE';
          
          console.log(`✅ Impayé trouvé: Client ${clientCode}, Description: ${description}`);
          
          const firstDate = this.parseDate(match[1]);
          const secondDate = match[2] ? this.parseDate(match[2]) : undefined;
          impayes.push({
            dateRetour: secondDate ? firstDate : undefined,
            dateEcheance: secondDate ?? firstDate,
            clientCode: clientCode,
            description: description,
            montant: this.parseAmount(match[match.length - 1])
          });
          continue;
        } else if (line.match(/^[A-Z\s]+:/) || line.match(/TOTAL|SOUS-TOTAL/i)) {
          inImpayesSection = false;
        }
      }

      if (config.patterns.impayesSection.test(line)) {
        inImpayesSection = true;
      }
    }

    return impayes;
  }

  private parseAmount(value: string | undefined): number {
    const parsed = parseFinancialInteger(value);
    if (parsed === null) throw new Error(`Montant invalide: ${value ?? 'absent'}`);
    return parsed;
  }

  private matchCompleteLine(line: string, pattern: RegExp): RegExpMatchArray | null {
    const trimmedLine = line.trim();
    const match = trimmedLine.match(pattern);
    if (!match || match.index !== 0 || match[0].length !== trimmedLine.length) return null;
    return match;
  }

  private parseDate(value: string | undefined): string {
    const parsed = parseDocumentDate(value);
    if (!parsed) throw new Error(`Date invalide: ${value ?? 'absente'}`);
    return parsed;
  }
}

export const bankReportSectionExtractor = new BankReportSectionExtractor();
